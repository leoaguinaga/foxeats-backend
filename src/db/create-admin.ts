import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from './schema';

// Crea (o restablece) un usuario de administración.
// Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... [ADMIN_NAME=...] pnpm db:create-admin
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? 'Administración';
  if (!email || !password || password.length < 8) {
    console.error('Define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres)');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });
  const hashed = await hashPassword(password);

  const [existing] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email));

  if (existing) {
    await db
      .update(schema.user)
      .set({ role: 'administracion', activo: true })
      .where(eq(schema.user.id, existing.id));
    await db
      .update(schema.account)
      .set({ password: hashed })
      .where(eq(schema.account.userId, existing.id));
    console.log(`✓ Admin actualizado: ${email}`);
  } else {
    const userId = randomUUID();
    await db.insert(schema.user).values({
      id: userId,
      name,
      email,
      emailVerified: true,
      role: 'administracion',
    });
    await db.insert(schema.account).values({
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hashed,
    });
    console.log(`✓ Admin creado: ${email}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
