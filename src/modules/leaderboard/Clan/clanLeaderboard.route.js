import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.js";
import { getClanTerritoryLeaderboard,  getGlobalClanAreaLeaderboard,
  getGlobalClanDistanceLeaderboard,
  getLocalClanAreaLeaderboard,
  getLocalClanDistanceLeaderboard,
 } from "./clanLeaderboard.controller.js";

const router = Router();

router.get("/area", authMiddleware, getClanTerritoryLeaderboard);



router.get("/global/area", authMiddleware, getGlobalClanAreaLeaderboard);
router.get("/global/distance", authMiddleware, getGlobalClanDistanceLeaderboard);

router.get("/local/area", authMiddleware, getLocalClanAreaLeaderboard);
router.get("/local/distance", authMiddleware, getLocalClanDistanceLeaderboard);

export default router;