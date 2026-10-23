import { Module } from '@nestjs/common';
import { BiSyncService } from './bi-sync.service';
import { BiSyncController } from './bi-sync.controller';

@Module({
  controllers: [BiSyncController],
  providers: [BiSyncService],
  exports: [BiSyncService],
})
export class BiSyncModule {}
