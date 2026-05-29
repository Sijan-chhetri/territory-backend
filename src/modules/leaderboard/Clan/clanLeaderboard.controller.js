import prisma from "../../../config/prisma.js";

export const getClanTerritoryLeaderboard = async (req, res) => {
  try {
    const leaderboard = await prisma.$queryRaw`
      WITH activity_stats AS (
        SELECT
          cm."clanId",
          COUNT(DISTINCT a.id)::int AS "totalActivities",
          COALESCE(SUM(a."distanceKm"), 0)::float AS "totalDistanceKm",
          COALESCE(SUM(a.calories), 0)::float AS "totalCalories",
          COALESCE(SUM(a."durationSec"), 0)::int AS "totalDurationSec"
        FROM clan_members cm
        JOIN activities a
          ON a."userId" = cm."userId"
        WHERE a."include_in_clan" = true
        GROUP BY cm."clanId"
      ),

      territory_stats AS (
        SELECT
          cm."clanId",
          COUNT(DISTINCT t.id)::int AS "territoryCount",
          COALESCE(SUM(t."areaKm2"), 0)::float AS "totalAreaKm2"
        FROM clan_members cm
        JOIN territories t
          ON t."userId" = cm."userId"
        JOIN activities a
          ON a.id = t."activityId"
        WHERE a."include_in_clan" = true
        GROUP BY cm."clanId"
      ),

      member_stats AS (
        SELECT
          cm."clanId",
          COUNT(DISTINCT cm."userId")::int AS "runnerCount"
        FROM clan_members cm
        GROUP BY cm."clanId"
      )

      SELECT
        c.id AS "clanId",
        c.name,
        c.slug,
        c.logo,
        c.banner,

        COALESCE(ms."runnerCount", 0)::int AS "runnerCount",
        COALESCE(ast."totalActivities", 0)::int AS "totalActivities",
        COALESCE(ast."totalDistanceKm", 0)::float AS "totalDistanceKm",
        COALESCE(ast."totalCalories", 0)::float AS "totalCalories",
        COALESCE(ast."totalDurationSec", 0)::int AS "totalDurationSec",

        COALESCE(ts."territoryCount", 0)::int AS "territoryCount",
        COALESCE(ts."totalAreaKm2", 0)::float AS "totalAreaKm2"

      FROM clans c

      LEFT JOIN activity_stats ast
        ON ast."clanId" = c.id

      LEFT JOIN territory_stats ts
        ON ts."clanId" = c.id

      LEFT JOIN member_stats ms
        ON ms."clanId" = c.id

      ORDER BY
        "territoryCount" DESC,
        "totalAreaKm2" DESC,
        "totalDistanceKm" DESC

      LIMIT 50;
    `;

    const data = leaderboard.map((item, index) => ({
      rank: index + 1,
      clanId: item.clanId,
      name: item.name,
      slug: item.slug,
      logo: item.logo,
      banner: item.banner,

      runnerCount: Number(item.runnerCount ?? 0),
      totalActivities: Number(item.totalActivities ?? 0),
      totalDistanceKm: Number(item.totalDistanceKm ?? 0),
      totalCalories: Number(item.totalCalories ?? 0),
      totalDurationSec: Number(item.totalDurationSec ?? 0),

      territoryCount: Number(item.territoryCount ?? 0),
      totalAreaKm2: Number(item.totalAreaKm2 ?? 0),
    }));

    return res.status(200).json({
      success: true,
      count: data.length,
      leaderboard: data,
    });
  } catch (error) {
    console.error("GET_CLAN_TERRITORY_LEADERBOARD_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch clan leaderboard",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};