import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { OperacionService } from './operacion.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller()
@UseGuards(AuthGuard)
export class OperacionController {
  constructor(private readonly operacion: OperacionService) {}

  @Get('monitor')
  getMonitor() {
    return this.operacion.getMonitor();
  }

  @Get('tables/:id/active-visit')
  getVisitaActiva(@Param('id') mesaId: string) {
    return this.operacion.getVisitaActivaPorMesa(mesaId);
  }

  @Post('tables/:id/open')
  abrirMesa(
    @Param('id') mesaId: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.operacion.abrirMesa(mesaId, req.user.id);
  }

  // Debe ir antes de 'visits/:id': si no, Nest la toma como un id de visita.
  @Get('visits/active-llevar-delivery')
  getVisitasActivasLlevarDelivery() {
    return this.operacion.getVisitasActivasLlevarDelivery();
  }

  @Get('visits/:id')
  getVisita(@Param('id') visitaId: string) {
    return this.operacion.getVisita(visitaId);
  }

  @Post('visits/:id/orders')
  crearPedido(
    @Param('id') visitaId: string,
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      items: Array<{ platoCartaId: string; cantidad: number; notas?: string }>;
      paraLlevar?: boolean;
      nombreClienteLlevar?: string;
    },
  ) {
    return this.operacion.crearPedido(visitaId, req.user.id, body.items, {
      paraLlevar: body.paraLlevar,
      nombreClienteLlevar: body.nombreClienteLlevar,
    });
  }

  @Patch('orders/:id/status')
  cambiarEstado(
    @Param('id') pedidoId: string,
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      estado: 'en_preparacion' | 'listo' | 'entregado' | 'cancelado';
      motivoCancelacion?: string;
    },
  ) {
    return this.operacion.cambiarEstadoPedido(pedidoId, body.estado, {
      motivoCancelacion: body.motivoCancelacion,
      usuarioId: req.user.id,
    });
  }

  @Patch('orders/items/:id/cancel')
  cancelarItemPedido(
    @Param('id') itemId: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.operacion.cancelarItemPedido(itemId, req.user.id);
  }

  @Post('visits/:id/close')
  cerrarVisita(@Param('id') visitaId: string) {
    return this.operacion.cerrarVisita(visitaId);
  }

  @Post('visits/llevar')
  abrirVisitaParaLlevar(
    @Request() req: { user: { id: string } },
    @Body() body?: { nombreCliente?: string },
  ) {
    return this.operacion.abrirVisitaParaLlevar(
      req.user.id,
      body?.nombreCliente,
    );
  }

  @Post('visits/:id/print-bill')
  imprimirCuenta(@Param('id') visitaId: string) {
    return this.operacion.imprimirCuenta(visitaId);
  }

  @Post('visits/:id/pay-waiter')
  registrarPagoMesero(
    @Param('id') visitaId: string,
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      pagos: Array<{
        metodoPago: 'efectivo' | 'tarjeta' | 'yape_plin' | 'transferencia';
        monto: number;
      }>;
    },
  ) {
    return this.operacion.registrarPagoMesero(
      req.user.id,
      visitaId,
      body.pagos,
    );
  }
}
