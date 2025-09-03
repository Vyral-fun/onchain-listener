import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const client = postgres(Bun.env.DATABASE_URL, {
  user: Bun.env.POSTGRES_USER,
  password: Bun.env.POSTGRES_PASSWORD,
  database: Bun.env.POSTGRES_DB,
  debug: Bun.env.NODE_ENV !== "production",
});

export const db = drizzle({ client });
