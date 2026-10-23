import { Module } from '@nestjs/common';
import {
  PromocionesController,
  PromocionesVigentesController,
} from './promociones.controller';
import { PromocionesService } from './promociones.service';

@Module({
  controllers: [PromocionesController, PromocionesVigentesController],
  providers: [PromocionesService],
  exports: [PromocionesService],
})
export class PromocionesModule {}
