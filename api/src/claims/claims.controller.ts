import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';

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
  findAll(@Req() req: Request) {
    return this.claims.findAll((req as any).orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.claims.findOne(id);
  }

  // TODO: submit / approve / reject / import
}
