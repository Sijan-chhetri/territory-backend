import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.js";
import { getClanTerritoryLeaderboard } from "./clanLeaderboard.controller.js";

const router = Router();

router.get("/area", authMiddleware, getClanTerritoryLeaderboard);

export default router;