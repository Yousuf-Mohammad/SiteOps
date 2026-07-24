import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { AuditService } from '../audit/audit.service';
import { paginationMeta } from '../common/dto/pagination.dto';
import { SequenceService } from '../common/sequence/sequence.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { fyDateRange, fyForDate, resolveLevyRate } from './claim-fy';
import { CsvFormatError, planImport } from './claim-import';
import { computeTotals } from './claim-totals';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ListClaimsDto } from './dto/list-claims.dto';
import { ReopenClaimDto } from './dto/reopen-claim.dto';

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
   * Lodgment: a supervisor submitting their own draft for review.
   *
   * Ownership and state are both enforced *inside* the UPDATE's WHERE clause,
   * so of two racing submissions exactly one wins. A read-then-write would let
   * both through (TOCTOU) and audit the transition twice. The follow-up read
   * exists only to explain a `count === 0` — never to decide the outcome.
   */
  async submit(orgId: string, actorId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.claim.updateMany({
        where: { id, orgId, status: 'DRAFT', submitterId: actorId },
        data: { status: 'SUBMITTED' },
      });

      if (updated.count === 0) {
        const existing = await tx.claim.findFirst({
          where: { id, orgId },
          select: { status: true, submitterId: true },
        });
        if (!existing) throw new NotFoundException(`Claim ${id} not found`);
        // Ownership outranks state: someone who may not act on this claim at
        // all should be told that, not that the status is wrong.
        if (existing.submitterId !== actorId) {
          throw new ForbiddenException('Only the submitter can lodge this claim');
        }
        throw new ConflictException(`Claim is ${existing.status}, expected DRAFT`);
      }

      await this.audit.record(
        {
          orgId,
          actorId,
          action: 'claim.submitted',
          entityType: 'claim',
          entityId: id,
          before: { status: 'DRAFT' },
          after: { status: 'SUBMITTED' },
        },
        tx as any,
      );

      // Lodgment is audited, not published. The domain event is reserved for
      // final approval, which is what the burn dashboard consumes.
      return tx.claim.findFirstOrThrow({
        where: { id, orgId },
        include: { lines: true },
      });
    });
  }

  /**
   * Bulk import of a LegacyPlant export.
   *
   * Best-effort **per claim**: each valid group is created in its own
   * transaction through the ordinary `create` path, so a group that fails
   * cannot roll back groups already committed. Wrapping the whole import in one
   * transaction would be the opposite of what "best-effort" means.
   *
   * Reusing `create` rather than writing a bulk insert is deliberate — imported
   * claims get the same org validation, effective-dated rate, exact totals,
   * sequence-issued reference and audit row as any other claim. There is no
   * second code path to keep in step.
   */
  async importCsv(orgId: string, actorId: string, projectId: string, csv: string) {
    // Validate the project once, up front: if it is wrong, nothing in the file
    // can succeed and reporting it per group would be noise.
    const project = await this.prisma.project.findFirst({ where: { id: projectId, orgId } });
    if (!project) throw new BadRequestException('Unknown project');

    let plan;
    try {
      plan = planImport(csv);
    } catch (err) {
      if (err instanceof CsvFormatError) throw new BadRequestException(err.message);
      throw err;
    }

    const created: {
      group: string;
      id: string;
      reference: string;
      total: string;
      rows: number[];
    }[] = [];
    const rejected = [...plan.rejected];

    for (const group of plan.groups) {
      try {
        const claim = await this.create(
          { projectId, expenseDate: group.expenseDate, lines: group.lines },
          actorId,
          orgId,
        );
        created.push({
          group: group.group,
          id: claim.id,
          reference: claim.reference,
          total: claim.total.toString(),
          rows: group.rows,
        });
      } catch (err) {
        // A group that fails on write (e.g. no levy rate for its expense date)
        // is reported like any other bad group; the rest still import.
        rejected.push({
          group: group.group,
          rows: group.rows,
          reason: err instanceof HttpException ? (err.getResponse() as any).message : 'Failed to create claim',
        });
      }
    }

    return {
      created,
      rejected,
      summary: {
        groups: plan.groups.length + plan.rejected.length,
        created: created.length,
        rejected: rejected.length,
      },
    };
  }

  /** A second, different approver is required above this ex-GST total. */
  private static readonly TWO_KEY_THRESHOLD = new Decimal('1000.00');

  approve(orgId: string, actorId: string, id: string) {
    return this.decide(orgId, actorId, id, 'APPROVE');
  }

  reject(orgId: string, actorId: string, id: string) {
    return this.decide(orgId, actorId, id, 'REJECT');
  }

  /**
   * Approve or reject, with two independent guarantees that are easy to
   * conflate but do different jobs:
   *
   *  - `@@unique([claimId, actorId])` on ClaimDecision stops the *same person*
   *    turning both keys. That is a correctness rule, and it is enforced by
   *    Postgres rather than by a query the application could forget to run.
   *  - The expected status inside the updateMany WHERE stops *two different
   *    people* both winning the same transition. That is a concurrency rule.
   *
   * Neither substitutes for the other.
   */
  private async decide(orgId: string, actorId: string, id: string, action: 'APPROVE' | 'REJECT') {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.claim.findFirst({
        where: { id, orgId },
        select: {
          status: true,
          submitterId: true,
          total: true,
          reference: true,
          revision: true,
        },
      });
      if (!claim) throw new NotFoundException(`Claim ${id} not found`);

      // No self-dealing — not even as the second key. Checked explicitly and
      // first so the error names the real reason instead of surfacing later as
      // a confusing state conflict.
      if (claim.submitterId === actorId) {
        throw new ForbiddenException(
          `You cannot ${action.toLowerCase()} a claim you submitted`,
        );
      }

      // The brief says the two-key rule applies when the total *exceeds*
      // $1,000.00 — exactly $1,000.00 is one key. Compared as Decimal; a float
      // comparison here is precisely the kind of thing that works until it
      // doesn't.
      const needsTwoKeys = new Decimal(claim.total.toString()).greaterThan(
        ClaimsService.TWO_KEY_THRESHOLD,
      );

      const fromStatuses =
        action === 'REJECT' || needsTwoKeys ? ['SUBMITTED', 'PARTIALLY_APPROVED'] : ['SUBMITTED'];

      if (!fromStatuses.includes(claim.status)) {
        throw new ConflictException(
          `Claim is ${claim.status}, expected ${fromStatuses.join(' or ')}`,
        );
      }

      // A first key on a two-key claim parks it; everything else is terminal.
      const nextStatus =
        action === 'REJECT'
          ? 'REJECTED'
          : needsTwoKeys && claim.status === 'SUBMITTED'
            ? 'PARTIALLY_APPROVED'
            : 'APPROVED';

      const isFinalApproval = nextStatus === 'APPROVED';

      try {
        // Stamped with the revision being judged: the unique key is scoped to it,
        // so a correction resets the keys instead of locking out the approver
        // who asked for the correction.
        await tx.claimDecision.create({
          data: { claimId: id, revision: claim.revision, actorId, decision: action },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' // unique violation on (claimId, actorId)
        ) {
          throw new ConflictException(
            'You have already recorded a decision on this revision of the claim',
          );
        }
        throw err;
      }

      // Compare-and-swap on the *exact* status this decision was computed
      // from. Matching a set of acceptable statuses instead would let two
      // approvers racing on a SUBMITTED claim both succeed: the second would
      // find PARTIALLY_APPROVED — which the first had just written — still
      // inside the set, and overwrite it with the same value, burning a key
      // without advancing the claim.
      const updated = await tx.claim.updateMany({
        where: { id, orgId, status: claim.status },
        data: {
          status: nextStatus,
          // Denormalised "who finished it", only meaningful once final.
          ...(isFinalApproval ? { approvedBy: actorId, approvedAt: new Date() } : {}),
        },
      });

      if (updated.count === 0) {
        // Someone else moved the claim between the read above and this write.
        throw new ConflictException(
          'Claim was decided concurrently by someone else; please retry',
        );
      }

      const auditAction =
        action === 'REJECT'
          ? 'claim.rejected'
          : nextStatus === 'PARTIALLY_APPROVED'
            ? 'claim.partially_approved'
            : 'claim.approved';

      await this.audit.record(
        {
          orgId,
          actorId,
          action: auditAction,
          entityType: 'claim',
          entityId: id,
          before: { status: claim.status },
          after: { status: nextStatus },
        },
        tx as any,
      );

      // Only *final* approval is broadcast — that is the event the ledger and
      // the burn dashboard consume. A first key is an internal step.
      if (isFinalApproval) {
        await this.outbox.enqueue(tx, {
          orgId,
          type: 'claim.approved',
          payload: {
            claimId: id,
            reference: claim.reference,
            total: claim.total.toString(),
            approvedBy: actorId,
          },
        });
      }

      return tx.claim.findFirstOrThrow({
        where: { id, orgId },
        include: { lines: true, decisions: { orderBy: { createdAt: 'asc' } } },
      });
    });
  }

  /**
   * "Rejected claims usually come back around after the supervisor fixes them."
   *
   * The brief leaves this open; the resolution is to correct the claim in place
   * rather than to supersede it. A reopened claim keeps its reference — that
   * string is the claim's identity on the paper trail and in conversation, and
   * issuing `EXP 26-0012` for a corrected `EXP 26-0007` would leave two numbers
   * for one real-world expense. What changes instead is `revision`, which
   * records that the money underneath the reference moved.
   *
   * Correction and transition are one call. A separate edit endpoint would open
   * an editable-DRAFT surface the brief never asked for, and would let a
   * half-fixed claim exist between the two requests.
   *
   * Reopening is the mirror image of `submit`: same permission, same
   * submitter-only ownership, same conditional update, and the same 404/403/409
   * precedence when it does not apply.
   */
  async reopen(orgId: string, actorId: string, id: string, dto: ReopenClaimDto) {
    return this.prisma.$transaction(async (tx) => {
      // The snapshotted rate is read, never re-resolved. The claim was priced by
      // the rate in force the day the expense was incurred; that was settled at
      // creation, and fixing a typo in a quantity must not silently reprice the
      // claim because a newer rate has since taken effect.
      const before = await tx.claim.findFirst({
        where: { id, orgId },
        select: {
          status: true,
          submitterId: true,
          revision: true,
          total: true,
          levyRatePercent: true,
        },
      });
      if (!before) throw new NotFoundException(`Claim ${id} not found`);
      if (before.submitterId !== actorId) {
        throw new ForbiddenException('Only the submitter can reopen this claim');
      }

      const totals = dto.lines
        ? computeTotals(dto.lines, new Decimal(before.levyRatePercent.toString()))
        : null;

      // Status lives inside the WHERE, so two supervisors reopening the same
      // claim at once produce one reopen and one 409 — not revision 3.
      const updated = await tx.claim.updateMany({
        where: { id, orgId, status: 'REJECTED', submitterId: actorId },
        data: {
          status: 'DRAFT',
          revision: { increment: 1 },
          ...(totals
            ? {
                total: totals.total.toFixed(2),
                fuelSubtotal: totals.fuelSubtotal.toFixed(2),
                levyAmount: totals.levyAmount.toFixed(2),
              }
            : {}),
        },
      });

      if (updated.count === 0) {
        // Ownership and existence were checked above, so a miss here is either a
        // wrong status or a concurrent reopen; both are conflicts.
        const now = await tx.claim.findFirst({ where: { id, orgId }, select: { status: true } });
        throw new ConflictException(`Claim is ${now?.status ?? 'gone'}, expected REJECTED`);
      }

      if (dto.lines) {
        // Replace rather than patch: the corrected list is the claim's lines, and
        // reconciling ids would invent an identity for a line that has none.
        await tx.claimLine.deleteMany({ where: { claimId: id } });
        await tx.claimLine.createMany({
          data: dto.lines.map((l) => ({
            claimId: id,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            isFuel: l.isFuel ?? false,
          })),
        });
      }

      await this.audit.record(
        {
          orgId,
          actorId,
          action: 'claim.reopened',
          entityType: 'claim',
          entityId: id,
          before: {
            status: before.status,
            revision: before.revision,
            total: before.total.toFixed(2),
          },
          after: {
            status: 'DRAFT',
            revision: before.revision + 1,
            total: (totals?.total ?? new Decimal(before.total.toString())).toFixed(2),
            linesReplaced: Boolean(dto.lines),
          },
        },
        tx as any,
      );

      // Nothing is published. A claim going back for correction is internal
      // traffic; `claim.approved` stays the only domain event this module emits.
      return tx.claim.findFirstOrThrow({
        where: { id, orgId },
        include: { lines: true, decisions: { orderBy: { createdAt: 'asc' } } },
      });
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
