import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { StockService } from './stock.service';

const uid = (req: Request) => (req as any).user.id as string;

// Administración y cajero: quien recibe la mercadería o cierra el día cuenta.
@Controller('admin/stock')
@UseGuards(AuthGuard)
@Roles('administracion', 'cajero')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  listar() {
    return this.stock.listar();
  }

  @Get('ultimo-conteo')
  ultimoConteo() {
    return this.stock.ultimoConteo();
  }

  @Get(':id/movimientos')
  movimientos(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limite') limite?: string,
  ) {
    return this.stock.movimientos(id, limite ? parseInt(limite, 10) : 60);
  }

  @Post(':id/merma')
  merma(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { cantidad: number; motivo: string; nota?: string },
    @Req() req: Request,
  ) {
    return this.stock.registrarMerma(
      id,
      body.cantidad,
      body.motivo,
      body.nota,
      uid(req),
    );
  }

  @Post(':id/correccion')
  corregir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { stockReal: number; motivo: string },
    @Req() req: Request,
  ) {
    return this.stock.corregir(id, body.stockReal, body.motivo, uid(req));
  }

  @Post('compra')
  compra(
    @Body()
    body: {
      proveedor?: string;
      items: Array<{ insumoId: string; cantidad: number }>;
    },
    @Req() req: Request,
  ) {
    return this.stock.registrarCompra(body.items, body.proveedor, uid(req));
  }

  @Post('conteo')
  conteo(
    @Body()
    body: {
      items: Array<{ insumoId: string; contado: number; motivo?: string }>;
    },
    @Req() req: Request,
  ) {
    return this.stock.registrarConteo(body.items, uid(req));
  }

  @Put('orden-conteo')
  @Roles('administracion')
  ordenConteo(@Body() body: { ids: string[] }) {
    return this.stock.ordenarConteo(body.ids ?? []);
  }
}
