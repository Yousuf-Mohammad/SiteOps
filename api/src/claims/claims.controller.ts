import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ListClaimsDto } from './dto/list-claims.dto';

@Controller('claims')
@UseGuards(PermissionsGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post()
  @Permissions('claims.create')
  create(@Body() dto: CreateClaimDto, @Req() req: Request) {
    const user = (req as any).user;
    const orgId = (req as any).orgId;
    return this.claims.create(dto, user.id, orgId);
  }

  // Reads carry no @Permissions: there is no `claims.read` in this system, and
  // inventing one would lock out every seeded user. Org scoping in the service
  // is what protects these — the same choice NotesController makes.
  @Get()
  list(@Query() query: ListClaimsDto, @Req() req: Request) {
    return this.claims.list((req as any).orgId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    // orgId is not optional here — omitting it is what made any org's claim
    // readable by id.
    return this.claims.findOne((req as any).orgId, id);
  }

  /**
   * Lodging is the tail of authoring, so it takes the same permission as
   * creating. Phase 6 narrows it further to the claim's own submitter:
   * permission answers "may you do this kind of thing", ownership answers
   * "may you do it to this record".
   */
  @Post(':id/submit')
  @Permissions('claims.create')
  submit(@Param('id') id: string, @Req() req: Request) {
    return this.claims.submit((req as any).orgId, (req as any).user.id, id);
  }

  @Post(':id/approve')
  @Permissions('claims.approve')
  approve(@Param('id') id: string, @Req() req: Request) {
    return this.claims.approve((req as any).orgId, (req as any).user.id, id);
  }

  @Post(':id/reject')
  @Permissions('claims.approve')
  reject(@Param('id') id: string, @Req() req: Request) {
    return this.claims.reject((req as any).orgId, (req as any).user.id, id);
  }

  // TODO: import
}
