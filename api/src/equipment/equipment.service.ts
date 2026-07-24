import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { paginationMeta } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { ListEquipmentDto } from './dto/list-equipment.dto';

@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, query: ListEquipmentDto) {
    const where = { orgId, ...(query.category ? { category: query.category } : {}) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({
        where,
        orderBy: [{ assetCode: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.equipment.count({ where }),
    ]);
    return { data, meta: paginationMeta(total, query) };
  }

  async findOne(orgId: string, id: string) {
    const item = await this.prisma.equipment.findFirst({ where: { id, orgId } });
    if (!item) throw new NotFoundException('Equipment not found');
    return item;
  }

  async create(orgId: string, actorId: string, dto: CreateEquipmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.equipment.create({
        data: {
          orgId,
          assetCode: dto.assetCode,
          name: dto.name,
          category: dto.category,
          hireRatePerDay: dto.hireRatePerDay,
        },
      });
      await this.audit.record(
        {
          orgId,
          actorId,
          action: 'equipment.created',
          entityType: 'equipment',
          entityId: item.id,
          after: { assetCode: item.assetCode, hireRatePerDay: dto.hireRatePerDay },
        },
        tx as any,
      );
      return item;
    });
  }
}
