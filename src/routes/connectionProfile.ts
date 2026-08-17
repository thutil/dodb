import express, { Request, Response, NextFunction } from "express";
import * as connectionProfileController from "../controllers/connectionProfileController";
const router = express.Router();

router.get("/", connectionProfileController.listProfiles);
router.post("/", connectionProfileController.createProfile);
router.post("/test", connectionProfileController.testProfile as express.RequestHandler);

router.put("/:id", connectionProfileController.updateProfile as express.RequestHandler);
router.delete("/:id", connectionProfileController.deleteProfile as express.RequestHandler);

export default router;