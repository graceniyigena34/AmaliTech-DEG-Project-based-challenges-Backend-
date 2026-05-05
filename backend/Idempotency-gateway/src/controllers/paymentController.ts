import { Request, Response } from "express";
import { processPayment } from "../services/idempotencyService";
import { PaymentRequest } from "../types";

export async function handlePayment(req: Request, res: Response): Promise<void> {
  const key = req.headers["idempotency-key"] as string;
  const body = req.body as PaymentRequest;

  try {
    const { status, body: responseBody, cacheHit } = await processPayment(key, body);
    if (cacheHit) res.setHeader("X-Cache-Hit", "true");
    res.status(status).json(responseBody);
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code && e.message) {
      res.status(e.code).json({ error: e.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
