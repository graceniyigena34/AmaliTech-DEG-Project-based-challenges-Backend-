import request from "supertest";
import app from "../app";
import pool, { initDB } from "../src/config/database";
import { hashBody } from "../src/services/idempotencyService";

const KEY = "test-key-001";
const KEY2 = "test-key-002";
const BODY = { amount: 100, currency: "GHS" };

// Clean up any test rows before/after each test so they don't bleed into each other
async function cleanKeys(...keys: string[]) {
  await pool.query(
    "DELETE FROM idempotency_records WHERE idempotency_key = ANY($1)",
    [keys]
  );
}

beforeAll(async () => {
  await initDB(); // ensure table exists
});

beforeEach(async () => {
  await cleanKeys(KEY, KEY2);
});

afterAll(async () => {
  await cleanKeys(KEY, KEY2);
  await pool.end();
});

// User Story 1: First Transaction 

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

// User Story 2: Duplicate Request (Idempotency Logic) 

describe("User Story 2 — Duplicate Request", () => {
  it("returns cached response with X-Cache-Hit: true on duplicate key + same body", async () => {
    // First request — processes and stores
    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    // Second request — same key, same body
    const res = await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Charged 100 GHS" });
    expect(res.headers["x-cache-hit"]).toBe("true");
  }, 15000);

  it("does not insert a new DB record on duplicate request", async () => {
    // First request
    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    // Second request
    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    // Only one record should exist in the DB
    const result = await pool.query(
      "SELECT COUNT(*) FROM idempotency_records WHERE idempotency_key = $1",
      [KEY]
    );
    expect(Number(result.rows[0].count)).toBe(1);
  }, 15000);
});

// User Story 3: Different Body, Same Key (Fraud/Error Check) 

describe("User Story 3 — Different Body, Same Key", () => {
  it("returns 422 when same key is reused with a different request body", async () => {
    // First request with amount 100
    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    // Second request with same key but different amount
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

// Bonus: In-Flight Race Condition 

describe("Bonus — In-Flight Race Condition", () => {
  it("concurrent requests with same key both return 201 and only one DB record is created", async () => {
    // Fire two identical requests at the same time
    const [resA, resB] = await Promise.all([
      request(app).post("/process-payment").set("Idempotency-Key", KEY).send(BODY),
      request(app).post("/process-payment").set("Idempotency-Key", KEY).send(BODY),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body).toEqual({ message: "Charged 100 GHS" });
    expect(resB.body).toEqual({ message: "Charged 100 GHS" });

    // Confirm only one record was written
    const result = await pool.query(
      "SELECT COUNT(*) FROM idempotency_records WHERE idempotency_key = $1",
      [KEY]
    );
    expect(Number(result.rows[0].count)).toBe(1);
  }, 15000);
});
