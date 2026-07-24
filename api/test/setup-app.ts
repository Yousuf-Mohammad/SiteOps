import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the real AppModule against the real Postgres.
 *
 * The app is configured exactly as `main.ts` does it — same global prefix, same
 * ValidationPipe — so the tests exercise the pipeline a request actually goes
 * through, including the response envelope and exception filter.
 */
export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

export interface TestOrg {
  orgId: string;
  projectId: string;
  /** Creator — has claims.create. */
  aliceId: string;
  /** A second creator, for "not the submitter" cases. */
  bobId: string;
  /** Approver — has claims.approve. */
  carolId: string;
  /** A second approver, for the two-key flow. */
  danId: string;
}

/**
 * Every run gets its own organization.
 *
 * That keeps the seeded roadco/pavecorp fixtures untouched, and — because the
 * org is brand new — its claim sequence starts at 1, so reference assertions
 * can expect EXP 26-0001 without depending on what else is in the database.
 */
export async function createTestOrg(prisma: PrismaService): Promise<TestOrg> {
  const suffix = randomBytes(6).toString('hex');

  const org = await prisma.organization.create({
    data: { slug: `e2e-${suffix}`, name: `E2E Org ${suffix}` },
  });

  const mkUser = (name: string, permissions: string[]) =>
    prisma.user.create({
      data: { orgId: org.id, email: `${name}-${suffix}@e2e.test`, name, permissions },
    });

  // Mirrors the real seed: supervisors can only create, site leads can create
  // *and* approve. Giving approvers `claims.create` matters — without it a
  // self-dealing test would be masked by a permission 403 and would pass for
  // the wrong reason.
  const [alice, bob, carol, dan] = await Promise.all([
    mkUser('alice', ['claims.create']),
    mkUser('bob', ['claims.create']),
    mkUser('carol', ['claims.create', 'claims.approve']),
    mkUser('dan', ['claims.create', 'claims.approve']),
  ]);

  const project = await prisma.project.create({
    data: { orgId: org.id, code: `E2E-${suffix.slice(0, 4).toUpperCase()}`, name: 'E2E Project' },
  });

  // Same effective-dated rates the seed installs: 10% from 2024-07-01, 12.5% from 2026-01-01.
  await prisma.surchargeRate.createMany({
    data: [
      { orgId: org.id, ratePercent: 10, effectiveFrom: new Date('2024-07-01') },
      { orgId: org.id, ratePercent: 12.5, effectiveFrom: new Date('2026-01-01') },
    ],
  });

  return {
    orgId: org.id,
    projectId: project.id,
    aliceId: alice.id,
    bobId: bob.id,
    carolId: carol.id,
    danId: dan.id,
  };
}

/** Removes everything the run created. Order respects the foreign keys. */
export async function destroyTestOrg(prisma: PrismaService, orgId: string) {
  const claims = await prisma.claim.findMany({ where: { orgId }, select: { id: true } });
  const claimIds = claims.map((c) => c.id);

  await prisma.claimDecision.deleteMany({ where: { claimId: { in: claimIds } } });
  await prisma.claimLine.deleteMany({ where: { claimId: { in: claimIds } } });
  await prisma.claim.deleteMany({ where: { orgId } });
  await prisma.auditLog.deleteMany({ where: { orgId } });
  await prisma.outboxEvent.deleteMany({ where: { orgId } });
  await prisma.note.deleteMany({ where: { orgId } });
  await prisma.numberSequence.deleteMany({ where: { orgId } });
  await prisma.surchargeRate.deleteMany({ where: { orgId } });
  await prisma.project.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
}

/** Fake-session headers for a given actor. */
export const asUser = (org: TestOrg, userId: string) => ({
  'x-user-id': userId,
  'x-org-id': org.orgId,
});
