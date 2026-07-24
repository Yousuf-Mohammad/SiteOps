import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { paginationMeta } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, query: ListProjectsDto) {
    const where = { orgId, ...(query.status ? { status: query.status } : {}) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.project.count({ where }),
    ]);
    return { data, meta: paginationMeta(total, query) };
  }

  async findOne(orgId: string, id: string) {
    const project = await this.prisma.project.findFirst({ where: { id, orgId } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async create(orgId: string, actorId: string, dto: CreateProjectDto) {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { orgId, code: dto.code, name: dto.name },
      });
      await this.audit.record(
        {
          orgId,
          actorId,
          action: 'project.created',
          entityType: 'project',
          entityId: project.id,
          after: { code: project.code, name: project.name },
        },
        tx as any,
      );
      return project;
    });
  }
}
