// Maquetación de tickets para papel térmico de 80 mm.
//
// 80 mm = 576 puntos imprimibles; con la fuente A (12×24) son 48 columnas.
// Un mismo ticket se compone una vez y se vuelve ESC/POS (ticketera de red) o
// texto plano (simulada), así lo que se ve en desarrollo es lo que sale en papel.

export const COLS = 48;
const DOTS = 576;

export interface Estilo {
  /** Negrita. */
  b?: boolean;
  /** Doble alto: la línea sigue teniendo 48 columnas. */
  alto?: boolean;
  /** Doble alto y doble ancho: 24 columnas. */
  grande?: boolean;
  /** Texto blanco sobre fondo negro. */
  inv?: boolean;
}

const ESC = 0x1b;
const GS = 0x1d;

// Solo ASCII: sin tildes ni símbolos, para que ninguna ticketera los imprima mal.
export function ascii(texto: string): string {
  return texto
    .replace(/[ñÑ]/g, (c) => (c === 'ñ' ? 'n' : 'N'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿¡]/g, '')
    .replace(/[·»]/g, "-")
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '.')
    .replace(/[^\x20-\x7e]/g, '?');
}

function codificar(texto: string): Buffer {
  return Buffer.from(ascii(texto), 'latin1');
}

/** Parte un texto en líneas de hasta `ancho` columnas sin cortar palabras (salvo que no quepan). */
export function envolver(texto: string, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of texto.trim().split(/\s+/)) {
    if (!palabra) continue;
    let p = palabra;
    while (p.length > ancho) {
      if (actual) {
        lineas.push(actual);
        actual = '';
      }
      lineas.push(p.slice(0, ancho));
      p = p.slice(ancho);
    }
    if (!actual) actual = p;
    else if (actual.length + 1 + p.length <= ancho) actual += ' ' + p;
    else {
      lineas.push(actual);
      actual = p;
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}

export function dinero(n: number): string {
  return `S/ ${n.toFixed(2)}`;
}

export function fechaHora(d: Date): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return {
    fecha: `${v('day')}/${v('month')}/${v('year')}`,
    hora: `${v('hour')}:${v('minute')}`,
  };
}

function anchoDe(e?: Estilo) {
  return e?.grande ? COLS / 2 : COLS;
}

export class Ticket {
  private esc: Buffer[] = [
    // Reinicia, margen izquierdo 0 y área de impresión completa de 576 puntos.
    Buffer.from([ESC, 0x40, GS, 0x4c, 0, 0, GS, 0x57, DOTS & 0xff, DOTS >> 8]),
  ];
  private txt: string[] = [];

  private estilo(e?: Estilo): Buffer {
    const tam = e?.grande ? 0x11 : e?.alto ? 0x01 : 0x00;
    return Buffer.from([ESC, 0x45, e?.b || e?.grande ? 1 : 0, GS, 0x21, tam, GS, 0x42, e?.inv ? 1 : 0]);
  }

  private alinear(a: 'i' | 'c' | 'd'): Buffer {
    return Buffer.from([ESC, 0x61, a === 'i' ? 0 : a === 'c' ? 1 : 2]);
  }

  private linea(texto: string, a: 'i' | 'c' | 'd', e?: Estilo) {
    this.esc.push(this.alinear(a), this.estilo(e), codificar(texto), Buffer.from([0x0a]), this.estilo());
    const ancho = COLS;
    const visible = e?.grande ? texto.length * 2 : texto.length;
    const pad = a === 'c' ? Math.max(0, Math.floor((ancho - visible) / 2)) : a === 'd' ? Math.max(0, ancho - visible) : 0;
    this.txt.push(' '.repeat(pad) + ascii(texto));
  }

  /** Texto centrado; envuelve si no cabe. */
  centro(texto: string, e?: Estilo): this {
    for (const l of envolver(texto, anchoDe(e) - (e?.inv ? 2 : 0))) {
      this.linea(e?.inv ? ` ${l} ` : l, 'c', e);
    }
    return this;
  }

  /** Texto a la izquierda; las líneas siguientes llevan `sangria` espacios. */
  izq(texto: string, e?: Estilo, sangria = 0): this {
    const ancho = anchoDe(e) - sangria;
    envolver(texto, ancho).forEach((l, i) => {
      this.linea((i === 0 ? '' : ' '.repeat(sangria)) + l, 'i', e);
    });
    return this;
  }

  /** Etiqueta a la izquierda y valor pegado al borde derecho. */
  fila(izq: string, der: string, e?: Estilo): this {
    const ancho = anchoDe(e);
    const espacio = Math.max(1, ancho - izq.length - der.length);
    if (izq.length + der.length + 1 > ancho) {
      // No caben juntos: la etiqueta se acorta con «…» y el valor se conserva entero.
      izq = izq.slice(0, Math.max(0, ancho - der.length - 2)) + '.';
      return this.fila(izq, der, e);
    }
    this.linea(izq + ' '.repeat(espacio) + der, 'i', e);
    return this;
  }

  /** Renglón de consumo: «cant  descripción ...... importe»; la descripción larga baja a otra línea. */
  item(cant: number, nombre: string, importe: string, e?: Estilo): this {
    const col = `${cant}x`.padEnd(5);
    const ancho = COLS - col.length - importe.length - 1;
    const partes = envolver(nombre, ancho);
    partes.forEach((p, i) => {
      if (i === 0) this.linea(col + p.padEnd(ancho) + ' ' + importe, 'i', e);
      else this.linea(' '.repeat(col.length) + p, 'i', e);
    });
    return this;
  }

  /** Línea secundaria sangrada bajo un renglón, con valor opcional a la derecha. */
  detalle(texto: string, der = '', sangria = 5): this {
    // Las viñetas («· », «» ») cuelgan: la continuación se alinea con el texto, no con el símbolo.
    const cuelga = /^[->] /.test(texto) ? 2 : 0;
    const ancho = COLS - sangria - cuelga - (der ? der.length + 1 : 0);
    const marca = texto.slice(0, cuelga);
    envolver(texto.slice(cuelga), ancho).forEach((l, i, todo) => {
      const final = i === todo.length - 1 && der ? ' '.repeat(Math.max(1, COLS - sangria - cuelga - l.length - der.length)) + der : '';
      this.linea(' '.repeat(sangria) + (i === 0 ? marca : ' '.repeat(cuelga)) + l + final, 'i');
    });
    return this;
  }

  sep(trazo: '-' | '=' = '-'): this {
    this.linea(trazo.repeat(COLS), 'i');
    return this;
  }

  blanco(n = 1): this {
    for (let i = 0; i < n; i++) this.linea('', 'i');
    return this;
  }

  /** Imagen ya rasterizada (GS v 0) centrada. */
  imagen(raster: Buffer): this {
    this.esc.push(this.alinear('c'), raster, Buffer.from([0x0a]));
    this.txt.push('[ LOGO ]'.padStart(Math.floor((COLS + 8) / 2)));
    return this;
  }

  /** Avanza el papel y corta (parcial). */
  cortar(): this {
    this.esc.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00]));
    return this;
  }

  aEscPos(): Buffer {
    return Buffer.concat(this.esc);
  }

  aTexto(): string {
    return this.txt.join('\n') + '\n';
  }
}
