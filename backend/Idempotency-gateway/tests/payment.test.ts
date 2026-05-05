import request from "supertest";
import app from "../app";

// Mock the DB model so no real Postgres connection is needed
jest.mock("../src/models/IdempotencyRecord");

import * as model from "../src/models/IdempotencyRecord";

const mockFindByKey = model.findByKey as jest.MockedFunction<typeof model.findByKey>;
const mockCreateRecord = model.createRecord as jest.MockedFunction<typeof model.createRecord>;
const mockCompleteRecord = model.completeRecord as jest.MockedFunction<typeof model.completeRecord>;

const KEY = "test-idempotency-key-001";
const BODY = { amount: 100, currency: "GHS" };

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateRecord.mockResolvedValue();
  mockCompleteRecord.mockResolvedValue();
});

// ─── User Story 1: First Transaction (Happy Path) ────────────────────────────

describe("User Story 1 — First Transaction", () => {
  it("returns 201 with charge message on first request", async () => {
    mockFindByKey.mockResolvedValue(null); // no existing record

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
    mockFindByKey.mockResolvedValue({
      id: "1",
      idempotency_key: KEY,
      request_hash: require("../src/services/idempotencyService").hashBody(BODY),
      status: "completed",
      response_status: 201,
      response_body: { message: "Charged 100 GHS" },
      created_at: new Date(),
    });

    const res = await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Charged 100 GHS" });
    expect(res.headers["x-cache-hit"]).toBe("true");
    expect(mockCreateRecord).not.toHaveBeenCalled();
  });

  it("does not re-run payment processing on duplicate", async () => {
    mockFindByKey.mockResolvedValue({
      id: "1",
      idempotency_key: KEY,
      request_hash: require("../src/services/idempotencyService").hashBody(BODY),
      status: "completed",
      response_status: 201,
      response_body: { message: "Charged 100 GHS" },
      created_at: new Date(),
    });

    await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send(BODY);

    expect(mockCompleteRecord).not.toHaveBeenCalled();
  });
});

// ─── User Story 3: Different Body, Same Key (Fraud/Error Check) ──────────────

describe("User Story 3 — Different Body, Same Key", () => {
  it("returns 422 when same key is reused with a different request body", async () => {
    mockFindByKey.mockResolvedValue({
      id: "1",
      idempotency_key: KEY,
      request_hash: require("../src/services/idempotencyService").hashBody({ amount: 100, currency: "GHS" }),
      status: "completed",
      response_status: 201,
      response_body: { message: "Charged 100 GHS" },
      created_at: new Date(),
    });

    const res = await request(app)
      .post("/process-payment")
      .set("Idempotency-Key", KEY)
      .send({ amount: 500, currency: "GHS" }); // different amount

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "Idempotency key already used for a different request body.",
    });
  });
});

// ─── Bonus: In-Flight Race Condition ─────────────────────────────────────────

describe("Bonus — In-Flight Race Condition", () => {
  it("second request waits and returns the same result as the first", async () => {
    // First call returns null (new request), second call returns processing record
    mockFindByKey
      .mockResolvedValueOnce(null) // request A: no record yet
      .mockResolvedValueOnce({     // request B: sees processing record
        id: "1",
        idempotency_key: KEY,
        request_hash: require("../src/services/idempotencyService").hashBody(BODY),
        status: "processing",
        response_status: null,
        response_body: null,
        created_at: new Date(),
      });

    // Fire both requests concurrently
    const [resA, resB] = await Promise.all([
      request(app).post("/process-payment").set("Idempotency-Key", KEY).send(BODY),
      request(app).post("/process-payment").set("Idempotency-Key", KEY).send(BODY),
    ]);

    // Both should succeed
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body).toEqual({ message: "Charged 100 GHS" });
    expect(resB.body).toEqual({ message: "Charged 100 GHS" });
  }, 15000);
});
