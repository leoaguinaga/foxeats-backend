export interface KitchenTicketData {
  pedidoId: string;
  numeroCorto: number;
  mesaNumero: number;
  visitaId: string;
  mesero: string;
  paraLlevar?: boolean;
  nombreClienteLlevar?: string;
  items: Array<{
    nombre: string;
    cantidad: number;
    notas?: string | null;
    /** Composición del plato (ej. dúos): "A + B + C"; se imprime una parte por línea. */
    descripcion?: string | null;
    /** Opciones elegidas de un plato armable (ej. dúo marino). */
    elecciones?: string[] | null;
  }>;
  fechaCreacion: Date;
}

export interface ReceiptData {
  visitaId: string;
  mesaNumero: number;
  tipoVisita?: 'mesa' | 'llevar' | 'delivery';
  nombreCliente?: string;
  telefonoCliente?: string;
  direccionDelivery?: string;
  costoEnvio?: string;
  items: Array<{
    nombre: string;
    cantidad: number;
    precioUnitario: string;
    descuentoUnitario?: string;
  }>;
  // Suma de items - descuentos por promo. NO incluye el ajuste manual.
  total: string;
  descuentoTotal?: string;
  // Ajuste manual aplicado por el cajero (puede ser positivo o negativo).
  // Si es != 0, el ticket muestra el ajuste como línea separada y el total final
  // como total + ajusteMonto.
  ajusteMonto?: string;
  motivoAjuste?: string;
  // Si true, el ticket sale como "PRECUENTA" — sin método de pago y sin
  // "Gracias por venir". El cajero puede imprimirla N veces antes de cobrar.
  esPrecuenta?: boolean;
  metodoPago: string;
  fechaPago: Date;
}

export const PRINT_SERVICE = Symbol('PRINT_SERVICE');

export interface PrintService {
  printKitchenTicket(data: KitchenTicketData): Promise<void>;
  /** Comanda de lo que no pasa por cocina (bebidas, extras): sale en la ticketera de caja. */
  printBarTicket(data: KitchenTicketData): Promise<void>;
  printReceipt(data: ReceiptData): Promise<void>;
}
