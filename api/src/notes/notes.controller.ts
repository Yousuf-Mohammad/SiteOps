import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { NotesService } from './notes.service';
import { CreateNoteDto, ListNotesDto } from './dto/notes.dto';

@Controller('notes')
@UseGuards(PermissionsGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Query() query: ListNotesDto, @Req() req: Request) {
    return this.notes.list((req as any).orgId, query);
  }

  @Post()
  create(@Body() dto: CreateNoteDto, @Req() req: Request) {
    return this.notes.create((req as any).orgId, (req as any).user.id, dto);
  }
}
