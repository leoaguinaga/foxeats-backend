ALTER TABLE "plato_carta" ADD COLUMN "mostrar_descripcion_en_cocina" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plato_carta" ADD COLUMN "combo" jsonb;--> statement-breakpoint
ALTER TABLE "item_pedido" ADD COLUMN "elecciones" jsonb;
