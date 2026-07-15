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
  getClanMembersFull,
  checkIfClanLeader,
} from "../clan/clan.controller.js";

const router = express.Router();

/**
 * Static routes
 */
router.get("/check-leader", authMiddleware, checkIfClanLeader);

router.get("/territories/all", authMiddleware, getAllClanTerritories);

router.get("/me/joined", authMiddleware, getMyJoinedClans);
router.get("/me/status", authMiddleware, getMyClanStatus);

router.delete("/leave", authMiddleware, leaveClan);

/**
 * Clan creation and listing
 */
router.post("/", authMiddleware, createClan);
router.get("/", authMiddleware, getAllClans);

/**
 * Join request actions
 */
router.patch(
  "/join-request/:requestId/accept",
  authMiddleware,
  acceptClanJoinRequest
);

router.patch(
  "/join-request/:requestId/reject",
  authMiddleware,
  rejectClanJoinRequest
);

/**
 * Clan invite actions
 */
router.patch(
  "/invite/:inviteId/accept",
  authMiddleware,
  acceptClanInvite
);

router.patch(
  "/invite/:inviteId/reject",
  authMiddleware,
  rejectClanInvite
);

/**
 * Clan-specific routes
 */
router.post(
  "/:clanId/join-request",
  authMiddleware,
  requestToJoinClan
);

router.post(
  "/:clanId/join",
  authMiddleware,
  joinClanDirectly
);

router.get(
  "/:clanId/details",
  authMiddleware,
  getClanDetails
);

router.get(
  "/:clanId/territories",
  authMiddleware,
  getClanTerritories
);

router.get(
  "/:clanId/join-requests",
  authMiddleware,
  getClanJoinRequests
);

// More specific route must come first
router.get(
  "/:clanId/members/full",
  authMiddleware,
  getClanMembersFull
);

router.get(
  "/:clanId/members",
  authMiddleware,
  getClanMembers
);

export default router;