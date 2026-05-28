import express from "express";
import authMiddleware from "../../middlewares/auth.js";

import {
  createClan,
  getAllClans,
  requestToJoinClan,
  acceptClanJoinRequest,
  rejectClanJoinRequest,
  acceptClanInvite,
  rejectClanInvite,
} from "../clan/clan.controller.js";

import { getClanJoinRequests } from "../clan/clan.controller.js";

const router = express.Router();

router.post("/",                              authMiddleware, createClan);
router.get("/",                               authMiddleware, getAllClans);
router.post("/:clanId/join-request",          authMiddleware, requestToJoinClan);
router.patch("/join-request/:requestId/accept", authMiddleware, acceptClanJoinRequest);
router.patch("/join-request/:requestId/reject", authMiddleware, rejectClanJoinRequest);
router.patch("/invite/:inviteId/accept",      authMiddleware, acceptClanInvite);
router.patch("/invite/:inviteId/reject",      authMiddleware, rejectClanInvite);
router.get("/:clanId/join-requests", authMiddleware, getClanJoinRequests);

export default router;
