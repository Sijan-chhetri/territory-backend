import prisma from "../../config/prisma.js";
import { emitToUser } from "../../config/socket.js";

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

        // real-time push, safe: will not crash if socket fails
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
export const getMyNotifications = async (req, res) => {
    try {
        const notifications =
            await prisma.notification.findMany({
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
        console.error(
            "GET_NOTIFICATIONS_ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to load notifications",
        });
    }
};

export const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.notification.updateMany({
            where: {
                id,
                userId: req.user.id,
            },
            data: {
                isRead: true,
            },
        });

        return res.status(200).json({
            success: true,
        });
    } catch (error) {
        console.error(
            "MARK_NOTIFICATION_ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to update notification",
        });
    }
};