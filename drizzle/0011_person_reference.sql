ALTER TABLE "contacts" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "english_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_reference_uq" ON "contacts" USING btree ("tenant_id","reference");
