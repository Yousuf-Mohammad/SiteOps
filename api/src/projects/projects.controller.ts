import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(PermissionsGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @Permissions('projects.read')
  list(@Query() query: ListProjectsDto, @Req() req: Request) {
    return this.projects.list((req as any).orgId, query);
  }

  @Get(':id')
  @Permissions('projects.read')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.projects.findOne((req as any).orgId, id);
  }

  @Post()
  @Permissions('projects.manage')
  create(@Body() dto: CreateProjectDto, @Req() req: Request) {
    return this.projects.create((req as any).orgId, (req as any).user.id, dto);
  }
}
