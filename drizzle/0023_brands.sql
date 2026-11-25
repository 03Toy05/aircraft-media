CREATE TABLE IF NOT EXISTS "brands" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"logo_png" text,
	"logo_width" integer,
	"logo_height" integer,
	"color" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
