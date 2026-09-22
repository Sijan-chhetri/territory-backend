import express from "express";

import {
  addAvatar,
  getAvatars,
  getMyAvatars,
  selectAvatar,
  equipMultipleAvatars,
  addMultipleAvatars,
  getEquippedAvatars,
  unequipAvatarType,
} from "./avatar.controller.js";

import authMiddleware from "../../middlewares/auth.js";

const router = express.Router();

/*
 * All avatar routes require login.
 */
router.use(authMiddleware);


/*
 * ==========================================================
 * MASTER AVATAR
 * ==========================================================
 */

// Add avatar to global catalog.
//
// In production I recommend putting
// an admin middleware on this route.
router.post(
  "/",
  addAvatar
);


/*
 * ==========================================================
 * USER AVATARS
 * ==========================================================
 */

// Get all avatar catalog items
router.get(
  "/",
  getAvatars
);


// Get avatars owned/unlocked by current user
router.get(
  "/my",
  getMyAvatars
);


// Get currently equipped avatar pieces
router.get(
  "/equipped",
  getEquippedAvatars
);


router.post(
  "/equip-multiple",
  equipMultipleAvatars
);


// Equip/select an avatar
router.post(
  "/:avatarId/select",
  selectAvatar
);


// Unequip one type
router.post(
  "/unequip/:type",
  unequipAvatarType
);


router.post(
  "/bulk",
  addMultipleAvatars
);






export default router;