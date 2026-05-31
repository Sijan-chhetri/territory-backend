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
  getMyJoinedClans,
  getClanTerritories,
  getClanJoinRequests,
  getAllClanTerritories,
  getMyClanStatus,
  joinClanDirectly,
  getClanDetails,
  leaveClan,
  getClanMembers,
  getClanMembersFull
} from "../clan/clan.controller.js";

// import { getClanJoinRequests } from "../clan/clan.controller.js";

const router = express.Router();

router.post("/",                              authMiddleware, createClan);
router.get("/",                               authMiddleware, getAllClans);
router.post("/:clanId/join-request",          authMiddleware, requestToJoinClan);
router.post("/:clanId/join", authMiddleware, joinClanDirectly);
router.patch("/join-request/:requestId/accept", authMiddleware, acceptClanJoinRequest);
router.patch("/join-request/:requestId/reject", authMiddleware, rejectClanJoinRequest);
router.get("/territories/all", authMiddleware, getAllClanTerritories);
router.patch("/invite/:inviteId/accept",      authMiddleware, acceptClanInvite);
router.get("/:clanId/details", authMiddleware, getClanDetails);
router.get("/:clanId/territories", authMiddleware, getClanTerritories);
router.patch("/invite/:inviteId/reject",      authMiddleware, rejectClanInvite);
router.get("/:clanId/join-requests", authMiddleware, getClanJoinRequests);
router.get("/:clanId/members", authMiddleware, getClanMembers);
router.delete("/leave", authMiddleware, leaveClan);
router.get("/:clanId/members/full", authMiddleware, getClanMembersFull);
router.get("/me/joined", authMiddleware, getMyJoinedClans);
router.get("/me/status", authMiddleware, getMyClanStatus);



export default router;
