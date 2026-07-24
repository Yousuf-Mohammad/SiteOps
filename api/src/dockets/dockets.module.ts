import { Module } from '@nestjs/common';
import { DocketsController } from './dockets.controller';
import { DocketsService } from './dockets.service';

@Module({
  controllers: [DocketsController],
  providers: [DocketsService],
})
export class DocketsModule {}
