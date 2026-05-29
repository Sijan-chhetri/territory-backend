import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.js";
import { getDistanceLeaderboard } from "./leaderboard.controller.js";

const router = Router();

router.get("/distance", authMiddleware, getDistanceLeaderboard);

export default router;