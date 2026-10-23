import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { ZonasService } from './zonas.service';

@Controller('zones')
export class ZonasController {
  constructor(private readonly zonas: ZonasService) {}

  @Get()
  @UseGuards(AuthGuard)
  findAll() {
    return this.zonas.findAll();
  }

  @Post()
  @UseGuards(AuthGuard)
  @Roles('administracion')
  create(@Body() body: { nombre?: string; modo?: 'plano' | 'numeros' }) {
    return this.zonas.create(body);
  }

  @Post('order')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  reordenar(@Body() body: { ids: string[] }) {
    return this.zonas.reordenar(body.ids);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  update(
    @Param('id') id: string,
    @Body() body: Partial<{ nombre: string; modo: 'plano' | 'numeros'; filas: number; columnas: number }>,
  ) {
    return this.zonas.update(id, body);
  }

  @Post(':id/layout')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  guardarPlano(
    @Param('id') id: string,
    @Body()
    body: {
      filas: number;
      columnas: number;
      referencias: unknown;
      mesas: Array<{ id: string; filaPosicion: number | null; colPosicion: number | null; ancho?: number }>;
    },
  ) {
    return this.zonas.guardarPlano(id, body);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  remove(@Param('id') id: string) {
    return this.zonas.delete(id);
  }
}
