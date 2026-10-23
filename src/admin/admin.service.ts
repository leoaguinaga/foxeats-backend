import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../db/db.module';
import * as schema from '../db/schema';
import { auth } from '../auth/auth.config';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  // ─── Usuarios ─────────────────────────────────────────────────────────────

  async listUsuarios() {
    return this.db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        role: schema.user.role,
        activo: schema.user.activo,
        createdAt: schema.user.createdAt,
      })
      .from(schema.user)
      .orderBy(schema.user.createdAt);
  }

  async crearUsuario(data: {
    name: string;
    email: string;
    password: string;
    role: 'mesero' | 'cajero' | 'administracion';
  }) {
    const [existing] = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, data.email));
    if (existing) throw new ConflictException('El email ya está registrado');

    // Better Auth maneja el hashing de la contraseña
    const result = await auth.api.signUpEmail({
      body: { name: data.name, email: data.email, password: data.password },
      headers: new Headers(),
    });

    if (!result?.user?.id) throw new Error('Error al crear usuario');

    // Actualizar role y activo (Better Auth ignora campos extra en signUp)
    await this.db
      .update(schema.user)
      .set({ role: data.role, activo: true })
      .where(eq(schema.user.id, result.user.id));

    return {
      id: result.user.id,
      name: data.name,
      email: data.email,
      role: data.role,
      activo: true,
    };
  }

  async updateUsuario(
    id: string,
    data: {
      name?: string;
      activo?: boolean;
      role?: 'mesero' | 'cajero' | 'administracion';
    },
    actorId?: string,
  ) {
    const [existing] = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, id));
    if (!existing) throw new NotFoundException('Usuario no encontrado');

    if (!data || typeof data !== 'object')
      throw new BadRequestException('Datos inválidos');
    if (id === actorId && (data.activo === false || data.role !== undefined))
      throw new BadRequestException(
        'No puedes cambiar tu propio rol ni quitarte el acceso',
      );
    if (
      data.role !== undefined &&
      !['mesero', 'cajero', 'administracion'].includes(data.role)
    )
      throw new BadRequestException('Rol inválido');
    if (data.activo !== undefined && typeof data.activo !== 'boolean')
      throw new BadRequestException('Acceso inválido');
    const changes = {
      ...(data.name !== undefined
        ? { name: this.cleanText(data.name, 'El nombre', 100, true) }
        : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.activo !== undefined ? { activo: data.activo } : {}),
      updatedAt: new Date(),
    };
    await this.db
      .update(schema.user)
      .set(changes)
      .where(eq(schema.user.id, id));
    return { ok: true };
  }

  // Fija una contraseña nueva y cierra todas sus sesiones abiertas.
  async restablecerPassword(id: string, password: unknown, actorId?: string) {
    if (id === actorId)
      throw new BadRequestException(
        'Otra persona de administración debe restablecer tu contraseña',
      );
    if (typeof password !== 'string' || password.length < 8)
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres',
      );
    if (password.length > 128)
      throw new BadRequestException(
        'La contraseña debe tener como máximo 128 caracteres',
      );

    const [existing] = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, id));
    if (!existing) throw new NotFoundException('Usuario no encontrado');

    const hashed = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      const [cuenta] = await tx
        .select({ id: schema.account.id })
        .from(schema.account)
        .where(
          and(
            eq(schema.account.userId, id),
            eq(schema.account.providerId, 'credential'),
          ),
        );
      if (cuenta) {
        await tx
          .update(schema.account)
          .set({ password: hashed, updatedAt: new Date() })
          .where(eq(schema.account.id, cuenta.id));
      } else {
        await tx.insert(schema.account).values({
          id: randomUUID(),
          userId: id,
          accountId: id,
          providerId: 'credential',
          password: hashed,
        });
      }
      await tx.delete(schema.session).where(eq(schema.session.userId, id));
    });
    return { ok: true };
  }

  private cleanText(
    value: unknown,
    label: string,
    max: number,
    required = false,
  ) {
    if (
      typeof value !== 'string' ||
      value.trim().length > max ||
      (required && !value.trim())
    )
      throw new BadRequestException(
        `${label} debe tener ${required ? 'entre 1 y' : 'como máximo'} ${max} caracteres`,
      );
    return value.trim();
  }

  async getSettings() {
    const [config] = await this.db
      .select()
      .from(schema.localConfig)
      .where(eq(schema.localConfig.id, 'principal'));
    return (
      config ?? {
        nombre: process.env.STORE_NAME || 'FoxEats',
        logo: null,
        direccion: '',
        telefono: '',
      }
    );
  }

  async updateSettings(body: {
    nombre: string;
    logo: string | null;
    direccion: string;
    telefono: string;
  }) {
    if (!body || typeof body !== 'object')
      throw new BadRequestException('Datos inválidos');
    const nombre = this.cleanText(
      body.nombre,
      'El nombre del local',
      100,
      true,
    );
    const direccion = this.cleanText(body.direccion, 'La dirección', 240);
    const telefono = this.cleanText(body.telefono, 'El teléfono', 40);
    const logo = body.logo;
    if (
      logo !== null &&
      (typeof logo !== 'string' ||
        logo.length > 350000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo))
    )
      throw new BadRequestException(
        'Usa un logo PNG, JPG o WebP de hasta 250 KB',
      );
    const values = { nombre, direccion, telefono, logo, updatedAt: new Date() };
    const [saved] = await this.db
      .insert(schema.localConfig)
      .values({ id: 'principal', ...values })
      .onConflictDoUpdate({ target: schema.localConfig.id, set: values })
      .returning();
    return saved;
  }
}
