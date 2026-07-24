import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface DomainEvent {
  orgId: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Transactional outbox. Enqueue events INSIDE the transaction that commits
 * the state change they describe — the event row and the mutation then
 * commit or roll back together, and the relay delivers with at-least-once
 * semantics. Never publish side effects directly from request handlers.
 *
 * In dev the relay "delivers" by logging; the production transport is wired
 * via config in the deploy repo.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(tx: Prisma.TransactionClient, event: DomainEvent) {
    return tx.outboxEvent.create({
      data: { orgId: event.orgId, type: event.type, payload: event.payload as any },
    });
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.relayPending(), 10_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async relayPending() {
    const batch = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    for (const event of batch) {
      try {
        this.logger.log(`delivered ${event.type} (${event.id})`);
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: new Date(), attempts: { increment: 1 } },
        });
      } catch (err) {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { attempts: { increment: 1 } },
        });
        this.logger.warn(`delivery failed for ${event.id}: ${err}`);
      }
    }
  }
}
