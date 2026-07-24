import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ProjectBurn {
  projectId: string;
  code: string;
  name: string;
  status: string;
  approvedClaims: number;
  confirmedPlant: number;
  burn: number;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async burnByProject(orgId: string): Promise<ProjectBurn[]> {
    const [projects, claimSums, dockets] = await Promise.all([
      this.prisma.project.findMany({ where: { orgId }, orderBy: { code: 'asc' } }),
      this.prisma.claim.groupBy({
        by: ['projectId'],
        where: { orgId, status: 'APPROVED' },
        _sum: { total: true },
      }),
      this.prisma.docket.findMany({
        where: { orgId, status: 'CONFIRMED' },
        select: { projectId: true, hours: true, equipment: { select: { hireRatePerDay: true } } },
      }),
    ]);

    // Claim.total is Decimal since the claims money migration; burn figures are
    // display values, so coerce at this boundary rather than reworking the report.
    const claimsByProject = new Map(claimSums.map((c) => [c.projectId, Number(c._sum.total ?? 0)]));
    const plantByProject = new Map<string, number>();
    for (const d of dockets) {
      // day rate covers 8 site hours; dockets bill pro-rata to the cent
      const cost = Math.round((Number(d.hours) / 8) * Number(d.equipment.hireRatePerDay) * 100) / 100;
      plantByProject.set(d.projectId, (plantByProject.get(d.projectId) ?? 0) + cost);
    }

    return projects.map((p) => {
      const approvedClaims = Math.round((claimsByProject.get(p.id) ?? 0) * 100) / 100;
      const confirmedPlant = Math.round((plantByProject.get(p.id) ?? 0) * 100) / 100;
      return {
        projectId: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        approvedClaims,
        confirmedPlant,
        burn: Math.round((approvedClaims + confirmedPlant) * 100) / 100,
      };
    });
  }
}
