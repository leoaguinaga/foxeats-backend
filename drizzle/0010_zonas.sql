CREATE TYPE "public"."modo_zona" AS ENUM('plano', 'numeros');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zona" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"modo" "modo_zona" DEFAULT 'plano' NOT NULL,
	"filas" integer DEFAULT 4 NOT NULL,
	"columnas" integer DEFAULT 6 NOT NULL,
	"referencias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mesa" ADD COLUMN IF NOT EXISTS "zona_id" uuid REFERENCES "zona"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "mesa" ADD COLUMN IF NOT EXISTS "ancho" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Zona inicial con el tamaño del plano actual; recibe todas las mesas reales
-- (la mesa 0 es la virtual heredada de «para llevar» y queda sin zona).
WITH z AS (
	INSERT INTO "zona" ("nombre", "orden", "modo", "filas", "columnas")
	SELECT 'Salón principal', 0, 'plano',
		GREATEST(COALESCE(MAX("fila_posicion") + 1, 0), 4),
		GREATEST(COALESCE(MAX("col_posicion") + 1, 0), 6)
	FROM "mesa" WHERE "numero" <> 0
	RETURNING "id"
)
UPDATE "mesa" SET "zona_id" = (SELECT "id" FROM z) WHERE "numero" <> 0;
