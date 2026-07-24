import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { asUser, createTestApp, createTestOrg, destroyTestOrg, TestOrg } from './setup-app';

/**
 * Permission enforcement, separate from the business rules.
 *
 * alice/bob hold `claims.create` only; carol/dan hold `claims.create` and
 * `claims.approve` — mirroring the seeded supervisors and site leads.
 */
describe('claims route permissions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: TestOrg;
  /** A user in the org with no claims permissions at all. */
  let outsiderId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    org = await createTestOrg(prisma);
    const outsider = await prisma.user.create({
      data: {
        orgId: org.orgId,
        email: `outsider-${Date.now()}@e2e.test`,
        name: 'outsider',
        permissions: ['projects.read'],
      },
    });
    outsiderId = outsider.id;
  });

  afterEach(async () => {
    await destroyTestOrg(prisma, org.orgId);
  });

  afterAll(async () => {
    await app.close();
  });

  const body = {
    expenseDate: '2026-01-18',
    lines: [{ description: 'Materials', quantity: 1, unitPrice: 1750.0, isFuel: false }],
  };

  const create = (actorId: string) =>
    request(app.getHttpServer())
      .post('/api/claims')
      .set(asUser(org, actorId))
      .send({ projectId: org.projectId, ...body });

  /** A SUBMITTED claim owned by alice, ready for a decision. */
  const lodged = async () => {
    const res = await create(org.aliceId).expect(201);
    await request(app.getHttpServer())
      .post(`/api/claims/${res.body.data.id}/submit`)
      .set(asUser(org, org.aliceId))
      .expect(201);
    return res.body.data;
  };

  describe('claims.approve is required to decide', () => {
    it('refuses Bob, who holds claims.create but not claims.approve', async () => {
      const claim = await lodged();

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claim.id}/approve`)
        .set(asUser(org, org.bobId))
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/missing permission: claims\.approve/i);
    });

    it('refuses the same user on reject', async () => {
      const claim = await lodged();

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claim.id}/reject`)
        .set(asUser(org, org.bobId))
        .expect(403);

      expect(res.body.error.message).toMatch(/missing permission: claims\.approve/i);
    });

    it('allows Carol, who holds claims.approve', async () => {
      const claim = await lodged();

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claim.id}/approve`)
        .set(asUser(org, org.carolId))
        .expect(201);

      expect(res.body.data.status).toBe('PARTIALLY_APPROVED');
    });

    it('allows Dan as the second key', async () => {
      const claim = await lodged();
      await request(app.getHttpServer())
        .post(`/api/claims/${claim.id}/approve`)
        .set(asUser(org, org.carolId))
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claim.id}/approve`)
        .set(asUser(org, org.danId))
        .expect(201);

      expect(res.body.data.status).toBe('APPROVED');
    });
  });

  describe('a denied request never reaches the service', () => {
    it('records no decision, no audit row, and no status change', async () => {
      const claim = await lodged();

      await request(app.getHttpServer())
        .post(`/api/claims/${claim.id}/approve`)
        .set(asUser(org, org.bobId))
        .expect(403);

      expect(await prisma.claimDecision.count({ where: { claimId: claim.id } })).toBe(0);
      const audits = await prisma.auditLog.findMany({ where: { entityId: claim.id } });
      expect(audits.map((a) => a.action)).toEqual(['claim.created', 'claim.submitted']);
      expect((await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe(
        'SUBMITTED',
      );
    });

    it('publishes no outbox event', async () => {
      const claim = await lodged();

      await request(app.getHttpServer())
        .post(`/api/claims/${claim.id}/approve`)
        .set(asUser(org, org.bobId))
        .expect(403);

      expect(await prisma.outboxEvent.count({ where: { orgId: org.orgId } })).toBe(0);
    });
  });

  describe('claims.create is required to author', () => {
    it('refuses a user without claims.create on create', async () => {
      const res = await create(outsiderId).expect(403);

      expect(res.body.error.message).toMatch(/missing permission: claims\.create/i);
      expect(await prisma.claim.count({ where: { orgId: org.orgId } })).toBe(0);
    });

    it('refuses a user without claims.create on submit', async () => {
      const claim = await create(org.aliceId).expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claim.body.data.id}/submit`)
        .set(asUser(org, outsiderId))
        .expect(403);

      expect(res.body.error.message).toMatch(/missing permission: claims\.create/i);
    });

    it('still enforces submitter-only ownership on top of the permission', async () => {
      // Bob holds claims.create, so he clears the guard and is then stopped by
      // the ownership rule — permission and ownership are separate checks.
      const claim = await create(org.aliceId).expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claim.body.data.id}/submit`)
        .set(asUser(org, org.bobId))
        .expect(403);

      expect(res.body.error.message).toMatch(/only the submitter/i);
    });
  });

  describe('reads stay open to any org member', () => {
    it('lets a user with no claims permissions list claims', async () => {
      await create(org.aliceId).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/claims')
        .set(asUser(org, outsiderId))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
    });

    it('lets the same user read a claim detail', async () => {
      const claim = await create(org.aliceId).expect(201);

      await request(app.getHttpServer())
        .get(`/api/claims/${claim.body.data.id}`)
        .set(asUser(org, outsiderId))
        .expect(200);
    });

    it("still 404s a foreign claim rather than 403 — the guard must not change isolation", async () => {
      const other = await createTestOrg(prisma);
      try {
        const foreign = await request(app.getHttpServer())
          .post('/api/claims')
          .set(asUser(other, other.aliceId))
          .send({ projectId: other.projectId, ...body })
          .expect(201);

        const res = await request(app.getHttpServer())
          .get(`/api/claims/${foreign.body.data.id}`)
          .set(asUser(org, org.aliceId))
          .expect(404);

        expect(res.body.error.code).toBe('NOTFOUND');
      } finally {
        await destroyTestOrg(prisma, other.orgId);
      }
    });
  });

  describe('the envelope', () => {
    it('wraps a permission denial in the platform error envelope', async () => {
      const claim = await lodged();

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claim.id}/approve`)
        .set(asUser(org, org.bobId))
        .expect(403);

      expect(res.body).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN', message: expect.any(String) },
      });
      expect(res.body.timestamp).toEqual(expect.any(String));
    });
  });
});
