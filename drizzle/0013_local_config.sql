CREATE TABLE "local_config" (
  "id" text PRIMARY KEY DEFAULT 'principal' NOT NULL,
  "nombre" text NOT NULL,
  "logo" text,
  "direccion" text DEFAULT '' NOT NULL,
  "telefono" text DEFAULT '' NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "local_config_singleton" CHECK ("id" = 'principal')
);
