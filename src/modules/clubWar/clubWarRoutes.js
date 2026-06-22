
import express from "express";
import {
  createManualClubWar,
  acceptClubWar,
  declineClubWar,
  getMyClanWars,
  getActiveClubWar,
  recalculateClubWar,
  runAutomaticMatchmaking,
  completeExpiredClubWars,
  activateScheduledClubWars,
} from "./clubWarController.js";
import authMiddleware from "../../middlewares/auth.js";
import {verifyCronSecret} from "../../middlewares/cornMiddleWare.js";

const router = express.Router();

router.post("/challenge", authMiddleware, createManualClubWar);
router.patch("/:warId/accept", authMiddleware, acceptClubWar);
router.patch("/:warId/decline", authMiddleware, declineClubWar);

router.get("/my-clan", authMiddleware, getMyClanWars);
router.get("/active", authMiddleware, getActiveClubWar);

router.post("/:warId/recalculate", authMiddleware, recalculateClubWar);

// Admin / cron routes
router.post("/automatic/run",verifyCronSecret, runAutomaticMatchmaking);
router.post("/automatic/activate",verifyCronSecret, activateScheduledClubWars);
router.post("/complete-expired", verifyCronSecret,completeExpiredClubWars);

export default router;