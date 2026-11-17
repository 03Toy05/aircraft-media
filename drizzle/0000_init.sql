CREATE TYPE "public"."action_status" AS ENUM('pending', 'succeeded', 'partially_succeeded', 'failed', 'outcome_uncertain');--> statement-breakpoint
CREATE TYPE "public"."association_status" AS ENUM('actual_aircraft', 'representative_type', 'unresolved');--> statement-breakpoint
CREATE TYPE "public"."base_mode" AS ENUM('based', 'floating');--> statement-breakpoint
CREATE TYPE "public"."media_classification" AS ENUM('exterior', 'cabin', 'seating', 'sleeping', 'galley', 'lavatory', 'flight_deck', 'baggage', 'floor_plan', 'other', 'unclassified');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_state" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('operator', 'management_company');--> statement-breakpoint
CREATE TYPE "public"."proposal_state" AS ENUM('pending', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('received', 'processing', 'needs_review', 'approved', 'rejected', 'failed', 'partially_processed');--> statement-breakpoint
CREATE TYPE "public"."rights_status" AS ENUM('permitted', 'restricted', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('drive', 'whatsapp', 'manual', 'pdf', 'extracted_image');--> statement-breakpoint
CREATE TYPE "public"."wifi_status" AS ENUM('yes', 'no', 'tbc', 'unknown');--> statement-breakpoint
CREATE TABLE "action_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"action_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"status" "action_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"safe_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "aircraft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aircraft_type_id" uuid NOT NULL,
	"serial_number" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_source_evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aircraft_bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aircraft_id" uuid NOT NULL,
	"mode" "base_mode" NOT NULL,
	"location" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"source_evidence_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aircraft_information_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aircraft_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"yom" integer,
	"yor" integer,
	"capacity" integer,
	"wifi_status" "wifi_status" DEFAULT 'unknown' NOT NULL,
	"notes" text,
	"source_evidence_id" uuid,
	"effective_date" date,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aircraft_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"current_content_version_id" uuid,
	"primary_classification" "media_classification" DEFAULT 'unclassified' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"review_state" "review_state" DEFAULT 'received' NOT NULL,
	"lifecycle_state" "lifecycle_state" DEFAULT 'active' NOT NULL,
	"association_status" "association_status" DEFAULT 'unresolved' NOT NULL,
	"rights_status" "rights_status" DEFAULT 'unknown' NOT NULL,
	"rejection_reason" text,
	"created_source_evidence_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aircraft_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aircraft_id" uuid NOT NULL,
	"registration" text NOT NULL,
	"normalized_registration" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"is_current" boolean DEFAULT true NOT NULL,
	"source_evidence_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aircraft_type_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aircraft_type_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aircraft_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"manufacturer" text NOT NULL,
	"model" text NOT NULL,
	"normalized_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_associations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aircraft_media_id" uuid NOT NULL,
	"aircraft_id" uuid,
	"aircraft_type_id" uuid,
	"organisation_id" uuid,
	"association_status" "association_status" NOT NULL,
	"source_evidence_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aircraft_media_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"storage_kind" text DEFAULT 'local' NOT NULL,
	"storage_ref" text NOT NULL,
	"drive_revision" text,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"is_derivative" boolean DEFAULT false NOT NULL,
	"parent_content_version_id" uuid,
	"source_evidence_id" uuid,
	"unavailable_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_aircraft_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"aircraft_id" uuid NOT NULL,
	"role" "org_role" NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"source_evidence_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"role" "org_role" NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"source_evidence_id" uuid,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_evidence_id" uuid,
	"aircraft_media_id" uuid,
	"proposal_type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"proposal" jsonb NOT NULL,
	"confidence" text,
	"evidence" jsonb,
	"state" "proposal_state" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"provider_source_id" text,
	"original_filename" text,
	"original_drive_file_id" text,
	"original_drive_version" text,
	"parent_evidence_id" uuid,
	"page_number" integer,
	"crop_ref" jsonb,
	"sender_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"original_text" text,
	"content_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lifecycle_status" text DEFAULT 'retained' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_whatsapp_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"verified_number_id" uuid,
	"request_message_id" text NOT NULL,
	"aircraft_id" uuid,
	"organisation_id" uuid,
	"information_version_id" uuid,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aircraft" ADD CONSTRAINT "aircraft_aircraft_type_id_aircraft_types_id_fk" FOREIGN KEY ("aircraft_type_id") REFERENCES "public"."aircraft_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aircraft" ADD CONSTRAINT "aircraft_created_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("created_source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aircraft_bases" ADD CONSTRAINT "aircraft_bases_aircraft_id_aircraft_id_fk" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aircraft_bases" ADD CONSTRAINT "aircraft_bases_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aircraft_information_versions" ADD CONSTRAINT "aircraft_information_versions_aircraft_id_aircraft_id_fk" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aircraft_information_versions" ADD CONSTRAINT "aircraft_information_versions_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aircraft_media" ADD CONSTRAINT "aircraft_media_created_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("created_source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aircraft_registrations" ADD CONSTRAINT "aircraft_registrations_aircraft_id_aircraft_id_fk" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aircraft_registrations" ADD CONSTRAINT "aircraft_registrations_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aircraft_type_aliases" ADD CONSTRAINT "aircraft_type_aliases_aircraft_type_id_aircraft_types_id_fk" FOREIGN KEY ("aircraft_type_id") REFERENCES "public"."aircraft_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_associations" ADD CONSTRAINT "media_associations_aircraft_media_id_aircraft_media_id_fk" FOREIGN KEY ("aircraft_media_id") REFERENCES "public"."aircraft_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_associations" ADD CONSTRAINT "media_associations_aircraft_id_aircraft_id_fk" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_associations" ADD CONSTRAINT "media_associations_aircraft_type_id_aircraft_types_id_fk" FOREIGN KEY ("aircraft_type_id") REFERENCES "public"."aircraft_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_associations" ADD CONSTRAINT "media_associations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_associations" ADD CONSTRAINT "media_associations_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_content_versions" ADD CONSTRAINT "media_content_versions_aircraft_media_id_aircraft_media_id_fk" FOREIGN KEY ("aircraft_media_id") REFERENCES "public"."aircraft_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_content_versions" ADD CONSTRAINT "media_content_versions_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_aircraft_relationships" ADD CONSTRAINT "organisation_aircraft_relationships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_aircraft_relationships" ADD CONSTRAINT "organisation_aircraft_relationships_aircraft_id_aircraft_id_fk" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_aircraft_relationships" ADD CONSTRAINT "organisation_aircraft_relationships_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_aliases" ADD CONSTRAINT "organisation_aliases_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_roles" ADD CONSTRAINT "organisation_roles_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_roles" ADD CONSTRAINT "organisation_roles_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_proposals" ADD CONSTRAINT "processing_proposals_source_evidence_id_source_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."source_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_proposals" ADD CONSTRAINT "processing_proposals_aircraft_media_id_aircraft_media_id_fk" FOREIGN KEY ("aircraft_media_id") REFERENCES "public"."aircraft_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_whatsapp_numbers" ADD CONSTRAINT "verified_whatsapp_numbers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_verified_number_id_verified_whatsapp_numbers_id_fk" FOREIGN KEY ("verified_number_id") REFERENCES "public"."verified_whatsapp_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_aircraft_id_aircraft_id_fk" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_information_version_id_aircraft_information_versions_id_fk" FOREIGN KEY ("information_version_id") REFERENCES "public"."aircraft_information_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_action_execution_id_action_executions_id_fk" FOREIGN KEY ("action_execution_id") REFERENCES "public"."action_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_idem_uq" ON "action_executions" USING btree ("tenant_id","action_name","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "aircraft_type_serial_uq" ON "aircraft" USING btree ("tenant_id","aircraft_type_id","serial_number") WHERE "aircraft"."serial_number" is not null and "aircraft"."active";--> statement-breakpoint
CREATE INDEX "base_aircraft_idx" ON "aircraft_bases" USING btree ("aircraft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "info_version_uq" ON "aircraft_information_versions" USING btree ("aircraft_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "info_one_current_uq" ON "aircraft_information_versions" USING btree ("aircraft_id") WHERE "aircraft_information_versions"."is_current";--> statement-breakpoint
CREATE INDEX "media_state_idx" ON "aircraft_media" USING btree ("tenant_id","review_state","lifecycle_state");--> statement-breakpoint
CREATE UNIQUE INDEX "reg_one_current_uq" ON "aircraft_registrations" USING btree ("aircraft_id") WHERE "aircraft_registrations"."is_current";--> statement-breakpoint
CREATE INDEX "reg_norm_idx" ON "aircraft_registrations" USING btree ("normalized_registration");--> statement-breakpoint
CREATE UNIQUE INDEX "type_alias_uq" ON "aircraft_type_aliases" USING btree ("aircraft_type_id","normalized_alias");--> statement-breakpoint
CREATE UNIQUE INDEX "type_tenant_norm_uq" ON "aircraft_types" USING btree ("tenant_id","normalized_name") WHERE "aircraft_types"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "assoc_one_active_uq" ON "media_associations" USING btree ("aircraft_media_id") WHERE "media_associations"."active";--> statement-breakpoint
CREATE INDEX "assoc_aircraft_idx" ON "media_associations" USING btree ("aircraft_id");--> statement-breakpoint
CREATE INDEX "assoc_type_idx" ON "media_associations" USING btree ("aircraft_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_version_uq" ON "media_content_versions" USING btree ("aircraft_media_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rel_one_active_operator_uq" ON "organisation_aircraft_relationships" USING btree ("aircraft_id") WHERE "organisation_aircraft_relationships"."active" and "organisation_aircraft_relationships"."role" = 'operator';--> statement-breakpoint
CREATE INDEX "rel_org_idx" ON "organisation_aircraft_relationships" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_alias_uq" ON "organisation_aliases" USING btree ("organisation_id","normalized_alias");--> statement-breakpoint
CREATE UNIQUE INDEX "org_tenant_norm_uq" ON "organisations" USING btree ("tenant_id","normalized_name") WHERE "organisations"."active";--> statement-breakpoint
CREATE INDEX "evidence_hash_idx" ON "source_evidence" USING btree ("tenant_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_uq" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_active_phone_uq" ON "verified_whatsapp_numbers" USING btree ("tenant_id","phone") WHERE "verified_whatsapp_numbers"."active";