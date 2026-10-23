import { Module } from '@nestjs/common';
import { MesasController } from './mesas.controller';
import { MesasService } from './mesas.service';
import { ZonasController } from './zonas.controller';
import { ZonasService } from './zonas.service';

@Module({
  controllers: [MesasController, ZonasController],
  providers: [MesasService, ZonasService],
  exports: [MesasService, ZonasService],
})
export class MesasModule {}
