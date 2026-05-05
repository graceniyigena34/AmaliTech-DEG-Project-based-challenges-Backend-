import app from "./app";
import { initDB } from "./src/config/database";
import dotenv from "dotenv";

dotenv.config();

const PORT = Number(process.env["PORT"]) || 5000;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Swagger docs at http://localhost:${PORT}/api-docs`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
