import { Router } from "express";
import authMiddleware from "../../middlewares/auth.js";

import {
  getMyNotifications,
  markAsRead,
} from "./notification.controller.js";

const router = Router();

router.get(
  "/my",
  authMiddleware,
  getMyNotifications
);

router.patch(
  "/:id/read",
  authMiddleware,
  markAsRead
);

export default router;