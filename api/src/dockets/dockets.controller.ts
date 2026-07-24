import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { DocketsService } from './dockets.service';
import { CreateDocketDto } from './dto/create-docket.dto';
import { ListDocketsDto } from './dto/list-dockets.dto';

@Controller('dockets')
@UseGuards(PermissionsGuard)
export class DocketsController {
  constructor(private readonly dockets: DocketsService) {}

  @Get()
  @Permissions('dockets.read')
  list(@Query() query: ListDocketsDto, @Req() req: Request) {
    return this.dockets.list((req as any).orgId, query);
  }

  @Post()
  @Permissions('dockets.create')
  create(@Body() dto: CreateDocketDto, @Req() req: Request) {
    return this.dockets.create((req as any).orgId, (req as any).user.id, dto);
  }

  @Post(':id/confirm')
  @Permissions('dockets.confirm')
  confirm(@Param('id') id: string, @Req() req: Request) {
    return this.dockets.confirm((req as any).orgId, (req as any).user.id, id);
  }
}
