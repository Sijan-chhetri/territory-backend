import prisma from "../../config/prisma.js";
import { createNotification } from "../notification/notification.controller.js";
import admin from "firebase-admin";

// ======================================================
// HELPER: CHECK ACTIVITY ACCESS
// ======================================================

const checkActivityAccess = async (activityId, userId) => {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      userId: true,
      visibility: true,
    },
  });

  if (!activity) {
    return {
      allowed: false,
      status: 404,
      message: "Activity not found",
    };
  }

  // The activity owner can view their own likes.
  if (activity.userId === userId) {
    return { allowed: true, activity };
  }

  // Public activity.
  if (activity.visibility === "PUBLIC") {
    return { allowed: true, activity };
  }

  // Private activity.
  if (activity.visibility === "PRIVATE") {
    return {
      allowed: false,
      status: 404,
      message: "Activity not found",
    };
  }

  // Friends-only activity.
  if (activity.visibility === "FRIENDS") {
    const friendship = await prisma.friendship.findUnique({
      where: {
        userId_friendId: {
          userId,
          friendId: activity.userId,
        },
      },
    });

    if (friendship) {
      return { allowed: true, activity };
    }
  }

  return {
    allowed: false,
    status: 404,
    message: "Activity not found",
  };
};

// ======================================================
// HELPER: GET ACTIVITY LIKE SUMMARY
// ======================================================

const getLikeSummary = async (activityId, userId) => {
  const [likeCount, existingLike] = await Promise.all([
    prisma.activityLike.count({
      where: { activityId },
    }),

    prisma.activityLike.findUnique({
      where: {
        userId_activityId: {
          userId,
          activityId,
        },
      },
      select: { id: true },
    }),
  ]);

  return {
    likeCount,
    isLiked: Boolean(existingLike),
  };
};

// ======================================================
// 1. LIKE ACTIVITY (BOOST)
// POST /api/activities/:activityId/like
// ======================================================

export const likeActivity = async (req, res) => {
  try {
    const userId = req.user.id;
    const activityId = req.params.activityId?.trim();

    if (!activityId) {
      return res.status(400).json({
        success: false,
        message: "Activity ID is required",
      });
    }

    const access = await checkActivityAccess(activityId, userId);

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    // Prevent boosting your own activity.
    if (access.activity.userId === userId) {
      return res.status(403).json({
        success: false,
        message: "You cannot boost your own activity",
      });
    }

    let newlyLiked = false;

    try {
      await prisma.activityLike.create({
        data: {
          userId,
          activityId,
        },
      });

      newlyLiked = true;
    } catch (error) {
      if (error.code !== "P2002") {
        if (error.code === "P2003" || error.code === "P2025") {
          return res.status(404).json({
            success: false,
            message: "Activity not found",
          });
        }

        throw error;
      }
    }

    // Notify the activity owner only for a newly created like.
    if (newlyLiked && access.activity.userId !== userId) {
      try {
        const liker = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            fullName: true,
            username: true,
          },
        });

        const likerName =
          liker?.fullName?.trim() || liker?.username?.trim() || "Someone";

        await createNotification({
          userId: access.activity.userId,
          title: "New Like",
          message: `${likerName} liked your activity.`,
          type: "ACTIVITY_LIKE",
          activityId,
        });
      } catch (notificationError) {
        console.error("ACTIVITY_LIKE_NOTIFICATION_ERROR:", notificationError);
      }
    }

    const summary = await getLikeSummary(activityId, userId);

    return res.status(200).json({
      success: true,
      message: "Activity boosted successfully",
      activityId,
      ...summary,
    });
  } catch (error) {
    console.error("LIKE_ACTIVITY_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to boost activity",
    });
  }
};

// ======================================================
// 2. UNLIKE ACTIVITY (REMOVE BOOST)
// DELETE /api/activities/:activityId/like
// ======================================================

export const unlikeActivity = async (req, res) => {
  try {
    const userId = req.user.id;
    const activityId = req.params.activityId?.trim();

    if (!activityId) {
      return res.status(400).json({
        success: false,
        message: "Activity ID is required",
      });
    }

    const access = await checkActivityAccess(activityId, userId);

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    await prisma.activityLike.deleteMany({
      where: {
        userId,
        activityId,
      },
    });

    const summary = await getLikeSummary(activityId, userId);

    return res.status(200).json({
      success: true,
      message: "Boost removed successfully",
      activityId,
      ...summary,
    });
  } catch (error) {
    console.error("UNLIKE_ACTIVITY_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove boost",
    });
  }
};

// ======================================================
// 3. GET ACTIVITY LIKES
// GET /api/activities/:activityId/likes
// ======================================================

export const getActivityLikes = async (req, res) => {
  try {
    const userId = req.user.id;
    const activityId = req.params.activityId?.trim();

    if (!activityId) {
      return res.status(400).json({
        success: false,
        message: "Activity ID is required",
      });
    }

    const access = await checkActivityAccess(activityId, userId);

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const [summary, likes] = await Promise.all([
      getLikeSummary(activityId, userId),

      prisma.activityLike.findMany({
        where: { activityId },

        orderBy: {
          createdAt: "desc",
        },

        take: 50,

        select: {
          id: true,
          createdAt: true,

          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              skinIndex: true,

              avatars: {
                where: {
                  isEquipped: true,
                  status: "UNLOCKED",
                },
                include: {
                  avatar: true,
                },
              },
            },
          },
        },
      }),
    ]);

    // Format equipped avatars for each user who boosted the activity.
    const formattedLikes = likes.map((like) => {
      const avatar = {};

      for (const item of like.user.avatars ?? []) {
        if (!item.avatar) continue;

        avatar[item.avatar.type] = {
          id: item.avatar.id,
          file: item.avatar.file,
          type: item.avatar.type,
        };
      }

      return {
        id: like.id,
        createdAt: like.createdAt,
        user: {
          id: like.user.id,
          username: like.user.username,
          fullName: like.user.fullName,
          skinIndex: like.user.skinIndex ?? 2,
          avatar,
        },
      };
    });

    return res.status(200).json({
      success: true,
      activityId,
      ...summary,
      likes: formattedLikes,
    });
  } catch (error) {
    console.error("GET_ACTIVITY_LIKES_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch activity likes",
    });
  }
};
