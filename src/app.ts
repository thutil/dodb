import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import databaseRouter from "./routes/database";
import commandRouter from "./routes/command";
import listRouter from "./routes/list";
import connectionProfileRouter from "./routes/connectionProfile";

const app = express();

app.use(bodyParser.json());
app.use("/api/database", databaseRouter);
app.use("/api/command", commandRouter);
app.use("/api/list", listRouter);
app.use("/api/profile", connectionProfileRouter);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

export default app;