import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.js";

import {
  getDistanceLeaderboard,
  getAreaLeaderboard,
  getLocalDistanceLeaderboard,
  getLocalAreaLeaderboard,

} from "./leaderboard.controller.js";

const router = Router();

router.get("/distance", authMiddleware, getDistanceLeaderboard);
router.get("/area", authMiddleware, getAreaLeaderboard);
router.get("/local/distance", authMiddleware, getLocalDistanceLeaderboard);
router.get("/local/area", authMiddleware, getLocalAreaLeaderboard);

export default router;