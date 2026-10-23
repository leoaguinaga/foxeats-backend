CREATE TYPE "public"."tipo_mesa" AS ENUM('mesa', 'barra');
--> statement-breakpoint
ALTER TABLE "mesa" ADD COLUMN IF NOT EXISTS "tipo" "tipo_mesa" DEFAULT 'mesa' NOT NULL;
