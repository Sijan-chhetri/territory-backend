import { Router } from "express";
import authMiddleware from "../../middlewares/auth.js";

import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification
} from "./notification.controller.js";

const router = Router();

router.get(
  "/my",
  authMiddleware,
  getMyNotifications
);


/*
|--------------------------------------------------------------------------
| MARK ALL NOTIFICATIONS AS READ
|--------------------------------------------------------------------------
| PATCH /api/notification/read-all
*/
router.patch(
  "/read-all",
  authMiddleware,
  markAllAsRead
);


router.patch(
  "/:id/read",
  authMiddleware,
  markAsRead
);


// DELETE /api/notification/:id

router.delete(
  "/:id",
  authMiddleware,
  deleteNotification
);

export default router;