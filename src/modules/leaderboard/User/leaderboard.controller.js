import prisma from "../../../config/prisma.js";

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

    const data = leaderboard.map((item, index) => ({
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

    const data = leaderboard.map((item, index) => ({
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