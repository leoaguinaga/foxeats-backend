import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from './schema';

type Rol = 'mesero' | 'cajero' | 'administracion';

const SEED_USERS: Array<{
  email: string;
  name: string;
  role: Rol;
  password: string;
}> = [
  {
    email: 'admin@misterluka.local',
    name: 'Administración',
    role: 'administracion',
    password: 'admin1234',
  },
  {
    email: 'cajero@misterluka.local',
    name: 'Cajero Demo',
    role: 'cajero',
    password: 'cajero1234',
  },
  {
    email: 'mesero@misterluka.local',
    name: 'Mesero Demo',
    role: 'mesero',
    password: 'mesero1234',
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });

  for (const u of SEED_USERS) {
    const [existing] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, u.email));
    if (existing) {
      console.log(`✓ Usuario ya existe: ${u.email}`);
      continue;
    }

    const userId = randomUUID();
    const accountId = randomUUID();
    const hashed = await hashPassword(u.password);

    await db.insert(schema.user).values({
      id: userId,
      name: u.name,
      email: u.email,
      emailVerified: true,
      role: u.role,
    });

    await db.insert(schema.account).values({
      id: accountId,
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hashed,
    });

    console.log(`✓ Creado: ${u.email} (${u.role}) — password: ${u.password}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
