import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import databaseRouter from "./routes/database";
import commandRouter from "./routes/command";
import listRouter from "./routes/list";
import connectionProfileRouter from "./routes/connectionProfile";
import adminRouter from "./routes/admin";
import auditLogRouter from "./routes/auditLog";

const app = express();

app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(bodyParser.json());
app.use("/api/database", databaseRouter);
app.use("/api/command", commandRouter);
app.use("/api/list", listRouter);
app.use("/api/profile", connectionProfileRouter);
app.use("/api/admin", adminRouter);
app.use("/api/audit-logs", auditLogRouter);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

export default app;