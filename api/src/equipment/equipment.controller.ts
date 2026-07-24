import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { ListEquipmentDto } from './dto/list-equipment.dto';
import { EquipmentService } from './equipment.service';

@Controller('equipment')
@UseGuards(PermissionsGuard)
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Get()
  @Permissions('equipment.read')
  list(@Query() query: ListEquipmentDto, @Req() req: Request) {
    return this.equipment.list((req as any).orgId, query);
  }

  @Get(':id')
  @Permissions('equipment.read')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.equipment.findOne((req as any).orgId, id);
  }

  @Post()
  @Permissions('equipment.manage')
  create(@Body() dto: CreateEquipmentDto, @Req() req: Request) {
    return this.equipment.create((req as any).orgId, (req as any).user.id, dto);
  }
}
