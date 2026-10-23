import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import { KitchenTicketData, ReceiptData } from './print.interface';

export interface PrinterTarget {
  ip: string;
  port: number;
}

// Envía tickets ESC/POS por TCP. El destino (ip:puerto) lo decide
// TicketeraPrintService a partir de la configuración guardada en la DB.
@Injectable()
export class RealPrintService {
  private readonly logger = new Logger(RealPrintService.name);

  async printKitchenTicket(
    data: KitchenTicketData,
    { ip, port }: PrinterTarget,
  ): Promise<void> {
    await this.sendTcp(ip, port, this.buildKitchenTicket(data));
    this.logger.log(`[RED] Comanda → Mesa ${data.mesaNumero} (${ip}:${port})`);
  }

  async printReceipt(
    data: ReceiptData,
    { ip, port }: PrinterTarget,
  ): Promise<void> {
    await this.sendTcp(ip, port, this.buildReceipt(data));
    this.logger.log(
      `[RED] Recibo → Mesa ${data.mesaNumero} S/${data.total} (${ip}:${port})`,
    );
  }

  private sendTcp(ip: string, port: number, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.connect(port, ip, () => {
        socket.write(data, (err) => {
          if (err) {
            socket.destroy();
            reject(err);
          } else {
            socket.end();
            resolve();
          }
        });
      });
      socket.on('error', reject);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`Timeout ticketera ${ip}`));
      });
    });
  }

  private buildKitchenTicket(data: KitchenTicketData): Buffer {
    const ESC = '\x1b';
    const GS = '\x1d';
    const LF = '\x0a';
    const fecha = data.fechaCreacion.toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      hour12: false,
    });
    const codigoRonda = `R-${String(data.numeroCorto).padStart(4, '0')}`;

    const parts = [
      `${ESC}\x40`,
      `${ESC}\x61\x01`,
      `${ESC}\x45\x01`,
      `MISTER LUKA${LF}`,
      `** COCINA **${LF}`,
      `${ESC}\x45\x00`,
      `--------------------------------${LF}`,
      // Código de ronda en grande (doble alto + doble ancho) para que cocina lo lea de un vistazo
      `${GS}\x21\x11`,
      `${ESC}\x45\x01`,
      `${codigoRonda}${LF}`,
      `${ESC}\x45\x00`,
      `${GS}\x21\x00`,
      // Marca "PARA LLEVAR" + nombre del cliente, también en grande
      ...(data.paraLlevar
        ? [
            `${LF}`,
            `${GS}\x21\x11`,
            `${ESC}\x45\x01`,
            `>>> PARA LLEVAR <<<${LF}`,
            `${ESC}\x45\x00`,
            `${GS}\x21\x00`,
            `${ESC}\x45\x01`,
            `Cliente: ${data.nombreClienteLlevar ?? '-'}${LF}`,
            `${ESC}\x45\x00`,
            `${LF}`,
          ]
        : []),
      `${ESC}\x61\x00`,
      `Mesa:   ${data.mesaNumero}${LF}`,
      `Mesero: ${data.mesero}${LF}`,
      `Hora:   ${fecha}${LF}`,
      `--------------------------------${LF}`,
      ...data.items.flatMap((item) => [
        `${ESC}\x45\x01`,
        `${item.cantidad}x ${item.nombre}${LF}`,
        `${ESC}\x45\x00`,
        ...(item.notas ? [`   -> ${item.notas}${LF}`] : []),
      ]),
      `--------------------------------${LF}`,
      `${LF}${LF}${LF}`,
      `${GS}\x56\x42\x00`,
    ];
    return Buffer.from(parts.join(''), 'latin1');
  }

  private buildReceipt(data: ReceiptData): Buffer {
    const ESC = '\x1b';
    const GS = '\x1d';
    const LF = '\x0a';
    const fecha = data.fechaPago.toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      hour12: false,
    });

    const itemLines = data.items.flatMap((i) => {
      const subtotal = (parseFloat(i.precioUnitario) * i.cantidad).toFixed(2);
      const nombre =
        i.nombre.length > 20 ? i.nombre.slice(0, 19) + '.' : i.nombre;
      const linea = `${i.cantidad}x ${nombre.padEnd(22)} S/${subtotal}${LF}`;
      const descU = parseFloat(i.descuentoUnitario ?? '0');
      if (descU > 0) {
        const totalDesc = (descU * i.cantidad).toFixed(2);
        return [linea, `   Promo (-S/${totalDesc})${LF}`];
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

    const parts = [
      `${ESC}\x40`,
      `${ESC}\x61\x01`,
      `${ESC}\x45\x01`,
      `MISTER LUKA${LF}`,
      `${ESC}\x45\x00`,
      data.esPrecuenta ? `** PRECUENTA **${LF}` : `Pollo a la Brasa & Mas${LF}`,
      `--------------------------------${LF}`,
      `${ESC}\x61\x00`,
      ...(data.tipoVisita === 'llevar'
        ? [`Llevar: ${data.nombreCliente ?? 'Cliente'}${LF}`]
        : data.tipoVisita === 'delivery'
          ? [
              `Delivery: ${data.nombreCliente ?? 'Cliente'}${LF}`,
              `Telf:   ${data.telefonoCliente ?? '-'}${LF}`,
              `Dir:    ${(data.direccionDelivery ?? '-').slice(0, 24)}${LF}`,
            ]
          : [`Mesa:   ${data.mesaNumero}${LF}`]),
      `Fecha:  ${fecha}${LF}`,
      `--------------------------------${LF}`,
      ...itemLines,
      `--------------------------------${LF}`,
      ...(tieneDescuento || tieneEnvio || tieneAjuste
        ? [
            `Subtotal:           S/${totalItemsBruto.toFixed(2).padStart(6)}${LF}`,
          ]
        : []),
      ...(tieneDescuento
        ? [`Descuento:         -S/${data.descuentoTotal!.padStart(6)}${LF}`]
        : []),
      ...(tieneEnvio
        ? [`Costo Envio:        S/${costoEnvio.toFixed(2).padStart(6)}${LF}`]
        : []),
      ...(tieneAjuste
        ? [
            `Ajuste (${(data.motivoAjuste ?? '-').slice(0, 14)}): ${ajusteMonto > 0 ? '+' : '-'}S/${Math.abs(ajusteMonto).toFixed(2).padStart(6)}${LF}`,
          ]
        : []),
      `TOTAL:              S/${totalFinal.padStart(6)}${LF}`,
      ...(data.esPrecuenta
        ? [`${LF}** No es comprobante **${LF}`]
        : [`Metodo: ${data.metodoPago}${LF}`]),
      `--------------------------------${LF}`,
      ...(data.esPrecuenta
        ? []
        : [`${ESC}\x61\x01`, `Gracias por venir!${LF}`]),
      `${LF}${LF}${LF}`,
      `${GS}\x56\x42\x00`,
    ];
    return Buffer.from(parts.join(''), 'latin1');
  }
}
