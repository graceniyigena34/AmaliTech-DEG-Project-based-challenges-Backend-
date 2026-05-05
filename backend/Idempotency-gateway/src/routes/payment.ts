import { Router } from "express";
import { requireIdempotencyKey } from "../middlewares/idempotency";
import { handlePayment } from "../controllers/paymentController";

const router = Router();

router.post("/process-payment", requireIdempotencyKey, handlePayment);

export default router;
