import { Router } from "express";
import authMiddleware from "../../middlewares/auth.js";
import {
  likeActivity,
  unlikeActivity,
  getActivityLikes,
} from "./activityLike.controller.js";

import {
  finishActivity,
  getMyActivities,
  getActivityDetail,
  getMyTotalStats,
  getTodayStats,
  getMyTodayActivities,
  getMyFriendsActivities,
  getWeeklyActivityStats,
  getPersonalRecords,
  getLifetimeActivityStats,
  getActivityGraphStats,
  getFriendActivityDetails,
  updateActivityVisibility,
  updateActivityShoe,
  getVisibleActivityDetail,
  deleteActivity,
  getFriendsLeaderboardStats,
} from "./activity.controller.js";

const router = Router();

router.post("/finish", authMiddleware, finishActivity);

router.get("/my", authMiddleware, getMyActivities);

router.get("/my/today", authMiddleware, getMyTodayActivities);

router.get("/stats/graph", authMiddleware, getActivityGraphStats);

router.get("/stats/total", authMiddleware, getMyTotalStats);
router.get("/stats/today", authMiddleware, getTodayStats);

// IMPORTANT: keep this before /:id
router.get("/friends", authMiddleware, getMyFriendsActivities);

router.get(
  "/friends/leaderboard-stats",
  authMiddleware,
  getFriendsLeaderboardStats,
);

router.get(
  "/activities/friends/:activityId",
  authMiddleware,
  getFriendActivityDetails,
);

router.patch("/:id/visibility", authMiddleware, updateActivityVisibility);

// Assign, change, or remove shoe from an existing activity
router.patch("/:id/shoe", authMiddleware, updateActivityShoe);

router.get("/view/:activityId", authMiddleware, getVisibleActivityDetail);

// ======================================================
// ACTIVITY LIKES — DURO BOOST FEATURE
// ======================================================

// Boost an activity
router.post("/:activityId/like", authMiddleware, likeActivity);

// Remove boost from an activity
router.delete("/:activityId/like", authMiddleware, unlikeActivity);

// Get activity likes and total boost count
router.get("/:activityId/likes", authMiddleware, getActivityLikes);

// dynamic route always last
router.get("/:id", authMiddleware, getActivityDetail);

router.get("/stats/weekly", authMiddleware, getWeeklyActivityStats);

// lifetime stats
router.get("/stats/lifetime", authMiddleware, getLifetimeActivityStats);

router.get("/stats/personal-records", authMiddleware, getPersonalRecords);

router.delete("/:id", authMiddleware, deleteActivity);

export default router;
