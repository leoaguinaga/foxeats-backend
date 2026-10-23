import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { PrinterManagementService } from '../print/printer-management.service';

@Controller('admin')
@UseGuards(AuthGuard)
@Roles('administracion')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly printerMgmt: PrinterManagementService,
  ) {}

  @Get('users')
  listUsuarios() {
    return this.admin.listUsuarios();
  }

  @Post('users')
  crearUsuario(
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      role: 'mesero' | 'cajero' | 'administracion';
    },
  ) {
    return this.admin.crearUsuario(body);
  }

  @Patch('users/:id')
  updateUsuario(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      activo?: boolean;
      role?: 'mesero' | 'cajero' | 'administracion';
    },
    @Req() req: { user: { id: string } },
  ) {
    return this.admin.updateUsuario(id, body, req.user.id);
  }

  @Post('users/:id/password')
  restablecerPassword(
    @Param('id') id: string,
    @Body() body: { password: string },
    @Req() req: { user: { id: string } },
  ) {
    return this.admin.restablecerPassword(id, body?.password, req.user.id);
  }

  // Nombre y logo para las cabeceras de caja y mesero (cualquier rol)
  @Get('settings/brand')
  @Roles('mesero', 'cajero', 'administracion')
  async getBrand() {
    const { nombre, logo } = await this.admin.getSettings();
    return { nombre, logo };
  }

  @Get('settings')
  getSettings() {
    return this.admin.getSettings();
  }

  @Patch('settings')
  updateSettings(
    @Body()
    body: {
      nombre: string;
      logo: string | null;
      direccion: string;
      telefono: string;
    },
  ) {
    return this.admin.updateSettings(body);
  }

  // ─── Ticketeras ────────────────────────────────────────────────────────────

  @Get('ticketeras')
  getTicketeras() {
    return this.printerMgmt.getTicketeras();
  }

  @Patch('ticketeras/:tipo')
  async updateTicketera(
    @Param('tipo') tipo: string,
    @Body()
    body: { modo?: 'simulada' | 'red'; ip?: string | null; puerto?: number },
  ) {
    if (tipo !== 'cocina' && tipo !== 'recibos')
      throw new BadRequestException('tipo inválido');
    await this.printerMgmt.updateTicketera(tipo, body);
    return this.printerMgmt.getTicketeras();
  }

  @Post('ticketeras/:tipo/test')
  async testPrint(@Param('tipo') tipo: string) {
    if (tipo !== 'cocina' && tipo !== 'recibos')
      throw new BadRequestException('tipo inválido');
    await this.printerMgmt.testPrint(tipo);
    return { ok: true };
  }
}
