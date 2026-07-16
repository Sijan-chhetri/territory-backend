import express from "express";
import authMiddleware from "../../middlewares/auth.js";

import {
  createClanEvent,
  joinClanEvent,
  leaveClanEvent,
  getMyClanEvents,
  getClanEventDetail,
  cancelClanEvent,
} from "./clanEvent.controller.js";

const router = express.Router();

/**
 * Current user's clan event routes
 */
router.post(
  "/",
  authMiddleware,
  createClanEvent
);

router.get(
  "/",
  authMiddleware,
  getMyClanEvents
);

/**
 * Individual event routes
 */
router.post(
  "/:eventId/join",
  authMiddleware,
  joinClanEvent
);

router.delete(
  "/:eventId/leave",
  authMiddleware,
  leaveClanEvent
);

router.patch(
  "/:eventId/cancel",
  authMiddleware,
  cancelClanEvent
);

router.get(
  "/:eventId",
  authMiddleware,
  getClanEventDetail
);

export default router;