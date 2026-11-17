CREATE TABLE "collection_runs" (
	"id" serial PRIMARY KEY,
	"source" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"instrument_count" integer DEFAULT 0 NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" serial PRIMARY KEY,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text,
	"category" text,
	"currency" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"last_seen_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" serial PRIMARY KEY,
	"run_id" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" bigserial PRIMARY KEY,
	"instrument_id" integer NOT NULL,
	"run_id" integer,
	"captured_at" timestamp with time zone NOT NULL,
	"as_of" date,
	"value" numeric,
	"metrics" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_schedules" (
	"source" text PRIMARY KEY,
	"interval_seconds" integer NOT NULL,
	"enabled" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX "collection_runs_source_started_idx" ON "collection_runs" ("source","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_source_external_idx" ON "instruments" ("source","external_id");--> statement-breakpoint
CREATE INDEX "instruments_source_last_seen_idx" ON "instruments" ("source","last_seen_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_payloads_run_idx" ON "raw_payloads" ("run_id");--> statement-breakpoint
CREATE INDEX "raw_payloads_fetched_idx" ON "raw_payloads" ("fetched_at");--> statement-breakpoint
CREATE INDEX "snapshots_instrument_captured_idx" ON "snapshots" ("instrument_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_instrument_as_of_idx" ON "snapshots" ("instrument_id","as_of") WHERE "as_of" is not null;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_last_seen_run_id_collection_runs_id_fkey" FOREIGN KEY ("last_seen_run_id") REFERENCES "collection_runs"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "raw_payloads" ADD CONSTRAINT "raw_payloads_run_id_collection_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "collection_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_run_id_collection_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "collection_runs"("id") ON DELETE SET NULL;