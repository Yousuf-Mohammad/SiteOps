import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../common/sequence/sequence.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { fyForDate, resolveLevyRate } from './claim-fy';
import { computeTotals } from './claim-totals';
import { CreateClaimDto } from './dto/create-claim.dto';

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

  async findAll(orgId: string) {
    return this.prisma.claim.findMany({
      where: { orgId },
      include: { lines: true, project: { select: { code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!claim) {
      throw new NotFoundException(`Claim ${id} not found`);
    }
    return claim;
  }
}
