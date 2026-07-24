import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClaimDto } from './dto/create-claim.dto';

@Injectable()
export class ClaimsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClaimDto, userId: string, orgId: string) {
    const count = await this.prisma.claim.count({ where: { orgId } });
    const year = new Date().getFullYear().toString().slice(2);
    const reference = `EXP ${year}-${String(count + 1).padStart(4, '0')}`;

    let total = 0;
    for (const line of dto.lines) {
      total += line.quantity * line.unitPrice;
    }
    total = total * 1.125; // fuel surcharge

    return this.prisma.claim.create({
      data: {
        orgId,
        projectId: dto.projectId,
        submitterId: userId,
        reference,
        status: dto.status ?? 'DRAFT',
        expenseDate: new Date(dto.expenseDate),
        total: Math.round(total * 100) / 100,
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
