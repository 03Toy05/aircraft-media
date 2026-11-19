CREATE TABLE "cbos_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aircraft_media_id" uuid NOT NULL,
	"content_version_id" uuid NOT NULL,
	"drive_file_id" text NOT NULL,
	"drive_folder_id" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cbos_exports" ADD CONSTRAINT "cbos_exports_aircraft_media_id_aircraft_media_id_fk" FOREIGN KEY ("aircraft_media_id") REFERENCES "public"."aircraft_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cbos_export_media_uq" ON "cbos_exports" USING btree ("aircraft_media_id");
