import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CajaService } from './caja.service';
import { AuthGuard } from '../auth/auth.guard';

/** «Más pedidos» para cualquier rol logueado: el mesero lo usa con tipo=mesa. */
@Controller('menu')
@UseGuards(AuthGuard)
export class MasPedidosController {
  constructor(private readonly caja: CajaService) {}

  @Get('mas-pedidos')
  getMasPedidos(@Query('tipo') tipo?: string) {
    return this.caja.masPedidos(8, tipo === 'mesa' ? 'mesa' : 'mostrador');
  }
}
