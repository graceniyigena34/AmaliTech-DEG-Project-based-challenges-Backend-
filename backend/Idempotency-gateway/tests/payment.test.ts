import request from "supertest";
import app from "../app";
import pool, { initDB } from "../src/config/database";
import { hashBody } from "../src/services/idempotencyService";

const KEY = "test-key-001";
const KEY2 = "test-key-002";
const KEY_EXPIRED = "test-key-expired";
const BODY = { amount: 100, currency: "GHS" };

async function cleanKeys(...keys: string[]) {
  await pool.query(
    "DELETE FROM idempotency_records WHERE idempotency_key = ANY($1)",
    [keys]
  );
}

beforeAll(async () => {
  await initDB();
});

beforeEach(async () => {
  await cleanKeys(KEY, KEY2, KEY_EXPIRED);
});

afterAll(async () => {
  await cleanKeys(KEY, KEY2, KEY_EXPIRED);
  await pool.end();
});

// ─── User Story 1: First Transaction (Happy Path) ────────────────────────────

describe("User Story 1 — First Transaction", () => {
  it("returns 201 with charge message on first request", async () => {
    const res = await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Charged 100 GHS" });
    expect(res.headers["x-cache-hit"]).toBeUndefined();
  }, 10000);

  it("returns 400 when Idempotency-Key header is missing", async () => {
    const res = await request(app).post("/process-payment").send(BODY);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing required header: Idempotency-Key" });
  });
});

// ─── User Story 2: Duplicate Request (Idempotency Logic) ─────────────────────

describe("User Story 2 — Duplicate Request", () => {
  it("returns cached response with X-Cache-Hit: true on duplicate key + same body", async () => {
    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    const res = await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Charged 100 GHS" });
    expect(res.headers["x-cache-hit"]).toBe("true");
  }, 15000);

  it("does not insert a new DB record on duplicate request", async () => {
    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    const result = await pool.query(
      "SELECT COUNT(*) FROM idempotency_records WHERE idempotency_key = $1",
      [KEY]
    );
    expect(Number(result.rows[0].count)).toBe(1);
  }, 15000);
});

// ─── User Story 3: Different Body, Same Key (Fraud/Error Check) ──────────────

describe("User Story 3 — Different Body, Same Key", () => {
  it("returns 422 when same key is reused with a different request body", async () => {
    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    const res = await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send({ amount: 500, currency: "GHS" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "Idempotency key already used for a different request body.",
    });
  }, 15000);
});

// ─── Bonus: In-Flight Race Condition ─────────────────────────────────────────

describe("Bonus — In-Flight Race Condition", () => {
  it("concurrent requests with same key both return 201 and only one DB record is created", async () => {
    const [resA, resB] = await Promise.all([
      request(app).post("/process-payment").set("Idempotency-Key", KEY).send(BODY),
      request(app).post("/process-payment").set("Idempotency-Key", KEY).send(BODY),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body).toEqual({ message: "Charged 100 GHS" });
    expect(resB.body).toEqual({ message: "Charged 100 GHS" });

    const result = await pool.query(
      "SELECT COUNT(*) FROM idempotency_records WHERE idempotency_key = $1",
      [KEY]
    );
    expect(Number(result.rows[0].count)).toBe(1);
  }, 15000);
});

// ─── Developer's Choice: Key Expiry (24-hour TTL) ────────────────────────────

describe("Developer's Choice — Key Expiry", () => {
  it("treats an expired key as a new request and processes it again", async () => {
    // Insert an already-expired record directly into the DB
    await pool.query(
      `INSERT INTO idempotency_records
        (idempotency_key, request_hash, status, response_status, response_body, expires_at)
       VALUES ($1, $2, 'completed', 201, $3, NOW() - INTERVAL '1 second')`,
      [KEY_EXPIRED, hashBody(BODY), JSON.stringify({ message: "Charged 100 GHS" })]
    );

    // Request with the expired key should be treated as brand new
    const res = await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY_EXPIRED)
      .send(BODY);

    expect(res.status).toBe(201);
    expect(res.headers["x-cache-hit"]).toBeUndefined(); // not a cache hit — reprocessed
  }, 10000);

  it("stores a new record with expires_at 24 hours in the future", async () => {
    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    const result = await pool.query(
      "SELECT expires_at FROM idempotency_records WHERE idempotency_key = $1",
      [KEY]
    );

    const expiresAt: Date = result.rows[0].expires_at;
    const hoursUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);

    expect(hoursUntilExpiry).toBeGreaterThan(23);
    expect(hoursUntilExpiry).toBeLessThanOrEqual(24);
  }, 10000);
});
