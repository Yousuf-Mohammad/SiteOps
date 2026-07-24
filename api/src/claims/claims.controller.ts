import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ListClaimsDto } from './dto/list-claims.dto';

@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post()
  create(@Body() dto: CreateClaimDto, @Req() req: Request) {
    const user = (req as any).user;
    const orgId = (req as any).orgId;
    return this.claims.create(dto, user.id, orgId);
  }

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

  // TODO: submit / approve / reject / import
}
