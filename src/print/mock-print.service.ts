import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  KitchenTicketData,
  PrintService,
  ReceiptData,
} from './print.interface';
import { TicketBrandService } from './ticket-brand.service';
import { comandaCocina, recibo } from './ticket-builders';

const TICKETS_DIR = path.join(process.cwd(), 'dev-tickets');

function ensureDir() {
  if (!fs.existsSync(TICKETS_DIR))
    fs.mkdirSync(TICKETS_DIR, { recursive: true });
}

@Injectable()
export class MockPrintService implements PrintService {
  private readonly logger = new Logger(MockPrintService.name);

  constructor(private readonly marca: TicketBrandService) {}

  async printKitchenTicket(data: KitchenTicketData): Promise<void> {
    ensureDir();
    const ticket = comandaCocina(data, await this.marca.get());
    fs.writeFileSync(path.join(TICKETS_DIR, 'last-kitchen-ticket.txt'), ticket.aTexto(), 'utf8');
    this.logger.log(
      `[MOCK] Comanda impresa — Mesa ${data.mesaNumero}, ${data.items.length} item(s)`,
    );
  }

  async printBarTicket(data: KitchenTicketData): Promise<void> {
    ensureDir();
    const ticket = comandaCocina(data, await this.marca.get(), 'COMANDA · CAJA');
    fs.writeFileSync(path.join(TICKETS_DIR, 'last-bar-ticket.txt'), ticket.aTexto(), 'utf8');
    this.logger.log(
      `[MOCK] Comanda de caja impresa — Mesa ${data.mesaNumero}, ${data.items.length} item(s)`,
    );
  }

  async printReceipt(data: ReceiptData): Promise<void> {
    ensureDir();
    const ticket = recibo(data, await this.marca.get());
    const filename = data.esPrecuenta ? 'last-precuenta.txt' : 'last-receipt.txt';
    fs.writeFileSync(path.join(TICKETS_DIR, filename), ticket.aTexto(), 'utf8');
    this.logger.log(
      `[MOCK] ${data.esPrecuenta ? 'Precuenta' : 'Recibo'} impreso — Mesa ${data.mesaNumero}` +
        (data.esPrecuenta ? '' : ` (${data.metodoPago})`),
    );
  }
}
