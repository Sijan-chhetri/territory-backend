import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.js";

import {
  getDistanceLeaderboard,
  getAreaLeaderboard,
} from "./leaderboard.controller.js";

const router = Router();

router.get("/distance", authMiddleware, getDistanceLeaderboard);
router.get("/area", authMiddleware, getAreaLeaderboard);

export default router;