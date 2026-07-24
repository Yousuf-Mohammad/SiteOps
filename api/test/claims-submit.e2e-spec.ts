import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { asUser, createTestApp, createTestOrg, destroyTestOrg, TestOrg } from './setup-app';

describe('POST /api/claims/:id/submit', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: TestOrg;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    org = await createTestOrg(prisma);
  });

  afterEach(async () => {
    await destroyTestOrg(prisma, org.orgId);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Creates a DRAFT claim owned by `submitterId`. */
  const draft = async (submitterId = org.aliceId) => {
    const res = await request(app.getHttpServer())
      .post('/api/claims')
      .set(asUser(org, submitterId))
      .send({
        projectId: org.projectId,
        expenseDate: '2026-01-18',
        lines: [{ description: 'Fuel', quantity: 1, unitPrice: 10.0, isFuel: true }],
      })
      .expect(201);
    return res.body.data;
  };

  const submit = (id: string, actorId: string) =>
    request(app.getHttpServer()).post(`/api/claims/${id}/submit`).set(asUser(org, actorId));

  const statusOf = async (id: string) =>
    (await prisma.claim.findUniqueOrThrow({ where: { id } })).status;

  describe('the happy path', () => {
    it('moves the submitter\'s own DRAFT to SUBMITTED', async () => {
      const claim = await draft();

      const res = await submit(claim.id, org.aliceId).expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUBMITTED');
      expect(await statusOf(claim.id)).toBe('SUBMITTED');
    });

    it('shows up as SUBMITTED on the detail endpoint', async () => {
      const claim = await draft();
      await submit(claim.id, org.aliceId).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/claims/${claim.id}`)
        .set(asUser(org, org.aliceId))
        .expect(200);

      expect(res.body.data.status).toBe('SUBMITTED');
    });

    it('is filterable by the new status', async () => {
      const claim = await draft();
      await submit(claim.id, org.aliceId).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/claims?status=SUBMITTED')
        .set(asUser(org, org.aliceId))
        .expect(200);

      expect(res.body.data.map((c: any) => c.id)).toEqual([claim.id]);
    });
  });

  describe('only the submitter can lodge', () => {
    it('rejects a different user in the same org with 403', async () => {
      const claim = await draft(org.aliceId);

      const res = await submit(claim.id, org.bobId).expect(403);

      expect(res.body.error.message).toMatch(/only the submitter/i);
      expect(await statusOf(claim.id)).toBe('DRAFT');
    });

    it('rejects an approver trying to lodge on the submitter\'s behalf', async () => {
      const claim = await draft(org.aliceId);

      await submit(claim.id, org.carolId).expect(403);

      expect(await statusOf(claim.id)).toBe('DRAFT');
    });

    it('writes no audit row for a rejected attempt', async () => {
      const claim = await draft(org.aliceId);
      await submit(claim.id, org.bobId).expect(403);

      const audits = await prisma.auditLog.findMany({
        where: { entityId: claim.id, action: 'claim.submitted' },
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe('only DRAFT is lodgeable', () => {
    it('rejects a second submit with 409 naming the current status', async () => {
      const claim = await draft();
      await submit(claim.id, org.aliceId).expect(201);

      const res = await submit(claim.id, org.aliceId).expect(409);

      expect(res.body.error.message).toBe('Claim is SUBMITTED, expected DRAFT');
    });

    it('rejects lodging an APPROVED claim', async () => {
      const claim = await draft();
      await prisma.claim.update({ where: { id: claim.id }, data: { status: 'APPROVED' } });

      const res = await submit(claim.id, org.aliceId).expect(409);

      expect(res.body.error.message).toBe('Claim is APPROVED, expected DRAFT');
    });
  });

  describe('org scoping', () => {
    it("404s on another org's claim", async () => {
      const other = await createTestOrg(prisma);
      try {
        const foreign = await request(app.getHttpServer())
          .post('/api/claims')
          .set(asUser(other, other.aliceId))
          .send({
            projectId: other.projectId,
            expenseDate: '2026-01-18',
            lines: [{ description: 'x', quantity: 1, unitPrice: 5, isFuel: false }],
          })
          .expect(201);

        const res = await submit(foreign.body.data.id, org.aliceId).expect(404);

        expect(res.body.error.message).toMatch(/not found/i);
        expect(await statusOf(foreign.body.data.id)).toBe('DRAFT');
      } finally {
        await destroyTestOrg(prisma, other.orgId);
      }
    });

    it('makes a foreign claim indistinguishable from a nonexistent one', async () => {
      const missing = await submit('cl00000000000000000000000', org.aliceId).expect(404);

      expect(missing.body.error.code).toBe('NOTFOUND');
    });
  });

  describe('audit trail', () => {
    it('records claim.submitted with the transition and the actor', async () => {
      const claim = await draft();
      await submit(claim.id, org.aliceId).expect(201);

      const audits = await prisma.auditLog.findMany({
        where: { orgId: org.orgId, entityId: claim.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(audits.map((a) => a.action)).toEqual(['claim.created', 'claim.submitted']);
      const submitted = audits[1];
      expect(submitted.actorId).toBe(org.aliceId);
      expect(submitted.before).toMatchObject({ status: 'DRAFT' });
      expect(submitted.after).toMatchObject({ status: 'SUBMITTED' });
    });

    it('publishes no outbox event — lodgment is audited, not broadcast', async () => {
      const claim = await draft();
      await submit(claim.id, org.aliceId).expect(201);

      const events = await prisma.outboxEvent.findMany({ where: { orgId: org.orgId } });
      expect(events).toHaveLength(0);
    });
  });

  describe('race safety', () => {
    /**
     * The assertion a read-then-write implementation fails: both requests would
     * observe DRAFT, both would update, and the claim would be audited twice.
     */
    it('lets exactly one of two simultaneous submits win', async () => {
      const claim = await draft();

      const results = await Promise.all([
        submit(claim.id, org.aliceId),
        submit(claim.id, org.aliceId),
      ]);

      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 409]);
      expect(await statusOf(claim.id)).toBe('SUBMITTED');
    });

    it('audits the transition exactly once under concurrency', async () => {
      const claim = await draft();

      await Promise.all([submit(claim.id, org.aliceId), submit(claim.id, org.aliceId)]);

      const audits = await prisma.auditLog.findMany({
        where: { entityId: claim.id, action: 'claim.submitted' },
      });
      expect(audits).toHaveLength(1);
    });

    it('survives a wider burst with exactly one winner', async () => {
      const claim = await draft();

      const results = await Promise.all(
        Array.from({ length: 5 }, () => submit(claim.id, org.aliceId)),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    });
  });
});
