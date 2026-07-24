import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { asUser, createTestApp, createTestOrg, destroyTestOrg, TestOrg } from './setup-app';

const line = (unitPrice: number, isFuel = false) => ({
  description: 'item',
  quantity: 1,
  unitPrice,
  isFuel,
});

describe('GET /api/claims and /api/claims/:id', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: TestOrg;
  let otherOrg: TestOrg;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    org = await createTestOrg(prisma);
    otherOrg = await createTestOrg(prisma);
  });

  afterEach(async () => {
    await destroyTestOrg(prisma, org.orgId);
    await destroyTestOrg(prisma, otherOrg.orgId);
  });

  afterAll(async () => {
    await app.close();
  });

  const createClaim = async (target: TestOrg, expenseDate: string, unitPrice = 10) => {
    const res = await request(app.getHttpServer())
      .post('/api/claims')
      .set(asUser(target, target.aliceId))
      .send({ projectId: target.projectId, expenseDate, lines: [line(unitPrice)] })
      .expect(201);
    return res.body.data;
  };

  const list = (query = '') =>
    request(app.getHttpServer()).get(`/api/claims${query}`).set(asUser(org, org.aliceId));

  const detail = (id: string, actor: TestOrg = org) =>
    request(app.getHttpServer()).get(`/api/claims/${id}`).set(asUser(actor, actor.aliceId));

  describe('cross-tenant isolation', () => {
    it("404s on another org's claim instead of returning it", async () => {
      const foreign = await createClaim(otherOrg, '2026-02-10');

      const res = await detail(foreign.id).expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.data).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(foreign.reference);
    });

    it('makes a foreign claim indistinguishable from a nonexistent one', async () => {
      const foreign = await createClaim(otherOrg, '2026-02-10');

      const foreignRes = await detail(foreign.id).expect(404);
      const missingRes = await detail('cl00000000000000000000000').expect(404);

      expect(foreignRes.body.error.code).toBe(missingRes.body.error.code);
    });

    it("never lists another org's claims", async () => {
      await createClaim(otherOrg, '2026-02-10');
      await createClaim(otherOrg, '2026-03-02');
      const mine = await createClaim(org, '2026-02-10');

      const res = await list().expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(mine.id);
      expect(res.body.meta.total).toBe(1);
    });

    it('lets each org hold the same reference independently', async () => {
      const mine = await createClaim(org, '2026-02-10');
      const theirs = await createClaim(otherOrg, '2026-02-10');

      expect(mine.reference).toBe('EXP 26-0001');
      expect(theirs.reference).toBe('EXP 26-0001');
      expect(mine.id).not.toBe(theirs.id);
    });
  });

  describe('pagination', () => {
    it('reports meta and honours page/pageSize', async () => {
      for (let i = 0; i < 5; i++) await createClaim(org, '2026-02-10');

      const res = await list('?page=1&pageSize=2').expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toEqual({ total: 5, page: 1, pageSize: 2, pageCount: 3 });
    });

    it('defaults to page 1 with a pageSize of 20', async () => {
      await createClaim(org, '2026-02-10');

      const res = await list().expect(200);

      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20 });
    });

    it('walks every page exactly once — no duplicates, no omissions', async () => {
      const created: any[] = [];
      for (let i = 0; i < 7; i++) created.push(await createClaim(org, '2026-02-10'));

      const seen: string[] = [];
      for (let page = 1; page <= 4; page++) {
        const res = await list(`?page=${page}&pageSize=2`).expect(200);
        seen.push(...res.body.data.map((c: any) => c.id));
      }

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      expect([...seen].sort()).toEqual(created.map((c) => c.id).sort());
    });

    it('returns an empty page rather than erroring past the end', async () => {
      await createClaim(org, '2026-02-10');

      const res = await list('?page=99&pageSize=20').expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe('filters', () => {
    it('filters by status', async () => {
      await createClaim(org, '2026-02-10');
      await createClaim(org, '2026-03-02');

      const drafts = await list('?status=DRAFT').expect(200);
      const approved = await list('?status=APPROVED').expect(200);

      expect(drafts.body.meta.total).toBe(2);
      expect(approved.body.meta.total).toBe(0);
    });

    it('filters by FY as a real date range, not a reference match', async () => {
      const lastDayFy26 = await createClaim(org, '2026-06-30');
      const firstDayFy27 = await createClaim(org, '2026-07-01');

      const fy26 = await list('?fy=26').expect(200);
      const fy27 = await list('?fy=27').expect(200);

      expect(fy26.body.data.map((c: any) => c.id)).toEqual([lastDayFy26.id]);
      expect(fy27.body.data.map((c: any) => c.id)).toEqual([firstDayFy27.id]);
    });

    it('includes the first day of the FY', async () => {
      const firstDay = await createClaim(org, '2025-07-01');

      const res = await list('?fy=26').expect(200);

      expect(res.body.data.map((c: any) => c.id)).toContain(firstDay.id);
    });

    it('combines status and FY', async () => {
      await createClaim(org, '2026-02-10');
      await createClaim(org, '2026-08-01');

      const res = await list('?status=DRAFT&fy=26').expect(200);

      expect(res.body.meta.total).toBe(1);
    });

    it('rejects an unknown status', async () => {
      await list('?status=NONSENSE').expect(400);
    });

    it('rejects a pageSize above the allowed maximum', async () => {
      await list('?pageSize=500').expect(400);
    });
  });

  describe('detail payload', () => {
    it('returns lines, decisions and audit history', async () => {
      const created = await createClaim(org, '2026-01-18');

      const res = await detail(created.id).expect(200);

      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.decisions).toEqual([]); // none until the approval phase
      expect(res.body.data.audit).toHaveLength(1);
      expect(res.body.data.audit[0].action).toBe('claim.created');
      expect(res.body.data.project).toMatchObject({ code: expect.any(String) });
    });

    it('carries the money snapshot', async () => {
      const created = await createClaim(org, '2026-01-18');

      const res = await detail(created.id).expect(200);

      expect(res.body.data).toMatchObject({
        levyRatePercent: expect.any(String),
        fuelSubtotal: expect.any(String),
        levyAmount: expect.any(String),
        total: expect.any(String),
      });
    });
  });

  describe('list payload', () => {
    it('omits line items but keeps the totals and project', async () => {
      await createClaim(org, '2026-02-10');

      const res = await list().expect(200);
      const row = res.body.data[0];

      expect(row.lines).toBeUndefined();
      expect(row).toMatchObject({
        reference: expect.any(String),
        status: 'DRAFT',
        total: expect.any(String),
        project: { code: expect.any(String), name: expect.any(String) },
      });
    });

    it('orders by expense date, newest first', async () => {
      const older = await createClaim(org, '2026-01-05');
      const newer = await createClaim(org, '2026-05-20');

      const res = await list().expect(200);

      expect(res.body.data.map((c: any) => c.id)).toEqual([newer.id, older.id]);
    });
  });
});
