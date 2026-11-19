import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OperacionService } from './operacion.service';

interface MockState {
  visita: {
    id: string;
    mesaId: string | null;
    estado: 'abierta' | 'cerrada';
    tipo: 'mesa' | 'llevar' | 'delivery';
    paraLlevar: boolean;
  } | null;
  mesaDestino: {
    id: string;
    numero: number;
    estado: 'libre' | 'ocupada';
  } | null;
  ocuparExito?: boolean;
}

function setup(state: MockState) {
  const updates: Array<{ set: unknown }> = [];
  let selectCall = 0;

  const tx = {
    select: () => ({
      from: () => ({
        where: async () => {
          selectCall += 1;
          if (selectCall === 1) return state.visita ? [state.visita] : [];
          return state.mesaDestino ? [state.mesaDestino] : [];
        },
      }),
    }),
    update: () => ({
      set: (value: unknown) => {
        updates.push({ set: value });
        return {
          where: () => {
            const p = Promise.resolve([]);
            return Object.assign(p, {
              returning: async () =>
                (state.ocuparExito ?? state.mesaDestino?.estado === 'libre')
                  ? [{ ...state.mesaDestino, estado: 'ocupada' }]
                  : [],
            });
          },
        };
      },
    }),
  };

  const db = {
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };

  const service = new OperacionService(
    db as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const visitaActualizada = { id: state.visita?.id ?? 'v1', mesaId: 'm2' };
  jest
    .spyOn(service, 'getVisita')
    .mockResolvedValue(visitaActualizada as never);

  return { service, updates, visitaActualizada };
}

describe('OperacionService.cambiarMesa', () => {
  it('mueve la visita a una mesa libre y libera la mesa de origen', async () => {
    const { service, updates, visitaActualizada } = setup({
      visita: {
        id: 'v1',
        mesaId: 'm1',
        estado: 'abierta',
        tipo: 'mesa',
        paraLlevar: false,
      },
      mesaDestino: { id: 'm2', numero: 5, estado: 'libre' },
    });

    const result = await service.cambiarMesa('v1', 'm2');

    expect(result).toBe(visitaActualizada);
    expect(updates).toHaveLength(3);
    expect(updates[0].set).toEqual({
      estado: 'ocupada',
      updatedAt: expect.any(Date),
    });
    expect(updates[1].set).toEqual({
      estado: 'libre',
      updatedAt: expect.any(Date),
    });
    expect(updates[2].set).toEqual({ mesaId: 'm2' });
  });

  it('rechaza si no se envía mesa de destino', async () => {
    const { service } = setup({ visita: null, mesaDestino: null });
    await expect(service.cambiarMesa('v1', '   ')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza si la visita no existe o está cerrada', async () => {
    const { service: s1 } = setup({ visita: null, mesaDestino: null });
    await expect(s1.cambiarMesa('v1', 'm2')).rejects.toThrow(NotFoundException);

    const { service: s2 } = setup({
      visita: {
        id: 'v1',
        mesaId: 'm1',
        estado: 'cerrada',
        tipo: 'mesa',
        paraLlevar: false,
      },
      mesaDestino: { id: 'm2', numero: 5, estado: 'libre' },
    });
    await expect(s2.cambiarMesa('v1', 'm2')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza visitas para llevar/delivery o cambiar a la misma mesa', async () => {
    const { service: s1 } = setup({
      visita: {
        id: 'v1',
        mesaId: 'm0',
        estado: 'abierta',
        tipo: 'llevar',
        paraLlevar: true,
      },
      mesaDestino: { id: 'm2', numero: 5, estado: 'libre' },
    });
    await expect(s1.cambiarMesa('v1', 'm2')).rejects.toThrow(
      BadRequestException,
    );

    const { service: s2 } = setup({
      visita: {
        id: 'v1',
        mesaId: 'm1',
        estado: 'abierta',
        tipo: 'mesa',
        paraLlevar: false,
      },
      mesaDestino: { id: 'm1', numero: 1, estado: 'ocupada' },
    });
    await expect(s2.cambiarMesa('v1', 'm1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza si la mesa destino no existe, es virtual (0) o está ocupada', async () => {
    const { service: s1 } = setup({
      visita: {
        id: 'v1',
        mesaId: 'm1',
        estado: 'abierta',
        tipo: 'mesa',
        paraLlevar: false,
      },
      mesaDestino: null,
    });
    await expect(s1.cambiarMesa('v1', 'm9')).rejects.toThrow(NotFoundException);

    const { service: s2 } = setup({
      visita: {
        id: 'v1',
        mesaId: 'm1',
        estado: 'abierta',
        tipo: 'mesa',
        paraLlevar: false,
      },
      mesaDestino: { id: 'm0', numero: 0, estado: 'libre' },
    });
    await expect(s2.cambiarMesa('v1', 'm0')).rejects.toThrow(
      BadRequestException,
    );

    const { service: s3, updates } = setup({
      visita: {
        id: 'v1',
        mesaId: 'm1',
        estado: 'abierta',
        tipo: 'mesa',
        paraLlevar: false,
      },
      mesaDestino: { id: 'm2', numero: 5, estado: 'ocupada' },
    });
    await expect(s3.cambiarMesa('v1', 'm2')).rejects.toThrow(
      BadRequestException,
    );
    expect(updates).toHaveLength(1);
  });
});
