# Idempotency Gateway — FinSafe Transactions Ltd.

A RESTful payment processing API that guarantees every payment is charged **exactly once**, no matter how many times the client retries.



## 1. Architecture Diagram


Client
  │
  │  POST /process-payment
  │  Headers: Idempotency-Key: <uuid>
  │  Body:    { "amount": 100, "currency": "GHS" }
  ▼
┌─────────────────────────────────────────────────────┐
│                  Express Server                     │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │         requireIdempotencyKey middleware      │   │
│  │   Missing key? → 400 Bad Request             │   │
│  └──────────────────┬───────────────────────────┘   │
│                     │                               │
│  ┌──────────────────▼───────────────────────────┐   │
│  │              processPayment()                │   │
│  │                                              │   │
│  │  Hash request body (SHA-256)                 │   │
│  │           │                                  │   │
│  │  Query DB: key exists & not expired?         │   │
│  │           │                                  │   │
│  │     ┌─────┴──────┐                           │   │
│  │    YES            NO                         │   │
│  │     │              │                         │   │
│  │  Hash match?    Insert record (processing)   │   │
│  │   ┌──┴──┐         Simulate 2s delay          │   │
│  │  YES   NO         Update record (completed)  │   │
│  │   │     │              │                     │   │
│  │  status? 422      Return 201                 │   │
│  │ completed?        { message: "Charged..." }  │   │
│  │  ┌──┴──┐                                     │   │
│  │ YES  processing                              │   │
│  │  │    │                                      │   │
│  │ 201  In-flight map has promise?              │   │
│  │ X-Cache-Hit: true  ┌──┴──┐                  │   │
│  │                   YES    NO                  │   │
│  │                    │     │                   │   │
│  │                  await  poll DB (2.5s)       │   │
│  │                  result  → return result     │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
  │
  ▼
PostgreSQL — idempotency_records table



## 2. Setup Instructions

### Prerequisites
- Node.js 18+
- PostgreSQL running on your machine

### Steps

bash
# 1. Clone the repo
git clone 
`https://github.com/graceniyigena34/AmaliTech-DEG-Project-based-challenges-Backend-`

cd Idempotency-gateway

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials

# 4. Start the server (table is auto-created on first boot)
npm run dev


The server starts at `http://localhost:5000`
Swagger UI is available at `http://localhost:5000/api-docs`



## 3. API Documentation

### `POST /process-payment`

Processes a payment exactly once per unique `Idempotency-Key`.

**Headers**

| Header            | Required | Description                        |
|-------------------|----------|------------------------------------|
| `Idempotency-Key` | Yes      | A unique string per payment attempt (e.g. a UUID) |
| `Content-Type`    | Yes      | `application/json`                 |

**Request Body**

```json
{
  "amount": 100,
  "currency": "GHS"
}


**Responses**

| Status | When | Body |
|--------|------|------|
| `201 Created` | First request — payment processed | `{ "message": "Charged 100 GHS" }` |
| `201 Created` + `X-Cache-Hit: true` | Duplicate request — cached response returned | `{ "message": "Charged 100 GHS" }` |
| `400 Bad Request` | Missing `Idempotency-Key` header | `{ "error": "Missing required header: Idempotency-Key" }` |
| `422 Unprocessable Entity` | Same key reused with a different request body | `{ "error": "Idempotency key already used for a different request body." }` |
| `500 Internal Server Error` | Unexpected server error | `{ "error": "Internal server error" }` |

**Example — First Request**
```bash
curl -X POST http://localhost:5000/process-payment \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"amount": 100, "currency": "GHS"}'

# Response (after ~2s)
# 201 Created
{ "message": "Charged 100 GHS" }
```

**Example — Duplicate Request (same key + same body)**
bash
curl -X POST http://localhost:5000/process-payment \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"amount": 100, "currency": "GHS"}'

# Response (instant)
# 201 Created
# X-Cache-Hit: true
{ "message": "Charged 100 GHS" }
```

**Example — Fraud Check (same key, different body)**
```bash
curl -X POST http://localhost:5000/process-payment \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"amount": 500, "currency": "GHS"}'

# Response
# 422 Unprocessable Entity
{ "error": "Idempotency key already used for a different request body." }




## 4. Design Decisions

### PostgreSQL as the store
PostgreSQL's `UNIQUE` constraint on `idempotency_key` acts as a natural race-condition guard at the DB level — two concurrent inserts for the same key will result in one succeeding and one failing, preventing double processing.

### SHA-256 body hashing
The request body is hashed before storage. This allows a fast, fixed-size comparison to detect payload tampering without storing the full raw body.

### In-flight Map (race condition handling)
A Node.js `Map<key, Promise>` tracks requests currently being processed. If a duplicate arrives while the first is still in the 2-second simulation, it attaches to the existing promise and waits for the result — no second DB write, no second charge.

### 2-second simulated delay
Mimics a real payment processor network call, making the in-flight race condition scenario realistic and testable.



## 5. Developer's Choice — Idempotency Key Expiry (24-hour TTL)

### What was added
Every idempotency record is stored with an `expires_at` timestamp set to **24 hours** from creation. All DB lookups filter by `expires_at > NOW()`, so expired keys are treated as if they never existed.

### Why this matters for Fintech
Without expiry, idempotency keys live forever in the database. This creates two real-world problems:

1. **Storage bloat** — a high-volume payment processor handles millions of transactions per day. Keeping every key forever is unsustainable.
2. **Legitimate key reuse** — a merchant may reuse the same key format (e.g. `order-12345`) for a genuinely new payment months later. Without expiry, that new payment would be silently blocked and return the old cached response, causing a missed charge.

A 24-hour TTL is the industry standard (used by Stripe, PayStack, etc.) — long enough to cover any reasonable retry window, short enough to keep the table lean.



## 6. Running Tests

Tests run against the real PostgreSQL database and clean up after themselves.

```bash
npm test
```

Test coverage:
- User Story 1: First transaction happy path + missing header validation
- User Story 2: Duplicate request returns cached response with `X-Cache-Hit: true`
- User Story 3: Same key + different body returns `422`
- Bonus: Concurrent requests resolve correctly with only one DB record written
