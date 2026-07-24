import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { asUser, createTestApp, createTestOrg, destroyTestOrg, TestOrg } from './setup-app';

/** Golden #1 from the brief: 3 x $19.99 fuel @ 12.5% -> $67.47. */
const GOLDEN_ONE = [{ description: 'Unleaded for gen-set', quantity: 3, unitPrice: 19.99, isFuel: true }];

describe('POST /api/claims', () => {
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

  const post = (body: object, userId?: string) =>
    request(app.getHttpServer())
      .post('/api/claims')
      .set(asUser(org, userId ?? org.aliceId))
      .send(body);

  const claimBody = (overrides: Record<string, unknown> = {}) => ({
    projectId: org.projectId,
    expenseDate: '2026-01-18',
    lines: GOLDEN_ONE,
    ...overrides,
  });

  describe('reference issuing', () => {
    it('formats the reference as "EXP <fy>-<seq>" with a space', async () => {
      const res = await post(claimBody()).expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.reference).toBe('EXP 26-0001');
      expect(res.body.data.reference).toMatch(/^EXP \d{2}-\d{4}$/);
    });

    it('derives the FY from the expense date, not today', async () => {
      // 2026-08-01 falls in FY27 even though "now" is in FY26.
      const res = await post(claimBody({ expenseDate: '2026-08-01' })).expect(201);

      expect(res.body.data.reference).toBe('EXP 27-0001');
    });

    it('issues sequential references with no reuse and no gap at the start', async () => {
      const refs: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await post(claimBody()).expect(201);
        refs.push(res.body.data.reference);
      }

      expect(refs).toEqual(['EXP 26-0001', 'EXP 26-0002', 'EXP 26-0003']);
    });

    it('numbers each financial year independently', async () => {
      await post(claimBody({ expenseDate: '2026-02-10' })).expect(201); // FY26 -> 0001
      const fy27 = await post(claimBody({ expenseDate: '2026-08-01' })).expect(201);
      const fy26 = await post(claimBody({ expenseDate: '2026-03-02' })).expect(201);

      expect(fy27.body.data.reference).toBe('EXP 27-0001');
      expect(fy26.body.data.reference).toBe('EXP 26-0002');
    });

    /**
     * The test the starter's `claim.count() + 1` could not pass: concurrent
     * requests both read the same count and mint the same reference.
     */
    it('issues distinct references under concurrent creates', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => post(claimBody())));

      results.forEach((r) => expect(r.status).toBe(201));
      const refs = results.map((r) => r.body.data.reference);
      expect(new Set(refs).size).toBe(5);
      expect([...refs].sort()).toEqual([
        'EXP 26-0001',
        'EXP 26-0002',
        'EXP 26-0003',
        'EXP 26-0004',
        'EXP 26-0005',
      ]);
    });
  });

  describe('money', () => {
    it('stores golden #1 as 67.47 with the levy snapshot', async () => {
      const res = await post(claimBody()).expect(201);

      const stored = await prisma.claim.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(stored.total.toFixed(2)).toBe('67.47');
      expect(stored.fuelSubtotal.toFixed(2)).toBe('59.97');
      expect(stored.levyAmount.toFixed(2)).toBe('7.50');
      expect(stored.levyRatePercent.toFixed(2)).toBe('12.50');
    });

    it('stores golden #2 as 7.25 — the levy touches only the fuel subtotal', async () => {
      const res = await post(
        claimBody({
          lines: [
            { description: 'Fuel A', quantity: 1, unitPrice: 1.0, isFuel: true },
            { description: 'Fuel B', quantity: 1, unitPrice: 1.0, isFuel: true },
            { description: 'Not fuel', quantity: 1, unitPrice: 5.0, isFuel: false },
          ],
        }),
      ).expect(201);

      const stored = await prisma.claim.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(stored.total.toFixed(2)).toBe('7.25');
      expect(stored.levyAmount.toFixed(2)).toBe('0.25');
    });

    it('applies the rate in force on the expense date, not the latest one', async () => {
      const res = await post(claimBody({ expenseDate: '2025-12-31' })).expect(201);

      const stored = await prisma.claim.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(stored.levyRatePercent.toFixed(2)).toBe('10.00');
      expect(stored.total.toFixed(2)).toBe('65.97');
    });

    it('rejects an expense date with no rate in force with a 400, not a 500', async () => {
      const res = await post(claimBody({ expenseDate: '2024-01-01' })).expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/no surcharge rate/i);
    });

    it('keeps the stored parts reconcilable with the total', async () => {
      const res = await post(claimBody()).expect(201);

      const stored = await prisma.claim.findUniqueOrThrow({
        where: { id: res.body.data.id },
        include: { lines: true },
      });
      const nonFuel = stored.lines
        .filter((l) => !l.isFuel)
        .reduce((sum, l) => sum + Number(l.unitPrice) * l.quantity, 0);
      const recomputed = Number(stored.fuelSubtotal) + Number(stored.levyAmount) + nonFuel;
      expect(recomputed.toFixed(2)).toBe(stored.total.toFixed(2));
    });
  });

  describe('status cannot come from the client', () => {
    it('ignores a status in the body and creates the claim as DRAFT', async () => {
      const res = await post(claimBody({ status: 'APPROVED' })).expect(201);

      expect(res.body.data.status).toBe('DRAFT');
      const stored = await prisma.claim.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(stored.status).toBe('DRAFT');
      expect(stored.approvedBy).toBeNull();
    });
  });

  describe('org scoping', () => {
    it('rejects an unknown projectId', async () => {
      const res = await post(claimBody({ projectId: 'does-not-exist' })).expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Unknown project');
    });

    it("rejects another org's projectId", async () => {
      const other = await createTestOrg(prisma);
      try {
        const res = await post(claimBody({ projectId: other.projectId })).expect(400);
        expect(res.body.error.message).toBe('Unknown project');
      } finally {
        await destroyTestOrg(prisma, other.orgId);
      }
    });

    it('records the acting user as the submitter', async () => {
      const res = await post(claimBody(), org.bobId).expect(201);

      expect(res.body.data.submitterId).toBe(org.bobId);
    });
  });

  describe('validation', () => {
    it('rejects a claim with no lines', async () => {
      await post(claimBody({ lines: [] })).expect(400);
    });

    it('rejects a unitPrice with more than two decimal places', async () => {
      await post(
        claimBody({ lines: [{ description: 'x', quantity: 1, unitPrice: 19.999, isFuel: true }] }),
      ).expect(400);
    });

    it('rejects a negative unitPrice', async () => {
      await post(
        claimBody({ lines: [{ description: 'x', quantity: 1, unitPrice: -5, isFuel: true }] }),
      ).expect(400);
    });

    it('rejects a zero or fractional quantity', async () => {
      await post(
        claimBody({ lines: [{ description: 'x', quantity: 0, unitPrice: 5, isFuel: true }] }),
      ).expect(400);
      await post(
        claimBody({ lines: [{ description: 'x', quantity: 1.5, unitPrice: 5, isFuel: true }] }),
      ).expect(400);
    });

    it('rejects a malformed expense date', async () => {
      await post(claimBody({ expenseDate: 'not-a-date' })).expect(400);
    });
  });

  describe('audit trail', () => {
    it('writes a claim.created audit row in the same transaction', async () => {
      const res = await post(claimBody()).expect(201);

      const audits = await prisma.auditLog.findMany({
        where: { orgId: org.orgId, entityType: 'claim', entityId: res.body.data.id },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe('claim.created');
      expect(audits[0].actorId).toBe(org.aliceId);
      expect(audits[0].after).toMatchObject({ reference: 'EXP 26-0001', status: 'DRAFT' });
    });

    it('leaves no claim, no sequence burn and no audit row when creation fails', async () => {
      await post(claimBody({ projectId: 'does-not-exist' })).expect(400);

      expect(await prisma.claim.count({ where: { orgId: org.orgId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { orgId: org.orgId } })).toBe(0);

      // The next successful create still starts at 0001.
      const res = await post(claimBody()).expect(201);
      expect(res.body.data.reference).toBe('EXP 26-0001');
    });
  });

  describe('response envelope', () => {
    it('wraps success in the platform envelope', async () => {
      const res = await post(claimBody()).expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.timestamp).toEqual(expect.any(String));
      expect(res.body.data.lines).toHaveLength(1);
    });

    it('wraps errors in the platform envelope', async () => {
      const res = await post(claimBody({ projectId: 'nope' })).expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatchObject({ code: expect.any(String), message: expect.any(String) });
      expect(res.body.timestamp).toEqual(expect.any(String));
    });
  });
});
