jest.mock('../auth/auth.config', () => ({ auth: { api: {} } }));
import { AdminService } from './admin.service';

function setup() {
  const writes: unknown[] = [];
  const db = {
    select: () => ({ from: () => ({ where: async () => [{ id: 'worker' }] }) }),
    update: () => ({
      set: (value: unknown) => {
        writes.push(value);
        return { where: async () => [] };
      },
    }),
    insert: () => ({
      values: (value: unknown) => {
        writes.push(value);
        return {
          onConflictDoUpdate: () => ({ returning: async () => [value] }),
        };
      },
    }),
  };
  return { service: new AdminService(db as never), writes };
}

describe('Admin settings and names', () => {
  it('trims names and only updates allowed fields', async () => {
    const { service, writes } = setup();
    await service.updateUsuario(
      'worker',
      { name: '  Luis  ', email: 'ignored' } as never,
      'admin',
    );
    expect(writes[0]).toEqual({ name: 'Luis', updatedAt: expect.any(Date) });
  });
  it('rejects blank names and self access changes', async () => {
    const { service, writes } = setup();
    await expect(
      service.updateUsuario('worker', { name: ' ' }, 'admin'),
    ).rejects.toThrow();
    await expect(
      service.updateUsuario('admin', { activo: false }, 'admin'),
    ).rejects.toThrow();
    await expect(
      service.updateUsuario('admin', { role: 'mesero' }, 'admin'),
    ).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });
  it('allows administrators to rename themselves', async () => {
    const { service } = setup();
    await expect(
      service.updateUsuario('admin', { name: 'Ana' }, 'admin'),
    ).resolves.toEqual({ ok: true });
  });
  it('saves normalized local data and rejects unsafe logo formats', async () => {
    const { service, writes } = setup();
    await expect(
      service.updateSettings({
        nombre: '  Local  ',
        logo: null,
        direccion: '',
        telefono: '',
      }),
    ).resolves.toMatchObject({ nombre: 'Local' });
    await expect(
      service.updateSettings({
        nombre: 'Local',
        logo: 'data:image/svg+xml;base64,xxx',
        direccion: '',
        telefono: '',
      }),
    ).rejects.toThrow();
    expect(writes).toHaveLength(1);
  });
});
