import { Injectable } from '@nestjs/common';
import { KitchenTicketData, PrintService, ReceiptData } from './print.interface';
import { MockPrintService } from './mock-print.service';
import { RealPrintService } from './real-print.service';
import { TicketeraConfigService } from './ticketera-config.service';

// Implementación de PRINT_SERVICE: en cada impresión lee el modo de la
// ticketera en la DB y delega en la simulada (archivo) o en la de red.
@Injectable()
export class TicketeraPrintService implements PrintService {
  constructor(
    private readonly config: TicketeraConfigService,
    private readonly mock: MockPrintService,
    private readonly real: RealPrintService,
  ) {}

  async printKitchenTicket(data: KitchenTicketData): Promise<void> {
    const t = await this.config.get('cocina');
    if (t.modo === 'red' && t.ip) {
      return this.real.printKitchenTicket(data, { ip: t.ip, port: t.puerto });
    }
    return this.mock.printKitchenTicket(data);
  }

  async printReceipt(data: ReceiptData): Promise<void> {
    const t = await this.config.get('recibos');
    if (t.modo === 'red' && t.ip) {
      return this.real.printReceipt(data, { ip: t.ip, port: t.puerto });
    }
    return this.mock.printReceipt(data);
  }
}
