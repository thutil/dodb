import express, { Request, Response } from "express";
import { getAuditLogs, clearAuditLogs, addAuditLog } from "../db/auditLog";

const router = express.Router();

// GET /api/audit-logs
router.get("/", (req: Request, res: Response) => {
  try {
    const { search, profileId, actionType, status, startDate, endDate, limit, offset } = req.query;
    const result = getAuditLogs({
      search: search ? String(search) : undefined,
      profileId: profileId ? String(profileId) : undefined,
      actionType: actionType ? String(actionType) : undefined,
      status: status ? String(status) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      limit: limit ? parseInt(String(limit), 10) : 100,
      offset: offset ? parseInt(String(offset), 10) : 0,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch audit logs" });
  }
});

// POST /api/audit-logs (Manual log entry if needed)
router.post("/", (req: Request, res: Response) => {
  try {
    const entry = addAuditLog(req.body);
    res.status(201).json(entry);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to log event" });
  }
});

// DELETE /api/audit-logs
router.delete("/", (req: Request, res: Response) => {
  try {
    clearAuditLogs();
    res.json({ success: true, message: "Audit logs cleared" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to clear audit logs" });
  }
});

export default router;
