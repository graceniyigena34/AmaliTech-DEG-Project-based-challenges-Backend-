import pool from "../config/database";
import { IdempotencyRecord } from "../types";

export async function findByKey(key: string): Promise<IdempotencyRecord | null> {
  const result = await pool.query(
    "SELECT * FROM idempotency_records WHERE idempotency_key = $1",
    [key]
  );
  return result.rows[0] ?? null;
}

export async function createRecord(
  key: string,
  requestHash: string
): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency_records (idempotency_key, request_hash, status)
     VALUES ($1, $2, 'processing')`,
    [key, requestHash]
  );
}

export async function completeRecord(
  key: string,
  responseStatus: number,
  responseBody: object
): Promise<void> {
  await pool.query(
    `UPDATE idempotency_records
     SET status = 'completed', response_status = $2, response_body = $3
     WHERE idempotency_key = $1`,
    [key, responseStatus, JSON.stringify(responseBody)]
  );
}
