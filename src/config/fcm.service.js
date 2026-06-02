// services/fcm.service.js

import admin from "./firebase.js";
import prisma from "./prisma.js";

export const sendFCMToUser = async ({
  userId,
  title,
  message,
  data = {},
}) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (!user?.fcmToken) {
      console.log("FCM skipped: user has no token");
      return null;
    }

    const payload = {
      token: user.fcmToken,
      notification: {
        title,
        body: message,
      },
      data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [
          key,
          String(value ?? ""),
        ])
      ),
    };

    const response = await admin.messaging().send(payload);

    console.log("FCM sent:", response);
    return response;
  } catch (error) {
    console.error("SEND_FCM_ERROR:", error);
    return null;
  }
};