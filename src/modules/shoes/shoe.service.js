import prisma from "../../config/prisma.js";
import admin from "firebase-admin";
import { emitToUser } from "../../config/socket.js";

// Statistics are derived from Activity, the authoritative record.
export async function refreshShoeStats(shoeId) {
  if (!shoeId) return null;

  // Calculate mileage from saved activities.
  const stats = await prisma.activity.aggregate({
    where: { shoeId },
    _sum: {
      distanceKm: true,
      durationSec: true,
    },
    _count: { _all: true },
  });

  const totalKm = stats._sum.distanceKm ?? 0;
  const totalTimeSec = stats._sum.durationSec ?? 0;
  const totalRuns = stats._count._all;

  const milestones = [
    {
      km: 50,
      field: "shoe50KmNotifiedAt",
      title: "50 KM IN THE BAG!",
      message: (name) =>
        `Your ${name} just hit 50 km! Every step counts. Keep moving!`,
    },
    {
      km: 100,
      field: "shoe100KmNotifiedAt",
      title: "100 KM STRONG!",
      message: (name) =>
        `Your ${name} has officially crossed 100 km! What a journey. Keep pushing!`,
    },
  ];

  // Update mileage and record milestone notifications atomically.
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.runningShoe.updateMany({
      where: { id: shoeId },
      data: {
        totalKm,
        totalTimeSec,
        totalRuns,
      },
    });

    if (updated.count === 0) {
      return {
        updated: false,
        notifications: [],
        userId: null,
      };
    }

    const shoe = await tx.runningShoe.findUnique({
      where: { id: shoeId },
      select: {
        userId: true,
        brand: true,
        model: true,
      },
    });

    if (!shoe) {
      throw new Error("Shoe not found after statistics update.");
    }

    const shoeName = `${shoe.brand} ${shoe.model}`.trim();
    const notifications = [];

    for (const milestone of milestones) {
      if (totalKm < milestone.km) continue;

      // Atomically claim each milestone once.
      const claimed = await tx.runningShoe.updateMany({
        where: {
          id: shoeId,
          [milestone.field]: null,
        },
        data: {
          [milestone.field]: new Date(),
        },
      });

      if (claimed.count === 0) continue;

      const notification = await tx.notification.create({
        data: {
          userId: shoe.userId,
          title: milestone.title,
          message: milestone.message(shoeName),
          type: "SHOE_MILESTONE",
        },
      });

      notifications.push({
        notification,
        milestoneKm: milestone.km,
      });
    }

    return {
      updated: true,
      notifications,
      userId: shoe.userId,
    };
  });

  // Send live and push notifications after transaction commits.
  if (result.notifications.length > 0 && result.userId) {
    const userId = result.userId;

    let fcmToken = null;

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { fcmToken: true },
      });

      fcmToken = user?.fcmToken ?? null;
    } catch (error) {
      console.error("SHOE_MILESTONE_TOKEN_LOOKUP_ERROR:", error);
    }

    for (const item of result.notifications) {
      const { notification, milestoneKm } = item;

      // Socket notification.
      try {
        emitToUser(userId, "notification:new", {
          id: notification.id,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          territoryId: null,
          activityId: null,
          isRead: notification.isRead,
          createdAt: notification.createdAt,
          data: {
            shoeId: String(shoeId),
            milestoneKm: String(milestoneKm),
          },
        });
      } catch (error) {
        console.error("SHOE_MILESTONE_SOCKET_ERROR:", error);
      }

      // Firebase push notification.
      if (fcmToken) {
        try {
          await admin.messaging().send({
            token: fcmToken,
            notification: {
              title: notification.title,
              body: notification.message,
            },
            data: {
              type: "SHOE_MILESTONE",
              notificationId: String(notification.id),
              shoeId: String(shoeId),
              milestoneKm: String(milestoneKm),
            },
            android: {
              priority: "high",
            },
          });

          console.log("SHOE_MILESTONE_FCM_SENT:", {
            userId,
            shoeId,
            milestoneKm,
          });
        } catch (error) {
          console.error("SHOE_MILESTONE_FCM_ERROR:", error);
        }
      }
    }
  }

  return result;
}

export async function resolveActivityShoe(userId, requestedShoeId, mode) {
  const normalizedMode = String(mode).toUpperCase();

  // Only RUN and WALK can have shoes assigned
  if (!["RUN", "WALK"].includes(normalizedMode)) {
    if (
      requestedShoeId !== undefined &&
      requestedShoeId !== null &&
      requestedShoeId !== ""
    ) {
      const error = new Error(
        "Shoes can only be assigned to running or walking activities",
      );
      error.status = 400;
      throw error;
    }

    return null;
  }

  // Explicit null = user selected no shoe
  if (requestedShoeId === null) {
    return null;
  }

  let shoe;

  // No shoeId supplied -> use default active shoe
  if (requestedShoeId === undefined || requestedShoeId === "") {
    shoe = await prisma.runningShoe.findFirst({
      where: {
        userId,
        isDefault: true,
        status: "ACTIVE",
      },
    });
  } else {
    // Use selected shoe
    shoe = await prisma.runningShoe.findFirst({
      where: {
        id: requestedShoeId,
        userId,
        status: "ACTIVE",
      },
    });

    if (!shoe) {
      const error = new Error("Selected shoe was not found or is retired");
      error.status = 400;
      throw error;
    }
  }

  return shoe?.id ?? null;
}
