import { BadRequestException } from '@nestjs/common';

type PlatoArmable = {
  nombre: string;
  combo: { elegir: number; opciones: string[] } | null;
};

/**
 * Un plato armable ("Arma tu dúo") se pide de a uno, con exactamente
 * `elegir` opciones de su lista. Un plato normal ignora las elecciones.
 * Devuelve las elecciones a guardar (null si el plato no es armable).
 */
export function validarElecciones(
  plato: PlatoArmable,
  item: { cantidad: number; elecciones?: string[] },
): string[] | null {
  if (!plato.combo) return null;
  const { elegir, opciones } = plato.combo;
  const elecciones = item.elecciones ?? [];
  if (item.cantidad !== 1) {
    throw new BadRequestException(
      `"${plato.nombre}" se pide de a uno: cada uno lleva sus propias opciones`,
    );
  }
  if (
    elecciones.length !== elegir ||
    elecciones.some((e) => !opciones.includes(e))
  ) {
    throw new BadRequestException(
      `Elige ${elegir} opciones para "${plato.nombre}"`,
    );
  }
  return elecciones;
}
