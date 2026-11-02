import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { CatalogoService } from './catalogo.service';
import { AuthGuard, Roles } from '../auth/auth.guard';

@Controller()
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  // ─── Público (mesero/cajero pueden ver la carta y categorías) ───

  @Get('menu')
  getMenu() {
    return this.catalogo.findPlatosDisponibles();
  }

  @Get('categorias')
  getCategorias() {
    return this.catalogo.findAllCategorias();
  }

  @Post('categorias')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  createCategoria(
    @Body()
    body: {
      nombre: string;
      slug: string;
      descuentaStock?: boolean;
      esParaCocina?: boolean;
      orden?: number;
    },
  ) {
    return this.catalogo.createCategoria(body);
  }

  @Patch('categorias/:id')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  updateCategoria(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.catalogo.updateCategoria(id, body);
  }

  @Delete('categorias/:id')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  deleteCategoria(@Param('id') id: string) {
    return this.catalogo.deleteCategoria(id);
  }

  // ─── Insumos (admin) ───

  @Get('insumos')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  getInsumos() {
    return this.catalogo.findAllInsumos();
  }

  @Post('insumos')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  createInsumo(
    @Req() req: { user: { id: string } },
    @Body()
    body: {
      nombre: string;
      unidadesPorUnidadDeCompra?: number;
      nombreUnidadMinima?: string;
      nombreUnidadCompra?: string;
      minimo?: number;
      stockActual?: number;
    },
  ) {
    return this.catalogo.createInsumo(body, req.user.id);
  }

  @Patch('insumos/:id')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  updateInsumo(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.catalogo.updateInsumo(id, body);
  }

  // ─── Platos (admin para CRUD, mesero/cajero para toggle disponibilidad) ───

  // ?retirados=1 incluye los platos retirados de la carta (admin → Carta)
  @Get('platos')
  @UseGuards(AuthGuard)
  getPlatos(@Query('retirados') retirados?: string) {
    return this.catalogo.findAllPlatos(retirados === '1');
  }

  @Get('platos/:id')
  @UseGuards(AuthGuard)
  getPlato(@Param('id') id: string) {
    return this.catalogo.findPlatoById(id);
  }

  @Post('platos')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  createPlato(
    @Body()
    body: {
      nombre: string;
      precio: string;
      categoriaId: string;
      descripcion?: string;
    },
  ) {
    return this.catalogo.createPlato(body);
  }

  @Post('platos/bulk')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  createPlatosBulk(
    @Body()
    body: {
      categoriaId: string;
      platos: Array<{ nombre: string; precio: string; descripcion?: string }>;
    },
  ) {
    return this.catalogo.createPlatosBulk(body);
  }

  @Patch('platos/:id')
  @UseGuards(AuthGuard)
  updatePlato(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.catalogo.updatePlato(id, body);
  }

  // ─── Recetas (admin) ───

  @Get('platos/:id/recetas')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  getRecetas(@Param('id') id: string) {
    return this.catalogo.findRecetasByPlato(id);
  }

  @Post('platos/:id/recetas')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  createReceta(
    @Param('id') platoCartaId: string,
    @Body() body: { insumoId: string; cantidadConsumida: number },
  ) {
    return this.catalogo.createReceta({ platoCartaId, ...body });
  }

  @Delete('recetas/:id')
  @UseGuards(AuthGuard)
  @Roles('administracion')
  deleteReceta(@Param('id') id: string) {
    return this.catalogo.deleteReceta(id);
  }
}
