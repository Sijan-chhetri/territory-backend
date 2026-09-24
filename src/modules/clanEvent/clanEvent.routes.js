import express from "express";
import authMiddleware from "../../middlewares/auth.js";

import {
  createClanEvent,
  updateClanEvent,
  joinClanEvent,
  leaveClanEvent,
  getMyClanEvents,
  getClanEventDetail,
  cancelClanEvent,
  deleteClanEvent,
  discoverClanEvents,

  // Club Event activity
  startClanEventRun,
  updateClanEventRunProgress,
  stopClanEventRun,
  endClanEventRun,
  finalizeClanEventRun,
  getClanEventRunStatus,
  getClanEventRunResults,
} from "./clanEvent.controller.js";

const router = express.Router();

/**
 * Current user's clan event routes
 */
router.post("/", authMiddleware, createClanEvent);

router.get("/", authMiddleware, getMyClanEvents);

/**
 * |--------------------------------------------------------------------------
 * | CLUB EVENT ACTIVITY
 * |--------------------------------------------------------------------------
 *
 * IMPORTANT:
 * These routes must stay above GET /:eventId.
 */

router.get("/discover", authMiddleware, discoverClanEvents);

router.post("/:eventId/run/start", authMiddleware, startClanEventRun);

router.patch(
  "/:eventId/run/progress",
  authMiddleware,
  updateClanEventRunProgress,
);

router.post("/:eventId/run/stop", authMiddleware, stopClanEventRun);

router.post("/:eventId/run/end", authMiddleware, endClanEventRun);

router.post("/:eventId/run/finalize", authMiddleware, finalizeClanEventRun);

router.get("/:eventId/run/status", authMiddleware, getClanEventRunStatus);

router.get("/:eventId/run/results", authMiddleware, getClanEventRunResults);

/**
 * |--------------------------------------------------------------------------
 * | INDIVIDUAL EVENT ROUTES
 * |--------------------------------------------------------------------------
 */

router.patch("/:eventId", authMiddleware, updateClanEvent);
router.delete("/:eventId", authMiddleware, deleteClanEvent);

/**
 * Individual event routes
 */
router.post("/:eventId/join", authMiddleware, joinClanEvent);

router.delete("/:eventId/leave", authMiddleware, leaveClanEvent);

router.patch("/:eventId/cancel", authMiddleware, cancelClanEvent);

router.get("/:eventId", authMiddleware, getClanEventDetail);

export default router;
