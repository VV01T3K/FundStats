CREATE TYPE "fund_risk" AS ENUM ('Low', 'Moderate', 'Elevated', 'High');

CREATE TABLE "fund_stats" (
  "id" text PRIMARY KEY NOT NULL,
  "symbol" text NOT NULL,
  "fund_name" text NOT NULL,
  "category" text NOT NULL,
  "region" text NOT NULL,
  "nav" double precision NOT NULL,
  "net_assets" double precision NOT NULL,
  "expense_ratio" double precision NOT NULL,
  "ytd_return" double precision NOT NULL,
  "one_year_return" double precision NOT NULL,
  "three_year_return" double precision NOT NULL,
  "risk" "fund_risk" NOT NULL,
  "as_of" date NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fund_stats_symbol_unique" UNIQUE ("symbol")
);

ALTER TABLE "fund_stats" REPLICA IDENTITY FULL;

