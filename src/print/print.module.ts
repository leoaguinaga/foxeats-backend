import { Module } from '@nestjs/common';
import { MockPrintService } from './mock-print.service';
import { RealPrintService } from './real-print.service';
import { PRINT_SERVICE } from './print.interface';
import { DevPrintController } from './dev-print.controller';
import { PrinterManagementService } from './printer-management.service';
import { TicketeraConfigService } from './ticketera-config.service';
import { TicketeraPrintService } from './ticketera-print.service';

@Module({
  controllers: [DevPrintController],
  providers: [
    { provide: PRINT_SERVICE, useClass: TicketeraPrintService },
    MockPrintService,
    RealPrintService,
    TicketeraConfigService,
    PrinterManagementService,
  ],
  exports: [PRINT_SERVICE, PrinterManagementService],
})
export class PrintModule {}
