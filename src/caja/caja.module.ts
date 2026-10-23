import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { CajaController } from './caja.controller';
import { MasPedidosController } from './mas-pedidos.controller';
import { CajaService } from './caja.service';
import { CajaReportesService } from './caja-reportes.service';
import { PrintModule } from '../print/print.module';
import { PromocionesModule } from '../promociones/promociones.module';

@Module({
  imports: [PrintModule, PromocionesModule, StockModule],
  controllers: [CajaController, MasPedidosController],
  providers: [CajaService, CajaReportesService],
  exports: [CajaService],
})
export class CajaModule {}
