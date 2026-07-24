import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { asUser, createTestApp, createTestOrg, destroyTestOrg, TestOrg } from './setup-app';

/**
 * The rejected-claims question: "they usually come back around after the
 * supervisor fixes them."
 *
 * Resolved as correct-and-reopen on the same claim — same reference, next
 * revision. The test that carries the design is the first one: the approver who
 * rejected a claim must be able to rule on the correction.
 */
describe('POST /api/claims/:id/reopen', () => {
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

  const create = async (total: string, submitterId = org.aliceId) => {
    const res = await request(app.getHttpServer())
      .post('/api/claims')
      .set(asUser(org, submitterId))
      .send({
        projectId: org.projectId,
        expenseDate: '2026-01-18',
        lines: [{ description: 'Materials', quantity: 1, unitPrice: Number(total), isFuel: false }],
      })
      .expect(201);
    return res.body.data;
  };

  const submit = (id: string, actorId = org.aliceId) =>
    request(app.getHttpServer()).post(`/api/claims/${id}/submit`).set(asUser(org, actorId));

  const approve = (id: string, actorId: string) =>
    request(app.getHttpServer()).post(`/api/claims/${id}/approve`).set(asUser(org, actorId));

  const reject = (id: string, actorId: string) =>
    request(app.getHttpServer()).post(`/api/claims/${id}/reject`).set(asUser(org, actorId));

  const reopen = (id: string, body: object = {}, actorId = org.aliceId) =>
    request(app.getHttpServer())
      .post(`/api/claims/${id}/reopen`)
      .set(asUser(org, actorId))
      .send(body);

  /** A claim lodged by alice and rejected by carol. */
  const rejected = async (total: string) => {
    const claim = await create(total);
    await submit(claim.id).expect(201);
    await reject(claim.id, org.carolId).expect(201);
    return claim;
  };

  const line = (unitPrice: number, quantity = 1) => ({
    description: 'Materials',
    quantity,
    unitPrice,
    isFuel: false,
  });

  const claimRow = (id: string) => prisma.claim.findUniqueOrThrow({ where: { id } });

  describe('the crux: a correction gets a fresh set of keys', () => {
    it('lets the approver who rejected revision 1 decide revision 2', async () => {
      const claim = await rejected('1750.00');

      await reopen(claim.id, { lines: [line(1600)] }).expect(201);
      await submit(claim.id).expect(201);

      // Carol already holds a REJECT on this claim. Scoped to revision 1, it no
      // longer blocks her — without that scoping this is a 409 forever, and the
      // person who asked for the fix can never sign it off.
      const first = await approve(claim.id, org.carolId).expect(201);
      expect(first.body.data.status).toBe('PARTIALLY_APPROVED');

      const second = await approve(claim.id, org.danId).expect(201);
      expect(second.body.data.status).toBe('APPROVED');

      expect(
        await prisma.outboxEvent.count({ where: { orgId: org.orgId, type: 'claim.approved' } }),
      ).toBe(1);
    });

    it('still blocks the same person twice within one revision', async () => {
      const claim = await rejected('1750.00');
      await reopen(claim.id, { lines: [line(1600)] }).expect(201);
      await submit(claim.id).expect(201);

      await approve(claim.id, org.carolId).expect(201);
      const res = await approve(claim.id, org.carolId).expect(409);

      expect(res.body.error.message).toMatch(/already recorded a decision/i);
    });

    it('keeps revision 1 decisions on the record', async () => {
      const claim = await rejected('1750.00');
      await reopen(claim.id, { lines: [line(1600)] }).expect(201);
      await submit(claim.id).expect(201);
      await approve(claim.id, org.carolId).expect(201);

      const decisions = await prisma.claimDecision.findMany({
        where: { claimId: claim.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(decisions).toHaveLength(2);
      expect(decisions.map((d) => [d.revision, d.decision])).toEqual([
        [1, 'REJECT'],
        [2, 'APPROVE'],
      ]);
    });

    it('starts the two-key count over: an approval from revision 1 does not carry', async () => {
      // Carol approves (first key), Dan rejects. The claim comes back with one
      // approval already on it — which must count for nothing.
      const claim = await create('1750.00');
      await submit(claim.id).expect(201);
      await approve(claim.id, org.carolId).expect(201);
      await reject(claim.id, org.danId).expect(201);
      expect((await claimRow(claim.id)).status).toBe('REJECTED');

      await reopen(claim.id, { lines: [line(1600)] }).expect(201);
      await submit(claim.id).expect(201);

      const res = await approve(claim.id, org.carolId).expect(201);
      expect(res.body.data.status).toBe('PARTIALLY_APPROVED'); // not APPROVED
    });
  });

  describe('the correction', () => {
    it('replaces the lines and recomputes the total', async () => {
      const claim = await rejected('500.00');

      const res = await reopen(claim.id, {
        lines: [line(120, 2), { ...line(30), isFuel: true }],
      }).expect(201);

      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.lines).toHaveLength(2);
      // 240 non-fuel + 30 fuel + 12.5% of 30 = 273.75
      expect(Number(res.body.data.total).toFixed(2)).toBe('273.75');
      expect(Number(res.body.data.levyAmount).toFixed(2)).toBe('3.75');
      expect(Number(res.body.data.fuelSubtotal).toFixed(2)).toBe('30.00');
    });

    it('prices the correction with the rate snapshotted at creation, not a newer one', async () => {
      const claim = await rejected('500.00');
      expect((await claimRow(claim.id)).levyRatePercent.toFixed(2)).toBe('12.50');

      // A rate change lands between the rejection and the fix. The claim's money
      // must not move because of it — reproducibility outranks currency.
      await prisma.surchargeRate.create({
        data: { orgId: org.orgId, ratePercent: 30, effectiveFrom: new Date('2026-01-02') },
      });

      const res = await reopen(claim.id, { lines: [{ ...line(100), isFuel: true }] }).expect(201);

      expect(Number(res.body.data.total).toFixed(2)).toBe('112.50'); // 12.5%, not 30%
      expect(Number(res.body.data.levyRatePercent).toFixed(2)).toBe('12.50');
    });

    it('reopens unchanged when no lines are supplied — rejected in error', async () => {
      const claim = await rejected('500.00');

      const res = await reopen(claim.id).expect(201);

      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.revision).toBe(2);
      expect(Number(res.body.data.total).toFixed(2)).toBe('500.00');
      expect(res.body.data.lines).toHaveLength(1);
    });

    it('holds a correction to the same validation as the original', async () => {
      const claim = await rejected('500.00');

      // Third decimal place — rejected at the edge on create, and here too.
      await reopen(claim.id, { lines: [line(10.005)] }).expect(400);
      await reopen(claim.id, { lines: [] }).expect(400);
      await reopen(claim.id, { lines: [{ ...line(10), quantity: 0 }] }).expect(400);

      expect((await claimRow(claim.id)).status).toBe('REJECTED');
    });
  });

  describe('identity is preserved', () => {
    it('keeps the reference and consumes no sequence number', async () => {
      const claim = await rejected('500.00');
      const before = await prisma.numberSequence.findFirstOrThrow({
        where: { orgId: org.orgId, key: 'claim:26' },
      });

      const res = await reopen(claim.id, { lines: [line(400)] }).expect(201);

      expect(res.body.data.reference).toBe(claim.reference);
      expect(res.body.data.reference).toBe('EXP 26-0001');
      const after = await prisma.numberSequence.findFirstOrThrow({
        where: { orgId: org.orgId, key: 'claim:26' },
      });
      expect(after.nextValue).toBe(before.nextValue);
    });

    it('increments the revision', async () => {
      const claim = await rejected('500.00');
      expect((await claimRow(claim.id)).revision).toBe(1);

      await reopen(claim.id, { lines: [line(400)] }).expect(201);
      expect((await claimRow(claim.id)).revision).toBe(2);
    });

    it('writes a claim.reopened audit row and publishes nothing', async () => {
      const claim = await rejected('500.00');

      await reopen(claim.id, { lines: [line(400)] }).expect(201);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { orgId: org.orgId, entityId: claim.id, action: 'claim.reopened' },
      });
      expect(audit.actorId).toBe(org.aliceId);
      expect(audit.before).toMatchObject({ status: 'REJECTED', revision: 1, total: '500.00' });
      expect(audit.after).toMatchObject({ status: 'DRAFT', revision: 2, total: '400.00' });

      expect(await prisma.outboxEvent.count({ where: { orgId: org.orgId } })).toBe(0);
    });
  });

  describe('who may reopen, and when', () => {
    it('refuses anyone but the submitter', async () => {
      const claim = await rejected('500.00');

      const res = await reopen(claim.id, { lines: [line(400)] }, org.bobId).expect(403);

      expect(res.body.error.message).toMatch(/only the submitter/i);
      expect((await claimRow(claim.id)).status).toBe('REJECTED');
    });

    it('refuses a user without claims.create', async () => {
      const claim = await rejected('500.00');
      const outsider = await prisma.user.create({
        data: {
          orgId: org.orgId,
          email: `outsider-${Date.now()}@e2e.test`,
          name: 'outsider',
          permissions: ['projects.read'],
        },
      });

      const res = await reopen(claim.id, { lines: [line(400)] }, outsider.id).expect(403);

      expect(res.body.error.message).toMatch(/missing permission: claims\.create/i);
    });

    it.each(['DRAFT', 'SUBMITTED', 'APPROVED'] as const)(
      'refuses a claim that is %s',
      async (status) => {
        const claim = await create('500.00');
        if (status !== 'DRAFT') await submit(claim.id).expect(201);
        if (status === 'APPROVED') await approve(claim.id, org.carolId).expect(201);

        const res = await reopen(claim.id, { lines: [line(400)] }).expect(409);

        expect(res.body.error.message).toBe(`Claim is ${status}, expected REJECTED`);
        expect((await claimRow(claim.id)).revision).toBe(1);
      },
    );

    it("404s another org's rejected claim rather than 403", async () => {
      const other = await createTestOrg(prisma);
      try {
        const foreign = await request(app.getHttpServer())
          .post('/api/claims')
          .set(asUser(other, other.aliceId))
          .send({
            projectId: other.projectId,
            expenseDate: '2026-01-18',
            lines: [line(500)],
          })
          .expect(201);

        const res = await reopen(foreign.body.data.id, { lines: [line(400)] }).expect(404);
        expect(res.body.error.message).toMatch(/not found/i);
      } finally {
        await destroyTestOrg(prisma, other.orgId);
      }
    });
  });

  describe('concurrency', () => {
    it('two simultaneous reopens land on revision 2, not 3', async () => {
      const claim = await rejected('500.00');

      const results = await Promise.all([
        reopen(claim.id, { lines: [line(400)] }),
        reopen(claim.id, { lines: [line(300)] }),
      ]);

      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 409]);

      const row = await claimRow(claim.id);
      expect(row.revision).toBe(2);
      expect(row.status).toBe('DRAFT');
    });
  });
});
