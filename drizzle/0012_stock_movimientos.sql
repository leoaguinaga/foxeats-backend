ALTER TABLE "insumo" ADD COLUMN IF NOT EXISTS "minimo" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "insumo" ADD COLUMN IF NOT EXISTS "nombre_unidad_compra" text DEFAULT 'paquete' NOT NULL;
--> statement-breakpoint
ALTER TABLE "insumo" ADD COLUMN IF NOT EXISTS "orden_conteo" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tipo_movimiento_stock" AS ENUM('venta', 'anulacion', 'compra', 'merma', 'conteo', 'correccion');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compra_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text REFERENCES "user"("id"),
	"proveedor" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conteo_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text REFERENCES "user"("id"),
	"insumos_contados" integer DEFAULT 0 NOT NULL,
	"diferencias" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "movimiento_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insumo_id" uuid NOT NULL REFERENCES "insumo"("id") ON DELETE CASCADE,
	"tipo" "tipo_movimiento_stock" NOT NULL,
	"cantidad" integer NOT NULL,
	"saldo" integer NOT NULL,
	"usuario_id" text REFERENCES "user"("id"),
	"motivo" text,
	"nota" text,
	"pedido_id" uuid,
	"plato_carta_id" uuid,
	"compra_id" uuid REFERENCES "compra_stock"("id") ON DELETE SET NULL,
	"conteo_id" uuid REFERENCES "conteo_stock"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movimiento_stock_insumo_fecha_idx" ON "movimiento_stock" ("insumo_id", "created_at");
--> statement-breakpoint
-- Mínimo inicial: el «5 fijo» que usaba la pantalla, convertido a la unidad
-- mínima de cada insumo (los fraccionables avisan al llegar a 2 unidades de compra).
UPDATE "insumo" SET "minimo" = CASE WHEN "unidades_por_unidad_compra" > 1 THEN "unidades_por_unidad_compra" * 2 ELSE 5 END WHERE "minimo" = 0;
--> statement-breakpoint
UPDATE "insumo" SET "nombre_unidad_compra" = CASE WHEN "unidades_por_unidad_compra" > 1 AND "nombre" ILIKE '%pollo%' THEN 'pollo' WHEN "unidades_por_unidad_compra" > 1 THEN 'paquete' ELSE "nombre_unidad_minima" END;
