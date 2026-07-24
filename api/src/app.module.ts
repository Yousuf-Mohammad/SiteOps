import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { FakeAuthMiddleware } from './auth/fake-auth.middleware';
import { ClaimsModule } from './claims/claims.module';
import { SequenceModule } from './common/sequence/sequence.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { DocketsModule } from './dockets/dockets.module';
import { EquipmentModule } from './equipment/equipment.module';
import { NotesModule } from './notes/notes.module';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { ReportsModule } from './reports/reports.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    SequenceModule,
    OutboxModule,
    ProjectsModule,
    EquipmentModule,
    DocketsModule,
    NotesModule,
    ReportsModule,
    UsersModule,
    ClaimsModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // The filter existed but was never registered, so errors came back as raw
    // Nest defaults instead of the platform's { success:false, error:{code,message} }.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(FakeAuthMiddleware).forRoutes('*');
  }
}
