import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Patch,
  Delete,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CajaService } from './caja.service';
import { CajaReportesService } from './caja-reportes.service';
import { AuthGuard, Roles } from '../auth/auth.guard';

@Controller('cash')
@UseGuards(AuthGuard)
@Roles('cajero', 'administracion')
export class CajaController {
  constructor(
    private readonly caja: CajaService,
    private readonly reportes: CajaReportesService,
  ) {}

  @Get('shift/current')
  getTurnoActual(@Request() req: { user: { id: string } }) {
    return this.caja.getTurnoConPagos(req.user.id);
  }

  @Post('shift/open')
  abrirTurno(
    @Request() req: { user: { id: string } },
    @Body() body: { montoApertura: number },
  ) {
    return this.caja.abrirTurno(req.user.id, body.montoApertura);
  }

  @Post('shift/close')
  cerrarTurno(
    @Request() req: { user: { id: string } },
    @Body() body: { montoCierreReal: number },
  ) {
    return this.caja.cerrarTurno(req.user.id, body.montoCierreReal);
  }

  @Post('shift/expense')
  registrarGasto(
    @Request() req: { user: { id: string } },
    @Body() body: { monto: number; motivo: string },
  ) {
    return this.caja.registrarGasto(req.user.id, body);
  }
  @Patch('shift/expense/:id')
  editarGasto(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
    @Body() body: { monto: number; motivo: string },
  ) {
    return this.caja.editarGasto(req.user.id, id, body);
  }

  @Delete('shift/expense/:id')
  eliminarGasto(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.caja.eliminarGasto(req.user.id, id);
  }

  @Get('shifts')
  getTurnos(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('cajero') cajero?: string,
  ) {
    return this.reportes.resumen({ desde, hasta, cajero });
  }

  @Get('export.csv')
  async exportarCsv(
    @Res() res: Response,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('cajero') cajero?: string,
  ) {
    const { nombre, csv } = await this.reportes.exportarCsv({
      desde,
      hasta,
      cajero,
    });
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nombre}"`,
      })
      .send(csv);
  }

  @Get('shifts/:id')
  getTurnoDetalle(@Param('id') id: string) {
    return this.reportes.detalle(id);
  }

  @Get('mas-pedidos')
  getMasPedidos() {
    return this.caja.masPedidos();
  }

  @Get('visits-to-collect')
  getMesasParaCobrar() {
    return this.caja.getMesasParaCobrar();
  }

  @Get('visits/:id')
  getDetalleVisita(@Param('id') visitaId: string) {
    return this.caja.getDetalleVisita(visitaId);
  }

  @Post('visits/:id/pay')
  registrarPago(
    @Param('id') visitaId: string,
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      pagos: Array<{
        metodoPago: 'efectivo' | 'tarjeta' | 'yape_plin' | 'transferencia';
        monto: number;
      }>;
      ajuste?: { monto: number; motivo: string };
    },
  ) {
    return this.caja.registrarPago(
      req.user.id,
      visitaId,
      body.pagos,
      body.ajuste,
    );
  }

  @Post('visits/:id/cancel')
  cancelarVisita(
    @Param('id') visitaId: string,
    @Request() req: { user: { id: string } },
    @Body() body: { motivo?: string },
  ) {
    return this.caja.cancelarVisita(visitaId, body.motivo ?? '', req.user.id);
  }

  @Post('visits/:id/print-precuenta')
  imprimirPrecuenta(@Param('id') visitaId: string) {
    return this.caja.imprimirPrecuenta(visitaId);
  }

  @Post('pedidos/llevar')
  crearPedidoLlevar(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      nombreCliente?: string;
      items: Array<{ platoCartaId: string; cantidad: number; notas?: string; elecciones?: string[] }>;
    },
  ) {
    return this.caja.crearPedidoLlevar(req.user.id, body);
  }

  @Post('pedidos/delivery')
  crearPedidoDelivery(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      nombreCliente: string;
      telefonoCliente?: string;
      direccionDelivery: string;
      costoEnvio: number;
      items: Array<{ platoCartaId: string; cantidad: number; notas?: string; elecciones?: string[] }>;
    },
  ) {
    return this.caja.crearPedidoDelivery(req.user.id, body);
  }
}
