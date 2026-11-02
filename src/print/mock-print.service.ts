import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  KitchenTicketData,
  PrintService,
  ReceiptData,
} from './print.interface';
import { TicketBrandService } from './ticket-brand.service';

const TICKETS_DIR = path.join(process.cwd(), 'dev-tickets');

function ensureDir() {
  if (!fs.existsSync(TICKETS_DIR))
    fs.mkdirSync(TICKETS_DIR, { recursive: true });
}

function formatDate(d: Date) {
  return d.toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false });
}

@Injectable()
export class MockPrintService implements PrintService {
  private readonly logger = new Logger(MockPrintService.name);

  constructor(private readonly marca: TicketBrandService) {}

  async printKitchenTicket(data: KitchenTicketData): Promise<void> {
    ensureDir();

    const codigoRonda = `R-${String(data.numeroCorto).padStart(4, '0')}`;
    const lineas = [
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '          FoxEats                 ',
      '          ** COCINA **            ',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `         ${codigoRonda}`,
      `         ═════════`,
      ...(data.paraLlevar
        ? [
            '',
            '   >>> PARA LLEVAR <<<',
            `   Cliente: ${data.nombreClienteLlevar ?? '—'}`,
            '',
          ]
        : []),
      `Mesa:    ${data.mesaNumero}`,
      `Mesero:  ${data.mesero}`,
      `Hora:    ${formatDate(data.fechaCreacion)}`,
      '─────────────────────────────────',
      ...data.items.map((item) =>
        [
          `${item.cantidad}x  ${item.nombre}`,
          item.notas ? `     → ${item.notas}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ];

    const contenido = lineas.join('\n');
    fs.writeFileSync(
      path.join(TICKETS_DIR, 'last-kitchen-ticket.txt'),
      contenido,
      'utf8',
    );
    this.logger.log(
      `[MOCK] Comanda impresa — Mesa ${data.mesaNumero}, ${data.items.length} item(s)`,
    );
  }

  async printReceipt(data: ReceiptData): Promise<void> {
    ensureDir();

    const itemLines = data.items.flatMap((i) => {
      const subtotal = (parseFloat(i.precioUnitario) * i.cantidad).toFixed(2);
      const nombre =
        i.nombre.length > 20 ? i.nombre.slice(0, 19) + '…' : i.nombre;
      const linea = `${i.cantidad}x ${nombre.padEnd(22)} S/${subtotal}`;
      const descU = parseFloat(i.descuentoUnitario ?? '0');
      if (descU > 0) {
        const totalDesc = (descU * i.cantidad).toFixed(2);
        return [linea, `     ↳ Promo (-S/${totalDesc})`];
      }
      return [linea];
    });

    const tieneDescuento = parseFloat(data.descuentoTotal ?? '0') > 0;
    const costoEnvio = parseFloat(data.costoEnvio ?? '0');
    const tieneEnvio = costoEnvio > 0.005;
    const ajusteMonto = parseFloat(data.ajusteMonto ?? '0');
    const tieneAjuste = Math.abs(ajusteMonto) > 0.005;

    const totalItemsNeto = parseFloat(data.total) - costoEnvio;
    const totalItemsBruto =
      totalItemsNeto + parseFloat(data.descuentoTotal ?? '0');
    const totalFinal = (parseFloat(data.total) + ajusteMonto).toFixed(2);

    const lineas = [
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ...((await this.marca.get()).logo ? ['          [ LOGO ]                '] : []),
      '          FoxEats                 ',
      ...(data.esPrecuenta ? ['       ** PRECUENTA **          '] : []),
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ...(data.tipoVisita === 'llevar'
        ? [`Llevar:  ${data.nombreCliente ?? 'Cliente'}`]
        : data.tipoVisita === 'delivery'
          ? [
              `Delivery: ${data.nombreCliente ?? 'Cliente'}`,
              `Telf:    ${data.telefonoCliente ?? '—'}`,
              `Dir:     ${data.direccionDelivery ?? '—'}`,
            ]
          : [`Mesa:    ${data.mesaNumero}`]),
      `Fecha:   ${formatDate(data.fechaPago)}`,
      '─────────────────────────────────',
      ...itemLines,
      '─────────────────────────────────',
      ...(tieneDescuento || tieneEnvio || tieneAjuste
        ? [
            `Subtotal:                  S/${totalItemsBruto.toFixed(2).padStart(6)}`,
          ]
        : []),
      ...(tieneDescuento
        ? [`Descuento:                -S/${data.descuentoTotal!.padStart(6)}`]
        : []),
      ...(tieneEnvio
        ? [`Costo Envio:               S/${costoEnvio.toFixed(2).padStart(6)}`]
        : []),
      ...(tieneAjuste
        ? [
            `Ajuste${ajusteMonto > 0 ? '   ' : ' '}(${data.motivoAjuste ?? '—'}):`.padEnd(
              28,
            ) +
              ` ${ajusteMonto > 0 ? '+' : '-'}S/${Math.abs(ajusteMonto).toFixed(2).padStart(6)}`,
          ]
        : []),
      `TOTAL:                     S/${totalFinal.padStart(6)}`,
      ...(data.esPrecuenta
        ? ['', '** No es un comprobante de pago **']
        : [`Método:  ${data.metodoPago}`]),
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ...(data.esPrecuenta
        ? []
        : [
            '        ¡Gracias por venir!       ',
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          ]),
    ];

    const contenido = lineas.join('\n');
    const filename = data.esPrecuenta
      ? 'last-precuenta.txt'
      : 'last-receipt.txt';
    fs.writeFileSync(path.join(TICKETS_DIR, filename), contenido, 'utf8');
    this.logger.log(
      `[MOCK] ${data.esPrecuenta ? 'Precuenta' : 'Recibo'} impreso — Mesa ${data.mesaNumero}, S/${totalFinal}` +
        (data.esPrecuenta ? '' : ` (${data.metodoPago})`),
    );
  }
}
