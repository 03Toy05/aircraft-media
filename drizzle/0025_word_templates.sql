CREATE TABLE IF NOT EXISTS "word_templates" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"docx" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
