import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { paginationMeta } from '../common/dto/pagination.dto';
import { SequenceService } from '../common/sequence/sequence.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocketDto } from './dto/create-docket.dto';
import { ListDocketsDto } from './dto/list-dockets.dto';

@Injectable()
export class DocketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, query: ListDocketsDto) {
    const where = {
      orgId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.docket.findMany({
        where,
        include: {
          project: { select: { code: true } },
          equipment: { select: { assetCode: true, name: true } },
        },
        orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.docket.count({ where }),
    ]);
    return { data, meta: paginationMeta(total, query) };
  }

  async create(orgId: string, actorId: string, dto: CreateDocketDto) {
    // Referenced records must belong to the acting org — never trust ids from the client.
    const [project, equipment] = await Promise.all([
      this.prisma.project.findFirst({ where: { id: dto.projectId, orgId } }),
      this.prisma.equipment.findFirst({ where: { id: dto.equipmentId, orgId } }),
    ]);
    if (!project) throw new BadRequestException('Unknown project');
    if (!equipment) throw new BadRequestException('Unknown equipment');

    return this.prisma.$transaction(async (tx) => {
      const value = await this.sequence.next(tx, orgId, 'docket');
      const docket = await tx.docket.create({
        data: {
          orgId,
          projectId: dto.projectId,
          equipmentId: dto.equipmentId,
          docketNumber: `PD-${String(value).padStart(5, '0')}`,
          workDate: new Date(dto.workDate),
          hours: dto.hours,
          notes: dto.notes,
          submittedById: actorId,
        },
      });
      await this.audit.record(
        {
          orgId,
          actorId,
          action: 'docket.created',
          entityType: 'docket',
          entityId: docket.id,
          after: { docketNumber: docket.docketNumber, hours: dto.hours },
        },
        tx as any,
      );
      return docket;
    });
  }

  /**
   * Confirming is final. The status check lives INSIDE the UPDATE's WHERE
   * clause, so of two racing confirmations exactly one wins — a read-then-write
   * here would let both through (TOCTOU).
   */
  async confirm(orgId: string, actorId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.docket.updateMany({
        where: { id, orgId, status: 'DRAFT' },
        data: { status: 'CONFIRMED', confirmedById: actorId, confirmedAt: new Date() },
      });
      if (updated.count === 0) {
        const exists = await tx.docket.findFirst({ where: { id, orgId }, select: { status: true } });
        if (!exists) throw new NotFoundException('Docket not found');
        throw new ConflictException(`Docket is ${exists.status}, expected DRAFT`);
      }

      const docket = await tx.docket.findFirstOrThrow({ where: { id, orgId } });
      await this.audit.record(
        {
          orgId,
          actorId,
          action: 'docket.confirmed',
          entityType: 'docket',
          entityId: id,
          before: { status: 'DRAFT' },
          after: { status: 'CONFIRMED' },
        },
        tx as any,
      );
      // Event row commits with the state change; the relay delivers after commit.
      await this.outbox.enqueue(tx, {
        orgId,
        type: 'docket.confirmed',
        payload: { docketId: id, docketNumber: docket.docketNumber },
      });
      return docket;
    });
  }
}
