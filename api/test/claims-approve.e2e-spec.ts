import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { asUser, createTestApp, createTestOrg, destroyTestOrg, TestOrg } from './setup-app';

describe('POST /api/claims/:id/approve and /reject', () => {
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

  /**
   * Creates a claim of exactly `total` (non-fuel, so no levy distorts it) and
   * lodges it, leaving it SUBMITTED and owned by alice.
   */
  const lodged = async (total: string, submitterId = org.aliceId) => {
    const res = await request(app.getHttpServer())
      .post('/api/claims')
      .set(asUser(org, submitterId))
      .send({
        projectId: org.projectId,
        expenseDate: '2026-01-18',
        lines: [{ description: 'Materials', quantity: 1, unitPrice: Number(total), isFuel: false }],
      })
      .expect(201);
    const claim = res.body.data;

    await request(app.getHttpServer())
      .post(`/api/claims/${claim.id}/submit`)
      .set(asUser(org, submitterId))
      .expect(201);

    return claim;
  };

  const approve = (id: string, actorId: string) =>
    request(app.getHttpServer()).post(`/api/claims/${id}/approve`).set(asUser(org, actorId));

  const reject = (id: string, actorId: string) =>
    request(app.getHttpServer()).post(`/api/claims/${id}/reject`).set(asUser(org, actorId));

  const statusOf = async (id: string) =>
    (await prisma.claim.findUniqueOrThrow({ where: { id } })).status;

  const outboxCount = () =>
    prisma.outboxEvent.count({ where: { orgId: org.orgId, type: 'claim.approved' } });

  describe('the two-key flow above $1,000', () => {
    it('parks the first approval at PARTIALLY_APPROVED without publishing', async () => {
      const claim = await lodged('1750.00');

      const res = await approve(claim.id, org.carolId).expect(201);

      expect(res.body.data.status).toBe('PARTIALLY_APPROVED');
      expect(await outboxCount()).toBe(0);
    });

    it('refuses the same approver as the second key', async () => {
      const claim = await lodged('1750.00');
      await approve(claim.id, org.carolId).expect(201);

      const res = await approve(claim.id, org.carolId).expect(409);

      expect(res.body.error.message).toMatch(/already recorded a decision/i);
      expect(await statusOf(claim.id)).toBe('PARTIALLY_APPROVED');
    });

    it('completes on a second, different approver and publishes exactly one event', async () => {
      const claim = await lodged('1750.00');
      await approve(claim.id, org.carolId).expect(201);

      const res = await approve(claim.id, org.danId).expect(201);

      expect(res.body.data.status).toBe('APPROVED');
      expect(await outboxCount()).toBe(1);

      const events = await prisma.outboxEvent.findMany({ where: { orgId: org.orgId } });
      expect(events[0].payload).toMatchObject({ claimId: claim.id, approvedBy: org.danId });
    });

    it('records both decisions', async () => {
      const claim = await lodged('1750.00');
      await approve(claim.id, org.carolId).expect(201);
      await approve(claim.id, org.danId).expect(201);

      const decisions = await prisma.claimDecision.findMany({
        where: { claimId: claim.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(decisions.map((d) => d.actorId)).toEqual([org.carolId, org.danId]);
      expect(decisions.every((d) => d.decision === 'APPROVE')).toBe(true);
    });

    it('stamps approvedBy only on the final approval', async () => {
      const claim = await lodged('1750.00');
      await approve(claim.id, org.carolId).expect(201);
      expect((await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } })).approvedBy).toBeNull();

      await approve(claim.id, org.danId).expect(201);
      const finalClaim = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
      expect(finalClaim.approvedBy).toBe(org.danId);
      expect(finalClaim.approvedAt).not.toBeNull();
    });
  });

  describe('the $1,000.00 boundary', () => {
    it('treats exactly $1,000.00 as one key', async () => {
      const claim = await lodged('1000.00');

      const res = await approve(claim.id, org.carolId).expect(201);

      expect(res.body.data.status).toBe('APPROVED');
      expect(await outboxCount()).toBe(1);
    });

    it('treats $1,000.01 as needing two keys', async () => {
      const claim = await lodged('1000.01');

      const res = await approve(claim.id, org.carolId).expect(201);

      expect(res.body.data.status).toBe('PARTIALLY_APPROVED');
      expect(await outboxCount()).toBe(0);
    });

    it('approves a small claim outright', async () => {
      const claim = await lodged('50.00');

      const res = await approve(claim.id, org.carolId).expect(201);

      expect(res.body.data.status).toBe('APPROVED');
    });
  });

  describe('no self-dealing', () => {
    it('refuses the submitter approving their own claim', async () => {
      const claim = await lodged('50.00', org.aliceId);

      const res = await approve(claim.id, org.aliceId).expect(403);

      expect(res.body.error.message).toMatch(/cannot approve a claim you submitted/i);
      expect(await statusOf(claim.id)).toBe('SUBMITTED');
    });

    it('refuses the submitter rejecting their own claim', async () => {
      const claim = await lodged('50.00', org.aliceId);

      await reject(claim.id, org.aliceId).expect(403);

      expect(await statusOf(claim.id)).toBe('SUBMITTED');
    });

    it('refuses the submitter even as the second key', async () => {
      // Bob submits; carol turns the first key; bob must not finish it.
      const claim = await lodged('1750.00', org.bobId);
      await approve(claim.id, org.carolId).expect(201);

      await approve(claim.id, org.bobId).expect(403);

      expect(await statusOf(claim.id)).toBe('PARTIALLY_APPROVED');
    });

    it('leaves no decision row behind after a refused attempt', async () => {
      const claim = await lodged('50.00', org.aliceId);
      await approve(claim.id, org.aliceId).expect(403);

      expect(await prisma.claimDecision.count({ where: { claimId: claim.id } })).toBe(0);
    });
  });

  describe('rejection', () => {
    it('rejects a SUBMITTED claim outright', async () => {
      const claim = await lodged('50.00');

      const res = await reject(claim.id, org.carolId).expect(201);

      expect(res.body.data.status).toBe('REJECTED');
      expect(await outboxCount()).toBe(0);
    });

    it('rejects a PARTIALLY_APPROVED claim, keeping the earlier approval as history', async () => {
      const claim = await lodged('1750.00');
      await approve(claim.id, org.carolId).expect(201);

      const res = await reject(claim.id, org.danId).expect(201);

      expect(res.body.data.status).toBe('REJECTED');
      const decisions = await prisma.claimDecision.findMany({
        where: { claimId: claim.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(decisions.map((d) => d.decision)).toEqual(['APPROVE', 'REJECT']);
    });

    it('needs only one key regardless of value', async () => {
      const claim = await lodged('9999.99');

      const res = await reject(claim.id, org.carolId).expect(201);

      expect(res.body.data.status).toBe('REJECTED');
    });
  });

  describe('invalid transitions', () => {
    it('refuses to approve a DRAFT claim', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/claims')
        .set(asUser(org, org.aliceId))
        .send({
          projectId: org.projectId,
          expenseDate: '2026-01-18',
          lines: [{ description: 'x', quantity: 1, unitPrice: 50, isFuel: false }],
        })
        .expect(201);

      const conflict = await approve(res.body.data.id, org.carolId).expect(409);
      expect(conflict.body.error.message).toMatch(/Claim is DRAFT/);
    });

    it('refuses to approve an already-APPROVED claim', async () => {
      const claim = await lodged('50.00');
      await approve(claim.id, org.carolId).expect(201);

      await approve(claim.id, org.danId).expect(409);
    });

    it('refuses to reject an already-REJECTED claim', async () => {
      const claim = await lodged('50.00');
      await reject(claim.id, org.carolId).expect(201);

      await reject(claim.id, org.danId).expect(409);
    });

    it("404s on another org's claim", async () => {
      const other = await createTestOrg(prisma);
      try {
        const res = await request(app.getHttpServer())
          .post('/api/claims')
          .set(asUser(other, other.aliceId))
          .send({
            projectId: other.projectId,
            expenseDate: '2026-01-18',
            lines: [{ description: 'x', quantity: 1, unitPrice: 50, isFuel: false }],
          })
          .expect(201);

        await approve(res.body.data.id, org.carolId).expect(404);
      } finally {
        await destroyTestOrg(prisma, other.orgId);
      }
    });
  });

  describe('race safety', () => {
    /**
     * Two *different* approvers hitting the same SUBMITTED claim at once. The
     * unique constraint does not help here — both actors are distinct — so this
     * is entirely on the conditional updateMany.
     */
    it('lets exactly one of two simultaneous approvals win', async () => {
      const claim = await lodged('1750.00');

      const results = await Promise.all([
        approve(claim.id, org.carolId),
        approve(claim.id, org.danId),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await statusOf(claim.id)).toBe('PARTIALLY_APPROVED');
    });

    it('rolls the loser back entirely, leaving one decision row', async () => {
      const claim = await lodged('1750.00');

      await Promise.all([approve(claim.id, org.carolId), approve(claim.id, org.danId)]);

      expect(await prisma.claimDecision.count({ where: { claimId: claim.id } })).toBe(1);
    });

    it('lets the loser retry as the second key', async () => {
      const claim = await lodged('1750.00');

      const first = await Promise.all([
        approve(claim.id, org.carolId),
        approve(claim.id, org.danId),
      ]);
      const loser = first.find((r) => r.status === 409)!;
      expect(loser).toBeDefined();

      // Whoever lost simply tries again and becomes the second key.
      const winnerId = (await prisma.claimDecision.findFirstOrThrow({ where: { claimId: claim.id } }))
        .actorId;
      const loserId = winnerId === org.carolId ? org.danId : org.carolId;

      await approve(claim.id, loserId).expect(201);
      expect(await statusOf(claim.id)).toBe('APPROVED');
      expect(await outboxCount()).toBe(1);
    });

    it('publishes exactly one event under a concurrent final approval', async () => {
      const claim = await lodged('1750.00');
      await approve(claim.id, org.carolId).expect(201);

      await Promise.all([approve(claim.id, org.danId), approve(claim.id, org.danId)]);

      expect(await statusOf(claim.id)).toBe('APPROVED');
      expect(await outboxCount()).toBe(1);
    });

    it('survives a wider burst on a single-key claim', async () => {
      const claim = await lodged('50.00');

      const results = await Promise.all([
        approve(claim.id, org.carolId),
        approve(claim.id, org.danId),
        approve(claim.id, org.carolId),
        approve(claim.id, org.danId),
      ]);

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await statusOf(claim.id)).toBe('APPROVED');
      expect(await outboxCount()).toBe(1);
    });
  });

  describe('audit trail', () => {
    it('records the full lifecycle of a two-key claim', async () => {
      const claim = await lodged('1750.00');
      await approve(claim.id, org.carolId).expect(201);
      await approve(claim.id, org.danId).expect(201);

      const audits = await prisma.auditLog.findMany({
        where: { orgId: org.orgId, entityId: claim.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(audits.map((a) => a.action)).toEqual([
        'claim.created',
        'claim.submitted',
        'claim.partially_approved',
        'claim.approved',
      ]);
      expect(audits[2].before).toMatchObject({ status: 'SUBMITTED' });
      expect(audits[3].after).toMatchObject({ status: 'APPROVED' });
    });

    it('surfaces decisions and audit on the detail endpoint', async () => {
      const claim = await lodged('1750.00');
      await approve(claim.id, org.carolId).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/claims/${claim.id}`)
        .set(asUser(org, org.aliceId))
        .expect(200);

      expect(res.body.data.decisions).toHaveLength(1);
      expect(res.body.data.decisions[0].actorId).toBe(org.carolId);
      expect(res.body.data.audit.map((a: any) => a.action)).toContain('claim.partially_approved');
    });
  });
});
