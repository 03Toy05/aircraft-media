ALTER TYPE "public"."media_classification" RENAME VALUE 'cabin' TO 'interior';--> statement-breakpoint
UPDATE "aircraft_media" SET "primary_classification" = 'interior' WHERE "primary_classification" IN ('seating', 'sleeping', 'galley', 'lavatory', 'flight_deck', 'baggage', 'other');
