import { KitchenTicketData, ReceiptData } from './print.interface';
import { MarcaTicket } from './ticket-brand.service';
import { dinero, fechaHora, Ticket } from './ticket-layout';

/** "Ceviche cremoso + Papa a la huancaína" → una línea por componente. */
function componentes(descripcion?: string | null): string[] {
  return (descripcion ?? '')
    .split('+')
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Comanda de cocina: lo primero que se lee es la ronda y la mesa; los platos, en doble alto. */
export function comandaCocina(data: KitchenTicketData, marca: MarcaTicket, titulo = 'COMANDA · COCINA'): Ticket {
  const t = new Ticket();
  const { fecha, hora } = fechaHora(data.fechaCreacion);
  const codigo = `R-${String(data.numeroCorto).padStart(4, '0')}`;
  const platos = data.items.reduce((s, i) => s + i.cantidad, 0);

  t.centro(marca.nombre, { b: true })
    .centro(titulo, { inv: true, b: true })
    .blanco()
    .centro(codigo, { grande: true })
    .centro(`MESA ${data.mesaNumero}`, { grande: true });

  if (data.paraLlevar) {
    t.blanco().centro('PARA LLEVAR', { inv: true, grande: true });
    if (data.nombreClienteLlevar) t.centro(data.nombreClienteLlevar, { b: true, alto: true });
  }

  t.blanco()
    .fila(`Mesero: ${data.mesero}`, hora)
    .fila(`${platos} ${platos === 1 ? 'plato' : 'platos'}`, fecha)
    .sep('=');

  data.items.forEach((item, i) => {
    if (i > 0) t.blanco();
    t.item(item.cantidad, item.nombre, '', { b: true, alto: true });
    for (const c of [...componentes(item.descripcion), ...(item.elecciones ?? [])]) {
      t.detalle(`- ${c}`, '', 5);
    }
    if (item.notas) t.detalle(`> ${item.notas}`, '', 5);
  });

  return t.sep('=').cortar();
}

/** Recibo de caja y precuenta: columnas de cantidad, plato e importe alineadas al borde derecho. */
export function recibo(data: ReceiptData, marca: MarcaTicket): Ticket {
  const t = new Ticket();
  const { fecha, hora } = fechaHora(data.fechaPago);

  if (marca.logo) t.imagen(marca.logo).blanco();
  else t.centro(marca.nombre, { grande: true });
  if (marca.logo) t.centro(marca.nombre, { b: true });
  if (marca.direccion) t.centro(marca.direccion);
  if (marca.telefono) t.centro(`Telf: ${marca.telefono}`);

  t.blanco().centro(data.esPrecuenta ? 'PRECUENTA' : 'RECIBO DE PAGO', { inv: true, b: true }).blanco();

  if (data.tipoVisita === 'llevar') {
    t.fila(`Para llevar: ${data.nombreCliente ?? 'Cliente'}`, '');
  } else if (data.tipoVisita === 'delivery') {
    t.fila(`Delivery: ${data.nombreCliente ?? 'Cliente'}`, '');
    if (data.telefonoCliente) t.izq(`Telf: ${data.telefonoCliente}`);
    if (data.direccionDelivery) t.izq(`Dir: ${data.direccionDelivery}`, undefined, 5);
  } else {
    t.izq(`Mesa ${data.mesaNumero}`, { b: true, alto: true });
  }
  t.fila(fecha, hora).sep();

  t.fila('CANT DESCRIPCIÓN', 'IMPORTE', { b: true }).sep();
  for (const i of data.items) {
    const bruto = parseFloat(i.precioUnitario) * i.cantidad;
    t.item(i.cantidad, i.nombre, bruto.toFixed(2));
    const desc = parseFloat(i.descuentoUnitario ?? '0') * i.cantidad;
    if (desc > 0) t.detalle('Promo', `-${desc.toFixed(2)}`);
  }
  t.sep();

  const descuento = parseFloat(data.descuentoTotal ?? '0');
  const envio = parseFloat(data.costoEnvio ?? '0');
  const ajuste = parseFloat(data.ajusteMonto ?? '0');
  const hayEnvio = envio > 0.005;
  const hayAjuste = Math.abs(ajuste) > 0.005;
  const bruto = parseFloat(data.total) - envio + descuento;
  const final = parseFloat(data.total) + ajuste;

  if (descuento > 0 || hayEnvio || hayAjuste) t.fila('Subtotal', dinero(bruto));
  if (descuento > 0) t.fila('Descuento', `-${dinero(descuento)}`);
  if (hayEnvio) t.fila('Costo de envío', dinero(envio));
  if (hayAjuste) {
    t.fila('Ajuste', `${ajuste > 0 ? '+' : '-'}${dinero(Math.abs(ajuste))}`);
    if (data.motivoAjuste) t.detalle(data.motivoAjuste, '', 2);
  }

  t.blanco().fila('TOTAL', dinero(final), { b: true, alto: true }).blanco();

  if (data.esPrecuenta) {
    t.sep().centro('Este documento no es un comprobante de pago', { b: false });
  } else {
    t.fila('Método de pago', data.metodoPago).sep().blanco().centro('¡Gracias por tu visita!', { b: true });
  }

  return t.cortar();
}
