import { Controller, Get, Post } from '@nestjs/common';
import { BiSyncService } from './bi-sync.service';

@Controller('bi-sync')
export class BiSyncController {
  constructor(private readonly biSyncService: BiSyncService) {}

  @Get('status')
  getStatus() {
    return this.biSyncService.getSyncStatus();
  }

  @Get('snapshot')
  async getSnapshot() {
    return await this.biSyncService.generateDailySnapshot();
  }

  @Post('trigger')
  async triggerSync() {
    return await this.biSyncService.triggerSync();
  }
}
