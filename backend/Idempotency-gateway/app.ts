import express from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./src/config/swagger";
import paymentRoutes from "./src/routes/payment";

const app = express();

app.use(express.json());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get("/", (req, res) => {
  res.send("API is running 🚀 — Swagger docs at /api-docs");
});

app.use("/", paymentRoutes);

export default app;
