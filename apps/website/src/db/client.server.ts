import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for Postgres-backed FundStats routes.");
}

const client = postgres(connectionString, {
  max: 5,
  prepare: false,
});

export const db = drizzle(client, { schema });
