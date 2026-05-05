export interface IdempotencyRecord {
  id: string;
  idempotency_key: string;
  request_hash: string;
  status: "processing" | "completed";
  response_status: number | null;
  response_body: object | null;
  created_at: Date;
}

export interface PaymentRequest {
  amount: number;
  currency: string;
}
