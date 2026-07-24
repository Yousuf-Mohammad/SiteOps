import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { asUser, createTestApp, createTestOrg, destroyTestOrg, TestOrg } from './setup-app';

const HEADER = 'expense_date,description,quantity,unit_price,is_fuel,group';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('POST /api/claims/import', () => {
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

  const upload = (body: string, opts: { projectId?: string; actorId?: string } = {}) =>
    request(app.getHttpServer())
      .post('/api/claims/import')
      .set(asUser(org, opts.actorId ?? org.aliceId))
      .field('projectId', opts.projectId ?? org.projectId)
      .attach('file', Buffer.from(body, 'utf8'), 'export.csv');

  describe('the gate: a mixed file', () => {
    it('creates the good claim and reports the bad group with its row numbers', async () => {
      const res = await upload(
        csv(
          '2026-01-18,Diesel,3,19.99,true,G1',
          '2026-01-18,Broken,notanumber,10.00,false,G2',
          '2026-01-18,Cones,2,15.00,false,G1',
        ),
      ).expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.created).toHaveLength(1);
      expect(res.body.data.created[0].group).toBe('G1');
      expect(res.body.data.rejected).toHaveLength(1);
      expect(res.body.data.rejected[0]).toMatchObject({ group: 'G2', rows: [3] });
      expect(res.body.data.rejected[0].reason).toMatch(/quantity/i);
      expect(res.body.data.summary).toEqual({ groups: 2, created: 1, rejected: 1 });

      // The good claim really exists, with both of its lines.
      const claims = await prisma.claim.findMany({
        where: { orgId: org.orgId },
        include: { lines: true },
      });
      expect(claims).toHaveLength(1);
      expect(claims[0].lines).toHaveLength(2);
    });

    it('rejects a whole claim when only one of its lines is bad', async () => {
      const res = await upload(
        csv('2026-01-18,Fine,1,10.00,false,G1', '2026-01-18,Bad,1,10.005,false,G1'),
      ).expect(201);

      expect(res.body.data.created).toHaveLength(0);
      expect(res.body.data.rejected[0].rows).toEqual([2, 3]);
      expect(await prisma.claim.count({ where: { orgId: org.orgId } })).toBe(0);
    });
  });

  describe('the quoted price', () => {
    it('stores "1,299.50" as 1299.50, not 1.00', async () => {
      const res = await upload(
        csv('2026-01-18,"Excavator hire, weekly",1,"1,299.50",false,G1'),
      ).expect(201);

      expect(res.body.data.created).toHaveLength(1);
      const claim = await prisma.claim.findFirstOrThrow({
        where: { orgId: org.orgId },
        include: { lines: true },
      });
      expect(claim.lines[0].unitPrice.toFixed(2)).toBe('1299.50');
      expect(claim.lines[0].description).toBe('Excavator hire, weekly');
      expect(claim.total.toFixed(2)).toBe('1299.50');
    });
  });

  describe('imported claims are ordinary claims', () => {
    it('gets a proper reference, DRAFT status and a snapshotted levy', async () => {
      const res = await upload(csv('2026-01-18,Diesel,3,19.99,true,G1')).expect(201);

      const claim = await prisma.claim.findFirstOrThrow({ where: { orgId: org.orgId } });
      expect(res.body.data.created[0].reference).toBe('EXP 26-0001');
      expect(claim.status).toBe('DRAFT');
      expect(claim.levyRatePercent.toFixed(2)).toBe('12.50');
      // Golden #1 arriving via CSV.
      expect(claim.total.toFixed(2)).toBe('67.47');
      expect(claim.submitterId).toBe(org.aliceId);
    });

    it('numbers multiple groups from the shared sequence', async () => {
      const res = await upload(
        csv(
          '2026-01-18,A,1,10.00,false,G1',
          '2026-01-18,B,1,10.00,false,G2',
          '2026-01-18,C,1,10.00,false,G3',
        ),
      ).expect(201);

      expect(res.body.data.created.map((c: any) => c.reference)).toEqual([
        'EXP 26-0001',
        'EXP 26-0002',
        'EXP 26-0003',
      ]);
    });

    it('writes a claim.created audit row per imported claim', async () => {
      await upload(csv('2026-01-18,A,1,10.00,false,G1', '2026-01-18,B,1,10.00,false,G2')).expect(
        201,
      );

      const audits = await prisma.auditLog.findMany({
        where: { orgId: org.orgId, action: 'claim.created' },
      });
      expect(audits).toHaveLength(2);
    });

    it('derives the FY from each expense date', async () => {
      const res = await upload(
        csv('2026-06-30,A,1,10.00,false,G1', '2026-07-01,B,1,10.00,false,G2'),
      ).expect(201);

      expect(res.body.data.created.map((c: any) => c.reference)).toEqual([
        'EXP 26-0001',
        'EXP 27-0001',
      ]);
    });
  });

  describe('best-effort really is per claim', () => {
    it('keeps earlier claims when a later group fails on write', async () => {
      // The second group has no levy rate in force (predates every rate), so it
      // fails inside create() — after the first has already committed.
      const res = await upload(
        csv('2026-01-18,Good,1,10.00,false,G1', '2020-01-01,TooOld,1,10.00,true,G2'),
      ).expect(201);

      expect(res.body.data.created.map((c: any) => c.group)).toEqual(['G1']);
      expect(res.body.data.rejected.map((r: any) => r.group)).toEqual(['G2']);
      expect(res.body.data.rejected[0].reason).toMatch(/no surcharge rate/i);
      expect(await prisma.claim.count({ where: { orgId: org.orgId } })).toBe(1);
    });
  });

  describe('grouping', () => {
    it('collapses non-contiguous rows of the same group into one claim', async () => {
      const res = await upload(
        csv(
          '2026-01-18,A,1,10.00,false,G1',
          '2026-01-18,X,1,20.00,false,G2',
          '2026-01-18,B,1,5.00,false,G1',
        ),
      ).expect(201);

      expect(res.body.data.created).toHaveLength(2);
      const g1 = await prisma.claim.findFirstOrThrow({
        where: { id: res.body.data.created.find((c: any) => c.group === 'G1').id },
        include: { lines: true },
      });
      expect(g1.lines).toHaveLength(2);
      expect(g1.total.toFixed(2)).toBe('15.00');
    });

    it('rejects a group whose rows disagree on expense_date', async () => {
      const res = await upload(
        csv('2026-01-18,A,1,10.00,false,G1', '2026-02-10,B,1,10.00,false,G1'),
      ).expect(201);

      expect(res.body.data.created).toHaveLength(0);
      expect(res.body.data.rejected[0].reason).toMatch(/disagree on expense_date/);
    });
  });

  describe('file-level problems are 400, not a per-group report', () => {
    it('rejects a file with missing columns', async () => {
      const res = await upload('expense_date,description\n2026-01-18,x').expect(400);

      expect(res.body.error.message).toMatch(/missing required column/i);
    });

    it('rejects an empty file', async () => {
      const res = await upload('').expect(400);

      expect(res.body.error.message).toMatch(/empty|required/i);
    });

    it('rejects headers with no data rows', async () => {
      const res = await upload(HEADER).expect(400);

      expect(res.body.error.message).toMatch(/no rows/i);
    });

    it('rejects a missing file', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/claims/import')
        .set(asUser(org, org.aliceId))
        .field('projectId', org.projectId)
        .expect(400);

      expect(res.body.error.message).toMatch(/csv file is required/i);
    });

    it('rejects a missing projectId', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/claims/import')
        .set(asUser(org, org.aliceId))
        .attach('file', Buffer.from(csv('2026-01-18,A,1,10.00,false,G1')), 'export.csv')
        .expect(400);

      expect(res.body.error.message).toMatch(/projectid is required/i);
    });

    it("rejects another org's projectId", async () => {
      const other = await createTestOrg(prisma);
      try {
        const res = await upload(csv('2026-01-18,A,1,10.00,false,G1'), {
          projectId: other.projectId,
        }).expect(400);

        expect(res.body.error.message).toBe('Unknown project');
        expect(await prisma.claim.count({ where: { orgId: org.orgId } })).toBe(0);
      } finally {
        await destroyTestOrg(prisma, other.orgId);
      }
    });
  });

  describe('csv quirks survive the round trip', () => {
    it('tolerates a UTF-8 BOM and CRLF line endings', async () => {
      const body =
        '﻿' +
        [HEADER, '2026-01-18,Diesel,3,19.99,true,G1'].join('\r\n');

      const res = await upload(body).expect(201);

      expect(res.body.data.created).toHaveLength(1);
    });

    it('skips blank and whitespace-only rows while keeping row numbers honest', async () => {
      const body = [HEADER, '', '2026-01-18,A,1,10.00,false,G1', '   ', '2026-01-18,B,x,1.00,false,G2'].join(
        '\n',
      );

      const res = await upload(body).expect(201);

      expect(res.body.data.created).toHaveLength(1);
      expect(res.body.data.rejected[0].rows).toEqual([5]);
    });
  });

  describe('permissions', () => {
    it('requires claims.create', async () => {
      const outsider = await prisma.user.create({
        data: {
          orgId: org.orgId,
          email: `nobody-${Date.now()}@e2e.test`,
          name: 'nobody',
          permissions: ['projects.read'],
        },
      });

      const res = await upload(csv('2026-01-18,A,1,10.00,false,G1'), {
        actorId: outsider.id,
      }).expect(403);

      expect(res.body.error.message).toMatch(/missing permission: claims\.create/i);
      expect(await prisma.claim.count({ where: { orgId: org.orgId } })).toBe(0);
    });
  });
});
