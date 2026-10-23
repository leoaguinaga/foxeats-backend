import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const TICKETS_DIR = path.join(process.cwd(), 'dev-tickets');

// Solo expone archivos generados por MockPrintService.
// Con la ticketera en modo «red» estos endpoints siguen existiendo
// pero devolverán 404 si nunca se escribió el archivo.

@Controller('dev')
export class DevPrintController {
  @Get('last-kitchen-ticket')
  lastKitchenTicket(@Res() res: Response) {
    const file = path.join(TICKETS_DIR, 'last-kitchen-ticket.txt');
    if (!fs.existsSync(file)) {
      return res.status(404).json({ message: 'No hay comanda generada aún' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(fs.readFileSync(file, 'utf8'));
  }

  @Get('last-receipt')
  lastReceipt(@Res() res: Response) {
    const file = path.join(TICKETS_DIR, 'last-receipt.txt');
    if (!fs.existsSync(file)) {
      return res.status(404).json({ message: 'No hay recibo generado aún' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(fs.readFileSync(file, 'utf8'));
  }
}
