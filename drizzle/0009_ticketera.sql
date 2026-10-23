CREATE TYPE "public"."tipo_ticketera" AS ENUM('cocina', 'recibos');
--> statement-breakpoint
CREATE TYPE "public"."modo_ticketera" AS ENUM('simulada', 'red');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticketera" (
	"tipo" "tipo_ticketera" PRIMARY KEY NOT NULL,
	"modo" "modo_ticketera" DEFAULT 'simulada' NOT NULL,
	"ip" text,
	"puerto" integer DEFAULT 9100 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "ticketera" ("tipo") VALUES ('cocina'), ('recibos') ON CONFLICT DO NOTHING;
