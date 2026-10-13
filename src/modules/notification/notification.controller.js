import prisma from "../../config/prisma.js";
import admin from "firebase-admin";
import { emitToUser } from "../../config/socket.js";

/**
 * ============================================================================
 * SEND FCM NOTIFICATION TO USER
 * ============================================================================
 */

const sendFcmToUser = async ({
  userId,
  title,
  message,
  type,
  territoryId = null,
  activityId = null,
  notificationId = null,
  data = null,
}) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        fcmToken: true,
      },
    });

    if (!user?.fcmToken) {
      console.log("FCM skipped: user has no FCM token", { userId });
      return null;
    }

    const fcmData = {
      notificationId: String(notificationId ?? ""),
      type: String(type ?? ""),
      territoryId: String(territoryId ?? ""),
      activityId: String(activityId ?? ""),
      ...(data || {}),
    };

    const safeData = Object.fromEntries(
      Object.entries(fcmData).map(([key, value]) => [key, String(value ?? "")]),
    );

    const response = await admin.messaging().send({
      token: user.fcmToken,
      notification: {
        title,
        body: message,
      },
      data: safeData,
    });

    console.log("FCM sent successfully:", response);
    return response;
  } catch (error) {
    console.error("SEND_FCM_ERROR:", error);
    return null;
  }
};

/**
 * ============================================================================
 * CREATE NOTIFICATION
 * ============================================================================
 */

// export const createNotification = async ({
//   tx = prisma,
//   userId,
//   title,
//   message,
//   type,
//   territoryId = null,
//   activityId = null,
//   data = null,
// }) => {
//   try {
//     const notification = await tx.notification.create({
//       data: {
//         userId,
//         title,
//         message,
//         type,
//         territoryId,
//         activityId,
//       },
//     });

//     emitToUser(userId, "notification:new", {
//       id: notification.id,
//       title: notification.title,
//       message: notification.message,
//       type: notification.type,
//       territoryId: notification.territoryId,
//       activityId: notification.activityId,
//       isRead: notification.isRead,
//       createdAt: notification.createdAt,
//       data,
//     });

//     return notification;
//   } catch (error) {
//     console.error("CREATE_NOTIFICATION_ERROR:", error);
//     return null;
//   }
// };

export const createNotification = async ({
  tx = prisma,
  userId,
  title,
  message,
  type,
  territoryId = null,
  activityId = null,
  data = null,
}) => {
  try {
    // ============================================================
    // 1. SAVE NOTIFICATION TO DATABASE
    // ============================================================

    const notification = await tx.notification.create({
      data: {
        userId,
        title,
        message,
        type,
        territoryId,
        activityId,
      },
    });

    // ============================================================
    // 2. SEND REAL-TIME SOCKET NOTIFICATION
    // ============================================================

    // Only emit immediately when using the default Prisma client.
    // External transactions must finish committing first.
    if (tx === prisma) {
      try {
        emitToUser(userId, "notification:new", {
          id: notification.id,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          territoryId: notification.territoryId,
          activityId: notification.activityId,
          isRead: notification.isRead,
          createdAt: notification.createdAt,
          data,
        });
      } catch (socketError) {
        console.error("NOTIFICATION_SOCKET_ERROR:", socketError);
      }
    }

    // ============================================================
    // 3. SEND FIREBASE PUSH FOR ACTIVITY LIKES
    // ============================================================

    if (type === "ACTIVITY_LIKE" && tx === prisma) {
      try {
        const fcmResponse = await sendFcmToUser({
          userId,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          territoryId: notification.territoryId,
          activityId: notification.activityId,
          notificationId: notification.id,
          data,
        });

        if (fcmResponse) {
          console.log("ACTIVITY_LIKE_FCM_SUCCESS:", {
            userId,
            notificationId: notification.id,
            activityId,
          });
        } else {
          console.log("ACTIVITY_LIKE_FCM_SKIPPED_OR_FAILED:", {
            userId,
            notificationId: notification.id,
          });
        }
      } catch (fcmError) {
        console.error("ACTIVITY_LIKE_FCM_ERROR:", fcmError);
      }
    }

    return notification;
  } catch (error) {
    console.error("CREATE_NOTIFICATION_ERROR:", error);
    return null;
  }
};

/**
 * ============================================================================
 * GET MY NOTIFICATIONS
 * ============================================================================
 */
const USER_UUID_REGEX =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;

    // =========================================================
    // 1. FETCH NOTIFICATIONS
    // =========================================================

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (notifications.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        notifications: [],
      });
    }

    // =========================================================
    // 2. EXTRACT UNIQUE USER IDS
    // =========================================================

    const uniqueUserIds = new Set();

    for (const notification of notifications) {
      if (!notification.message) continue;

      const matches = notification.message.match(USER_UUID_REGEX);

      if (!matches) continue;

      for (const id of matches) {
        uniqueUserIds.add(id.toLowerCase());
      }
    }

    // =========================================================
    // 3. FETCH USERNAMES IN ONE QUERY
    // =========================================================

    const usernameMap = new Map();

    if (uniqueUserIds.size > 0) {
      const users = await prisma.user.findMany({
        where: {
          id: {
            in: [...uniqueUserIds],
          },
        },
        select: {
          id: true,
          username: true,
        },
      });

      for (const user of users) {
        usernameMap.set(user.id.toLowerCase(), user.username);
      }
    }

    // =========================================================
    // 4. REPLACE USER IDS WITH USERNAMES
    // =========================================================

    const formattedNotifications = notifications.map((notification) => {
      const message = notification.message;

      if (!message || uniqueUserIds.size === 0) {
        return notification;
      }

      const formattedMessage = message.replace(USER_UUID_REGEX, (id) => {
        const username = usernameMap.get(id.toLowerCase());

        return username ? `@${username}` : id;
      });

      return {
        ...notification,
        message: formattedMessage,
      };
    });

    // =========================================================
    // 5. RESPONSE
    // =========================================================

    return res.status(200).json({
      success: true,
      count: formattedNotifications.length,
      notifications: formattedNotifications,
    });
  } catch (error) {
    console.error("GET_NOTIFICATIONS_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load notifications",
    });
  }
};

/**
 * ============================================================================
 * MARK SINGLE NOTIFICATION AS READ
 * ============================================================================
 */

export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await prisma.notification.updateMany({
      where: {
        id,
        userId: req.user.id,
      },
      data: {
        isRead: true,
      },
    });

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("MARK_NOTIFICATION_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update notification",
    });
  }
};

/**
 * ============================================================================
 * MARK ALL NOTIFICATIONS AS READ
 * ============================================================================
 */

export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      updatedCount: result.count,
    });
  } catch (error) {
    console.error("MARK_ALL_NOTIFICATIONS_READ_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to mark all notifications as read",
    });
  }
};

/**
 * ============================================================================
 * DELETE NOTIFICATION
 * ============================================================================
 */

export const deleteNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Notification ID is required",
      });
    }

    const result = await prisma.notification.deleteMany({
      where: {
        id,
        userId,
      },
    });

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("DELETE_NOTIFICATION_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete notification",
    });
  }
};
