import express from "express";
import paymentRoutes from "./src/routes/payment";

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

app.use("/api", paymentRoutes);

export default app;
