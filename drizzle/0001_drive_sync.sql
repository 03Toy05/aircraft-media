CREATE TABLE "drive_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"folder_id" text NOT NULL,
	"folder_name" text,
	"last_synced_at" timestamp with time zone,
	"last_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drive_sync_folder_uq" ON "drive_sync_state" USING btree ("tenant_id","folder_id");