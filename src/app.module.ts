import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { CatalogoModule } from './catalogo/catalogo.module';
import { MesasModule } from './mesas/mesas.module';
import { OperacionModule } from './operacion/operacion.module';
import { PrintModule } from './print/print.module';
import { CajaModule } from './caja/caja.module';
import { AdminModule } from './admin/admin.module';
import { PromocionesModule } from './promociones/promociones.module';
import { StockModule } from './stock/stock.module';
import { BiSyncModule } from './bi-sync/bi-sync.module';

@Module({
  imports: [
    DbModule,
    AuthModule,
    CatalogoModule,
    MesasModule,
    OperacionModule,
    PrintModule,
    CajaModule,
    AdminModule,
    PromocionesModule,
    StockModule,
    BiSyncModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
