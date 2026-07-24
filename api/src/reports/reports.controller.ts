import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Burn per project: approved claims + confirmed plant dockets (ex-GST). */
  @Get('burn')
  @Permissions('reports.read')
  burn(@Req() req: Request) {
    return this.reports.burnByProject((req as any).orgId);
  }
}
