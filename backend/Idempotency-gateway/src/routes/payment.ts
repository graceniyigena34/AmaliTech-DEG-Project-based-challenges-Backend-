import { Router } from "express";
import { requireIdempotencyKey } from "../middlewares/idempotency";
import { handlePayment } from "../controllers/paymentController";

const router = Router();

/**
 * @openapi
 * /process-payment:
 *   post:
 *     summary: Process a payment (idempotent)
 *     description: |
 *       Processes a payment exactly once per unique Idempotency-Key.
 *       - First request: processes and stores the result (2s simulated delay).
 *       - Duplicate request (same key + same body): returns cached result with `X-Cache-Hit: true`.
 *       - Same key + different body: returns 422 Unprocessable Entity.
 *       - In-flight duplicate: waits for the first request to finish, then returns its result.
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *         description: A unique key per payment attempt (e.g. a UUID)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - currency
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 100
 *               currency:
 *                 type: string
 *                 example: GHS
 *     responses:
 *       201:
 *         description: Payment processed successfully
 *         headers:
 *           X-Cache-Hit:
 *             schema:
 *               type: string
 *             description: Present with value "true" when this is a replayed response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Charged 100 GHS
 *       400:
 *         description: Missing Idempotency-Key header
 *       422:
 *         description: Idempotency key already used for a different request body
 *       500:
 *         description: Internal server error
 */
router.post("/process-payment", requireIdempotencyKey, handlePayment);

export default router;
