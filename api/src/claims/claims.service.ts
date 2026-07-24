import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { paginationMeta } from '../common/dto/pagination.dto';
import { SequenceService } from '../common/sequence/sequence.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { fyDateRange, fyForDate, resolveLevyRate } from './claim-fy';
import { computeTotals } from './claim-totals';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ListClaimsDto } from './dto/list-claims.dto';

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateClaimDto, userId: string, orgId: string) {
    // Referenced records must belong to the acting org — never trust ids from the client.
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, orgId },
    });
    if (!project) throw new BadRequestException('Unknown project');

    const expenseDate = new Date(dto.expenseDate);
    // FY comes from the expense date alone, so the reference is reproducible.
    const fy = fyForDate(expenseDate);

    return this.prisma.$transaction(async (tx) => {
      // Resolve the rate and claim the sequence number in the same transaction
      // that writes the row: the rate that prices the claim and the record of
      // it are decided together, and a rollback skips the number rather than
      // reusing it (gaps are fine, duplicates are not).
      const rates = await tx.surchargeRate.findMany({ where: { orgId } });
      let levyRatePercent;
      try {
        levyRatePercent = resolveLevyRate(rates, expenseDate);
      } catch (err) {
        // A missing rate is a configuration fault, not a server error.
        throw new BadRequestException((err as Error).message);
      }

      const totals = computeTotals(dto.lines, levyRatePercent);
      const value = await this.sequence.next(tx, orgId, `claim:${fy}`);
      const reference = `EXP ${String(fy).padStart(2, '0')}-${String(value).padStart(4, '0')}`;

      const claim = await tx.claim.create({
        data: {
          orgId,
          projectId: dto.projectId,
          submitterId: userId,
          reference,
          // Always DRAFT. Status is never taken from the request body.
          status: 'DRAFT',
          expenseDate,
          total: totals.total.toFixed(2),
          levyRatePercent: levyRatePercent.toFixed(2),
          fuelSubtotal: totals.fuelSubtotal.toFixed(2),
          levyAmount: totals.levyAmount.toFixed(2),
          lines: {
            create: dto.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              isFuel: l.isFuel ?? false,
            })),
          },
        },
        include: { lines: true },
      });

      await this.audit.record(
        {
          orgId,
          actorId: userId,
          action: 'claim.created',
          entityType: 'claim',
          entityId: claim.id,
          after: {
            reference: claim.reference,
            status: claim.status,
            total: totals.total.toFixed(2),
            levyRatePercent: levyRatePercent.toFixed(2),
          },
        },
        tx as any,
      );

      return claim;
    });
  }

  /**
   * Paginated, filterable list for the acting org.
   *
   * Line items are deliberately not included — the list shows references and
   * totals, and fanning out a join per row costs more than it returns. The
   * detail endpoint carries them.
   */
  async list(orgId: string, query: ListClaimsDto) {
    const where = {
      orgId,
      ...(query.status ? { status: query.status } : {}),
      // FY is a date range over the expense date, never a string match on the
      // reference — a reference is a label, the expense date is the fact.
      ...(query.fy !== undefined ? { expenseDate: fyDateRange(query.fy) } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.claim.findMany({
        where,
        include: { project: { select: { code: true, name: true } } },
        // The id tiebreak keeps paging stable: without it, claims sharing an
        // expenseDate can reorder between requests, so a row is seen twice or
        // skipped entirely.
        orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.claim.count({ where }),
    ]);

    return { data, meta: paginationMeta(total, query) };
  }

  /**
   * Detail for one claim, scoped to the acting org.
   *
   * A claim belonging to another org 404s exactly as a nonexistent id does —
   * anything else (403, or a different message) would confirm the id is real,
   * which is itself a leak.
   */
  async findOne(orgId: string, id: string) {
    const claim = await this.prisma.claim.findFirst({
      where: { id, orgId },
      include: {
        lines: true,
        decisions: { orderBy: { createdAt: 'asc' } },
        project: { select: { code: true, name: true } },
      },
    });
    if (!claim) {
      throw new NotFoundException(`Claim ${id} not found`);
    }

    // AuditLog has no relation to Claim, so it is fetched through the kernel
    // service rather than joined.
    const audit = await this.audit.forEntity(orgId, 'claim', id);

    return { ...claim, audit };
  }
}
