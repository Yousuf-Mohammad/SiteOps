import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNoteDto, ListNotesDto } from './dto/notes.dto';

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: ListNotesDto) {
    const notes = await this.prisma.note.findMany({
      where: { orgId, entityType: query.entityType, entityId: query.entityId },
      orderBy: { createdAt: 'asc' },
    });
    const authors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(notes.map((n) => n.authorId))] } },
      select: { id: true, name: true },
    });
    const byId = new Map(authors.map((a) => [a.id, a.name]));
    return notes.map((n) => ({ ...n, authorName: byId.get(n.authorId) ?? 'Unknown' }));
  }

  async create(orgId: string, actorId: string, dto: CreateNoteDto) {
    return this.prisma.note.create({
      data: {
        orgId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        authorId: actorId,
        body: dto.body,
      },
    });
  }
}
