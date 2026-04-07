import express from "express";
import cors from "cors";
import path from "path";
import { authRoutes } from "./modules/auth/routes";
import { driverRoutes } from "./modules/drivers/routes";
import { documentRoutes } from "./modules/documents/routes";
import { dashboardRoutes } from "./modules/dashboard/routes";
import { vehicleRoutes } from "./modules/vehicles/routes";
import { vehicleDocumentRoutes } from "./modules/vehicleDocuments/routes";
import { earningsImportRoutes } from "./modules/earnings/routes";

export const app = express();

app.use(cors({
  origin: "*"
}));
app.use(express.json());

app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"), {
    maxAge: "1d",
  }),
);

app.use("/api/auth", authRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/drivers", documentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/dashboard", earningsImportRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/vehicles", vehicleDocumentRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Multer / upload errors
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const m = err as { code?: string; message?: string };
  if (m.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      message: "File too large. Driver documents: 10MB max. Earnings uploads: 40MB max.",
    });
  }
  if (m.message && typeof m.message === "string") {
    if (
      m.message.includes("Only PDF") ||
      m.message.includes("Profile photo") ||
      m.message.includes("JPG or PNG") ||
      m.message.includes("Earnings upload:")
    ) {
      return res.status(400).json({ message: m.message });
    }
  }
  return res.status(500).json({ message: "Internal server error" });
});

