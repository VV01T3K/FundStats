CREATE TABLE "source_schedules" (
	"source" text PRIMARY KEY NOT NULL,
	"interval_seconds" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
