// routes/friend.routes.js

import express from "express";

import {
  sendFriendRequest,
  getFriendRequests,
  getPendingRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  searchUsers,
  getFriends,
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

/**
 * ============================================================================
 * FRIENDS
 * ============================================================================
 */

// get all friends
router.get("/", authMiddleware, getFriends);

// remove friend
router.delete("/:friendId", authMiddleware, removeFriend);

export default router;