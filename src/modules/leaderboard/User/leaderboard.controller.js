import prisma from "../../../config/prisma.js";

const attachUserAvatars = async (leaderboard) => {
  if (!leaderboard.length) {
    return leaderboard;
  }

  const userIds = leaderboard.map((item) => item.userId);

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: userIds,
      },
    },

    select: {
      id: true,
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
  });

  const avatarDataByUser = {};

  for (const user of users) {
    const avatar = {};

    for (const item of user.avatars) {
      avatar[item.avatar.type] = {
        id: item.avatar.id,
        file: item.avatar.file,
        type: item.avatar.type,
      };
    }

    avatarDataByUser[user.id] = {
      skinIndex: user.skinIndex ?? 2,
      avatar,
    };
  }

  return leaderboard.map((item) => {
    const avatarData = avatarDataByUser[item.userId];

    return {
      ...item,

      skinIndex: avatarData?.skinIndex ?? 2,

      avatar: avatarData?.avatar ?? {},
    };
  });
};

export const getDistanceLeaderboard = async (req, res) => {
  try {
    const leaderboard = await prisma.$queryRaw`
      SELECT
        u.id AS "userId",
        u.username,
        u."full_name" AS "fullName",
        u.city,
        u.country,

        COUNT(a.id)::int AS "activitiesCount",
        COALESCE(SUM(a."distanceKm"), 0)::float AS "totalDistanceKm",
        COALESCE(SUM(a.calories), 0)::float AS "totalCalories",
        COALESCE(SUM(a."durationSec"), 0)::int AS "totalDurationSec",
        COALESCE(SUM(a."movingTime"), 0)::int AS "totalMovingTimeSec",
        COALESCE(SUM(a."elevationGain"), 0)::float AS "totalElevationGain",

        COALESCE(up."totalXp", 0)::int AS "totalXp",
        COALESCE(up.level, 0)::int AS level,
        COALESCE(up."territoriesOwned", 0)::int AS "territoriesOwned",
        COALESCE(up."territoriesCaptured", 0)::int AS "territoriesCaptured"

      FROM activities a
      JOIN users u
        ON u.id = a."userId"
      LEFT JOIN user_progress up
        ON up."userId" = u.id

      WHERE COALESCE(a."include_in_clan", false) = false

      GROUP BY
        u.id,
        u.username,
        u."full_name",
        u.city,
        u.country,
        up."totalXp",
        up.level,
        up."territoriesOwned",
        up."territoriesCaptured"

      ORDER BY "totalDistanceKm" DESC
      LIMIT 50;
    `;

    const basicData = leaderboard.map((item, index) => ({
      rank: index + 1,
      userId: item.userId,
      username: item.username,
      fullName: item.fullName,
      city: item.city,
      country: item.country,

      totalDistanceKm: Number(item.totalDistanceKm ?? 0),
      totalCalories: Number(item.totalCalories ?? 0),
      totalDurationSec: Number(item.totalDurationSec ?? 0),
      totalMovingTimeSec: Number(item.totalMovingTimeSec ?? 0),
      totalElevationGain: Number(item.totalElevationGain ?? 0),

      totalXp: Number(item.totalXp ?? 0),
      level: Number(item.level ?? 0),
      activitiesCount: Number(item.activitiesCount ?? 0),
      territoriesOwned: Number(item.territoriesOwned ?? 0),
      territoriesCaptured: Number(item.territoriesCaptured ?? 0),
    }));
    const data = await attachUserAvatars(basicData);

    return res.status(200).json({
      success: true,
      count: data.length,
      leaderboard: data,
    });
  } catch (error) {
    console.error("GET_DISTANCE_LEADERBOARD_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch distance leaderboard",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getAreaLeaderboard = async (req, res) => {
  try {
    const leaderboard = await prisma.$queryRaw`
      SELECT
        u.id AS "userId",
        u.username,
        u."full_name" AS "fullName",
        u.city,
        u.country,

        COUNT(t.id)::int AS "territoriesCount",
        COALESCE(SUM(ST_Area(t.boundary::geography)) / 1000000, 0)::float AS "totalAreaKm2",

        COALESCE(up."totalXp", 0)::int AS "totalXp",
        COALESCE(up.level, 0)::int AS level,
        COALESCE(up."territoriesOwned", 0)::int AS "territoriesOwned",
        COALESCE(up."territoriesCaptured", 0)::int AS "territoriesCaptured"

      FROM territories t
      JOIN users u
        ON u.id = t."userId"
      LEFT JOIN activities a
        ON a.id = t."activityId"
      LEFT JOIN user_progress up
        ON up."userId" = u.id

      WHERE COALESCE(a."include_in_clan", false) = false

      GROUP BY
        u.id,
        u.username,
        u."full_name",
        u.city,
        u.country,
        up."totalXp",
        up.level,
        up."territoriesOwned",
        up."territoriesCaptured"

      ORDER BY "totalAreaKm2" DESC
      LIMIT 50;
    `;

    const basicData = leaderboard.map((item, index) => ({
      rank: index + 1,
      userId: item.userId,
      username: item.username,
      fullName: item.fullName,
      city: item.city,
      country: item.country,

      totalAreaKm2: Number(item.totalAreaKm2 ?? 0),
      territoriesCount: Number(item.territoriesCount ?? 0),

      totalXp: Number(item.totalXp ?? 0),
      level: Number(item.level ?? 0),
      territoriesOwned: Number(item.territoriesOwned ?? 0),
      territoriesCaptured: Number(item.territoriesCaptured ?? 0),
    }));
    const data = await attachUserAvatars(basicData);

    return res.status(200).json({
      success: true,
      count: data.length,
      leaderboard: data,
    });
  } catch (error) {
    console.error("GET_AREA_LEADERBOARD_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch area leaderboard",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getLocalDistanceLeaderboard = async (req, res) => {
  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        country: true,
      },
    });

    if (!currentUser?.country) {
      return res.status(400).json({
        success: false,
        message: "Your country is not set in your profile",
      });
    }

    const leaderboard = await prisma.$queryRaw`
      SELECT
        u.id AS "userId",
        u.username,
        u."full_name" AS "fullName",
        u.city,
        u.country,

        COUNT(a.id)::int AS "activitiesCount",
        COALESCE(SUM(a."distanceKm"), 0)::float AS "totalDistanceKm",
        COALESCE(SUM(a.calories), 0)::float AS "totalCalories",
        COALESCE(SUM(a."durationSec"), 0)::int AS "totalDurationSec",
        COALESCE(SUM(a."movingTime"), 0)::int AS "totalMovingTimeSec",
        COALESCE(SUM(a."elevationGain"), 0)::float AS "totalElevationGain",

        COALESCE(up."totalXp", 0)::int AS "totalXp",
        COALESCE(up.level, 0)::int AS level,
        COALESCE(up."territoriesOwned", 0)::int AS "territoriesOwned",
        COALESCE(up."territoriesCaptured", 0)::int AS "territoriesCaptured"

      FROM activities a
      JOIN users u
        ON u.id = a."userId"
      LEFT JOIN user_progress up
        ON up."userId" = u.id

      WHERE COALESCE(a."include_in_clan", false) = false
        AND LOWER(u.country) = LOWER(${currentUser.country})

      GROUP BY
        u.id,
        u.username,
        u."full_name",
        u.city,
        u.country,
        up."totalXp",
        up.level,
        up."territoriesOwned",
        up."territoriesCaptured"

      ORDER BY "totalDistanceKm" DESC
      LIMIT 50;
    `;

    const basicData = leaderboard.map((item, index) => ({
      rank: index + 1,
      userId: item.userId,
      username: item.username,
      fullName: item.fullName,
      city: item.city,
      country: item.country,

      totalDistanceKm: Number(item.totalDistanceKm ?? 0),
      totalCalories: Number(item.totalCalories ?? 0),
      totalDurationSec: Number(item.totalDurationSec ?? 0),
      totalMovingTimeSec: Number(item.totalMovingTimeSec ?? 0),
      totalElevationGain: Number(item.totalElevationGain ?? 0),

      totalXp: Number(item.totalXp ?? 0),
      level: Number(item.level ?? 0),
      activitiesCount: Number(item.activitiesCount ?? 0),
      territoriesOwned: Number(item.territoriesOwned ?? 0),
      territoriesCaptured: Number(item.territoriesCaptured ?? 0),
    }));
    const data = await attachUserAvatars(basicData);

    return res.status(200).json({
      success: true,
      type: "local_distance",
      country: currentUser.country,
      count: data.length,
      leaderboard: data,
    });
  } catch (error) {
    console.error("GET_LOCAL_DISTANCE_LEADERBOARD_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch local distance leaderboard",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getLocalAreaLeaderboard = async (req, res) => {
  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        country: true,
      },
    });

    if (!currentUser?.country) {
      return res.status(400).json({
        success: false,
        message: "Your country is not set in your profile",
      });
    }

    const leaderboard = await prisma.$queryRaw`
      SELECT
        u.id AS "userId",
        u.username,
        u."full_name" AS "fullName",
        u.city,
        u.country,

        COUNT(t.id)::int AS "territoriesCount",
        COALESCE(SUM(ST_Area(t.boundary::geography)) / 1000000, 0)::float AS "totalAreaKm2",

        COALESCE(up."totalXp", 0)::int AS "totalXp",
        COALESCE(up.level, 0)::int AS level,
        COALESCE(up."territoriesOwned", 0)::int AS "territoriesOwned",
        COALESCE(up."territoriesCaptured", 0)::int AS "territoriesCaptured"

      FROM territories t
      JOIN users u
        ON u.id = t."userId"
      LEFT JOIN activities a
        ON a.id = t."activityId"
      LEFT JOIN user_progress up
        ON up."userId" = u.id

      WHERE COALESCE(a."include_in_clan", false) = false
        AND LOWER(u.country) = LOWER(${currentUser.country})

      GROUP BY
        u.id,
        u.username,
        u."full_name",
        u.city,
        u.country,
        up."totalXp",
        up.level,
        up."territoriesOwned",
        up."territoriesCaptured"

      ORDER BY "totalAreaKm2" DESC
      LIMIT 50;
    `;

    const basicData = leaderboard.map((item, index) => ({
      rank: index + 1,
      userId: item.userId,
      username: item.username,
      fullName: item.fullName,
      city: item.city,
      country: item.country,

      totalAreaKm2: Number(item.totalAreaKm2 ?? 0),
      territoriesCount: Number(item.territoriesCount ?? 0),

      totalXp: Number(item.totalXp ?? 0),
      level: Number(item.level ?? 0),
      territoriesOwned: Number(item.territoriesOwned ?? 0),
      territoriesCaptured: Number(item.territoriesCaptured ?? 0),
    }));
    const data = await attachUserAvatars(basicData);

    return res.status(200).json({
      success: true,
      type: "local_area",
      country: currentUser.country,
      count: data.length,
      leaderboard: data,
    });
  } catch (error) {
    console.error("GET_LOCAL_AREA_LEADERBOARD_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch local area leaderboard",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
