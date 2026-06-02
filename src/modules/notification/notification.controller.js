import prisma from "../../config/prisma.js";
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
      Object.entries(fcmData).map(([key, value]) => [
        key,
        String(value ?? ""),
      ])
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

export const getMyNotifications = async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.user.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      count: notifications.length,
      notifications,
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
    const result = await prisma.notification.updateMany({
      where: {
        userId: req.user.id,
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
    console.error("MARK_ALL_NOTIFICATIONS_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update notifications",
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
    const { id } = req.params;

    const result = await prisma.notification.deleteMany({
      where: {
        id,
        userId: req.user.id,
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
      message: "Notification deleted",
    });
  } catch (error) {
    console.error("DELETE_NOTIFICATION_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete notification",
    });
  }
};