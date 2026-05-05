import { Request, Response, NextFunction } from "express";

export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") {
    res.status(400).json({ error: "Missing required header: Idempotency-Key" });
    return;
  }
  next();
}
