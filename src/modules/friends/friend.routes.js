// routes/friend.routes.js

import express from "express";

import {
  sendFriendRequest,
  getFriendRequests,
  getPendingRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  searchUsers,
  getFriends,
  getMyFriends,
  removeFriend,
} from "./friend.controller.js";

import authMiddleware from "../../middlewares/auth.js";

const router = express.Router();

/**
 * ============================================================================
 * SEARCH USERS
 * ============================================================================
 */

router.get("/search", authMiddleware, searchUsers);

/**
 * ============================================================================
 * FRIEND REQUESTS
 * ============================================================================
 */

// send request
router.post("/request", authMiddleware, sendFriendRequest);

// all received requests
router.get("/get/requests", authMiddleware, getFriendRequests);

// pending requests only
router.get("/requests/pending", authMiddleware, getPendingRequests);

// accept request
router.patch("/requests/:requestId/accept", authMiddleware, acceptFriendRequest);

// reject request
router.patch("/requests/:requestId/reject", authMiddleware, rejectFriendRequest);

// cancel request
// cancel sent request
router.delete("/requests/:requestId/cancel", authMiddleware, cancelFriendRequest);

/**
 * ============================================================================
 * FRIENDS
 * ============================================================================
 */

// get all friends
router.get("/", authMiddleware, getFriends);

// remove friend
router.delete("/:friendId", authMiddleware, removeFriend);

router.get("/me", authMiddleware, getMyFriends);

export default router;