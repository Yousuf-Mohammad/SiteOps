import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Per-org named counters, safe under concurrency.
 *
 * The row is claimed with an atomic UPDATE ... RETURNING inside the caller's
 * transaction, so two requests can never be handed the same value. Always
 * call this from within the transaction that persists the numbered record —
 * if the transaction rolls back, the value is skipped (gaps are fine,
 * duplicates are not).
 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(tx: Prisma.TransactionClient, orgId: string, key: string): Promise<number> {
    const claimed = await tx.$queryRaw<{ value: number }[]>`
      UPDATE "NumberSequence"
      SET "nextValue" = "nextValue" + 1
      WHERE "orgId" = ${orgId} AND "key" = ${key}
      RETURNING "nextValue" - 1 AS value
    `;
    if (claimed.length > 0) return Number(claimed[0].value);

    // First use for this org+key: create the row, then claim from it.
    await tx.$executeRaw`
      INSERT INTO "NumberSequence" ("id", "orgId", "key", "nextValue")
      VALUES (${`seq_${orgId}_${key}`}, ${orgId}, ${key}, 1)
      ON CONFLICT ("orgId", "key") DO NOTHING
    `;
    return this.next(tx, orgId, key);
  }
}
