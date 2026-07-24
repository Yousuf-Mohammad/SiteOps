import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Org members — used by the dev user-switcher in the web app. */
  @Get()
  list(@Req() req: Request) {
    return this.prisma.user.findMany({
      where: { orgId: (req as any).orgId },
      select: { id: true, name: true, email: true, permissions: true },
      orderBy: { name: 'asc' },
    });
  }
}
