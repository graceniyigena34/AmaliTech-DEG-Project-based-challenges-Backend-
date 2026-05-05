import crypto from "crypto";
import { findByKey, createRecord, completeRecord } from "../models/IdempotencyRecord";
import { PaymentRequest } from "../types";

// In-flight lock: key -> promise of result
const inFlight = new Map<string, Promise<{ status: number; body: object }>>();

export function hashBody(body: PaymentRequest): string {
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

async function simulatePayment(body: PaymentRequest): Promise<{ status: number; body: object }> {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return {
    status: 201,
    body: { message: `Charged ${body.amount} ${body.currency}` },
  };
}

export async function processPayment(
  key: string,
  requestBody: PaymentRequest
): Promise<{ status: number; body: object; cacheHit: boolean }> {
  const requestHash = hashBody(requestBody);
  const existing = await findByKey(key);

  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw { code: 422, message: "Idempotency key already used for a different request body." };
    }

    if (existing.status === "completed") {
      return {
        status: existing.response_status!,
        body: existing.response_body as object,
        cacheHit: true,
      };
    }

    // In-flight: wait for the ongoing request to finish
    const ongoing = inFlight.get(key);
    if (ongoing) {
      const result = await ongoing;
      return { ...result, cacheHit: true };
    }

    // Processing but no in-flight entry (e.g. server restart) — re-poll briefly
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const refreshed = await findByKey(key);
    if (refreshed?.status === "completed") {
      return {
        status: refreshed.response_status!,
        body: refreshed.response_body as object,
        cacheHit: true,
      };
    }
  }

  // New request
  await createRecord(key, requestHash);

  const work = simulatePayment(requestBody).then(async (result) => {
    await completeRecord(key, result.status, result.body);
    inFlight.delete(key);
    return result;
  });

  inFlight.set(key, work);
  const result = await work;
  return { ...result, cacheHit: false };
}
