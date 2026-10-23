import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PromocionesService } from './promociones.service';
import type { UpsertPromocionInput } from './promociones.service';
import { AuthGuard, Roles } from '../auth/auth.guard';

@Controller('admin/promociones')
@UseGuards(AuthGuard)
@Roles('administracion')
export class PromocionesController {
  constructor(private readonly promos: PromocionesService) {}

  @Get()
  list() {
    return this.promos.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.promos.findById(id);
  }

  @Post()
  create(@Body() body: UpsertPromocionInput) {
    return this.promos.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpsertPromocionInput) {
    return this.promos.update(id, body);
  }

  @Patch(':id/activo')
  setActivo(@Param('id') id: string, @Body() body: { activo: boolean }) {
    return this.promos.setActivo(id, body.activo);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.promos.remove(id);
  }
}

/** Lectura para el salón: qué platos tienen descuento en este momento. */
@Controller('promociones')
@UseGuards(AuthGuard)
export class PromocionesVigentesController {
  constructor(private readonly promos: PromocionesService) {}

  @Get('vigentes')
  vigentes() {
    return this.promos.listarVigentes();
  }
}
