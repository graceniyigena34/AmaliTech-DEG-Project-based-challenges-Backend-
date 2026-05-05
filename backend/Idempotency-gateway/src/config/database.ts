import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = process.env["DATABASE_URL"]
  ? new Pool({
      connectionString: process.env["DATABASE_URL"],
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env["PGHOST"],
      port: Number(process.env["PGPORT"]),
      user: process.env["PGUSER"],
      password: process.env["PGPASSWORD"],
      database: process.env["PGDATABASE"],
    });

export async function initDB(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      id SERIAL PRIMARY KEY,
      idempotency_key VARCHAR(255) UNIQUE NOT NULL,
      request_hash VARCHAR(64) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'processing',
      response_status INT,
      response_body JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
    )
  `);

  await pool.query(`
    ALTER TABLE idempotency_records
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
  `);
}

export default pool;
