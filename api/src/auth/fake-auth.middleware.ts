import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

// Stand-in for the real session layer. Resolves the acting user from headers.
@Injectable()
export class FakeAuthMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const userId = req.header('x-user-id');
    const orgId = req.header('x-org-id');
    if (!userId || !orgId) {
      throw new UnauthorizedException('x-user-id and x-org-id headers are required');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Unknown user');
    }

    (req as any).user = user;
    (req as any).orgId = orgId;
    next();
  }
}
