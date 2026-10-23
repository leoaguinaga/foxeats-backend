import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { OperacionController } from './operacion.controller';
import { OperacionService } from './operacion.service';
import { PrintModule } from '../print/print.module';
import { PromocionesModule } from '../promociones/promociones.module';

@Module({
  imports: [PrintModule, PromocionesModule, StockModule],
  controllers: [OperacionController],
  providers: [OperacionService],
  exports: [OperacionService],
})
export class OperacionModule {}
