import { Router } from "express";
import authMiddleware from "../../middlewares/auth.js";

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
  getVisibleActivityDetail,
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
  "/activities/friends/:activityId",
  authMiddleware,
  getFriendActivityDetails,
);

router.patch("/:id/visibility", authMiddleware, updateActivityVisibility);

router.get("/view/:activityId", authMiddleware, getVisibleActivityDetail);

// dynamic route always last
router.get("/:id", authMiddleware, getActivityDetail);

router.get("/stats/weekly", authMiddleware, getWeeklyActivityStats);

// lifetime stats
router.get("/stats/lifetime", authMiddleware, getLifetimeActivityStats);

router.get("/stats/personal-records", authMiddleware, getPersonalRecords);

export default router;
