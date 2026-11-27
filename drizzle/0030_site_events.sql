CREATE TABLE IF NOT EXISTS "site_events" (
	"day" text NOT NULL,
	"event" text NOT NULL,
	"lang" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_events_pk" PRIMARY KEY ("day", "event", "lang")
);
