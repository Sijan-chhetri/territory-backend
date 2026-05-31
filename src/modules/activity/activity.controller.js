import prisma from '../../config/prisma.js';
import { captureTerritory } from './territory.controller.js';
import { addXP } from '../xp/xp.service.js';
import { checkLevelUp } from '../level/level.service.js';
import { checkBadges } from '../badge/badge.service.js';
import polyline from '@mapbox/polyline';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatPace(secPerKm) {
  if (secPerKm == null) return null;

  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60).toString().padStart(2, '0');

  return `${mins}:${secs}/km`;
}

function computeKmSplits(coordinates) {
  if (!coordinates || coordinates.length < 2) return [];

  const toRad = (deg) => (deg * Math.PI) / 180;

  function haversine(a, b) {
    const R = 6371;

    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) ** 2;

    return R * 2 * Math.asin(Math.sqrt(h));
  }

  const splits = [];
  let kmCount = 0;
  let accDist = 0;
  let kmStartTime = new Date(coordinates[0].timestamp).getTime();

  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];

    accDist += haversine(prev, curr);

    while (accDist >= 1) {
      kmCount++;

      const timeSec = Math.round(
        (new Date(curr.timestamp).getTime() - kmStartTime) / 1000
      );

      splits.push({
        km: kmCount,
        timeSec,
        pace: timeSec,
        paceFormatted: formatPace(timeSec),
      });

      kmStartTime = new Date(curr.timestamp).getTime();
      accDist -= 1;
    }
  }

  return splits;
}

function validateRouteEncoded(routeEncoded) {
  if (!routeEncoded) return null;

  if (typeof routeEncoded !== 'string') {
    throw new Error('routeEncoded must be a string');
  }

  if (routeEncoded.includes('�')) {
    throw new Error('routeEncoded contains corrupted replacement characters');
  }

  return routeEncoded.trim();
}

function normalizeCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return [];

  return coordinates
    .map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      timestamp: p.timestamp,
    }))
    .filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        p.lat >= -90 &&
        p.lat <= 90 &&
        p.lng >= -180 &&
        p.lng <= 180
    );
}

function buildLineGeoJsonFromCoords(coords) {
  return {
    type: 'LineString',
    coordinates: coords.map((p) => [p.lng, p.lat]),
  };
}

function getRouteSegmentsFromEncoded(routeEncoded) {
  if (!routeEncoded) return [];

  return [routeEncoded];
}

// ─────────────────────────────────────────────
// Get My Activities
// GET /api/activities/my
// ─────────────────────────────────────────────

export const getMyActivities = async (req, res) => {
  try {
    const activities = await prisma.activity.findMany({
      where: { userId: req.user.id },
      orderBy: { startedAt: 'desc' },
      include: { territories: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Activities loaded',
      activities,
    });
  } catch (error) {
    console.error('GET_MY_ACTIVITIES ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ─────────────────────────────────────────────
// Finish Activity
// POST /api/activities/finish
// ─────────────────────────────────────────────

export const finishActivity = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      mode,
      distanceKm,
      durationSec,
      stopTime,
      elapsedTime,
      movingTime,
      avgPace,
      topPace,
      avgSpeed,
      topSpeed,
      calories,
      elevationGain,
      startedAt,
      endedAt,
      routeEncoded,
      coordinates,
      kmSplits: clientKmSplits,
      includeInClan,
      notes,
      areaKm2
    } = req.body;

    const safeRouteEncoded = validateRouteEncoded(routeEncoded);

    let resolvedCoords = normalizeCoordinates(coordinates);

    if ((!resolvedCoords || resolvedCoords.length < 2) && safeRouteEncoded) {
      let decoded;

      try {
        decoded = polyline.decode(safeRouteEncoded);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid routeEncoded. Could not decode polyline.',
          error:
            process.env.NODE_ENV === 'development'
              ? error.message
              : undefined,
        });
      }

      resolvedCoords = decoded.map(([lat, lng]) => ({ lat, lng }));
      resolvedCoords = normalizeCoordinates(resolvedCoords);
    }

    if (!resolvedCoords || resolvedCoords.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Not enough GPS points — provide coordinates or routeEncoded',
      });
    }

    const routeGeoJson = buildLineGeoJsonFromCoords(resolvedCoords);
    const routeGeoJsonString = JSON.stringify(routeGeoJson);

    const kmSplits =
      clientKmSplits?.length > 0
        ? clientKmSplits
        : computeKmSplits(resolvedCoords);

    // 1. Save original activity.
    // Important: activity route is NEVER subtracted.
    const activity = await prisma.activity.create({
      data: {
        userId,
        mode,
        distanceKm,
        durationSec,
        stopTime,
        elapsedTime,
        movingTime,
        avgPace,
        topPace,
        avgSpeed,
        topSpeed,
        calories,
        elevationGain,
        startedAt: new Date(startedAt),
        endedAt: new Date(endedAt),
        routeEncoded: safeRouteEncoded,
        kmSplits,
        includeInClan: includeInClan ?? false,
        notes: notes ?? null,
      },
    });

    // 2. Save activity routeGeometry safely.
    await prisma.$executeRaw`
      UPDATE activities
      SET "routeGeometry" = ST_SetSRID(
        ST_GeomFromGeoJSON(${routeGeoJsonString}),
        4326
      )
      WHERE id = ${activity.id};
    `;


    const frontendAreaKm2 =
      areaKm2 !== undefined &&
        areaKm2 !== null &&
        !Number.isNaN(Number(areaKm2)) &&
        Number(areaKm2) > 0
        ? Number(areaKm2)
        : null;

    // 3. Create raw territory from route buffer.
    // At this point, it is still full buffered route.
    // captureTerritory() will subtract enemy territory from this.
    const territoryResult = await prisma.$queryRaw`
      WITH new_route AS (
        SELECT ST_SetSRID(
          ST_GeomFromGeoJSON(${routeGeoJsonString}),
          4326
        ) AS route
      ),
      new_area AS (
  SELECT
    ST_MakeValid(
      ST_SnapToGrid(
        ST_Buffer(
          route::geography,
          1,
          'endcap=flat join=round quad_segs=2'
        )::geometry,
        0.0000001
      )
    ) AS territory,
    route
  FROM new_route
),
      inserted AS (
        INSERT INTO territories (
          id,
          "userId",
          "activityId",
          boundary,
          center,
          "routeEncoded",
          "routeSegmentsEncoded",
          "routeGeometry",
          "areaKm2",
          "capturedAt",
          "createdAt",
          "updatedAt"
        )
        SELECT
          gen_random_uuid(),
          ${userId},
          ${activity.id},
          territory,
          ST_PointOnSurface(territory),
          ${safeRouteEncoded},
          ${JSON.stringify(getRouteSegmentsFromEncoded(safeRouteEncoded))}::jsonb,
          route,
          COALESCE(${frontendAreaKm2}, ST_Area(territory::geography) / 1000000),
          NOW(),
          NOW(),
          NOW()
        FROM new_area
        WHERE territory IS NOT NULL
          AND NOT ST_IsEmpty(territory)
        RETURNING id
      )
      SELECT id FROM inserted;
    `;

    if (!territoryResult || territoryResult.length === 0) {
      return res.status(201).json({
        success: true,
        message: 'Activity completed, but no territory was created.',
        activity,
        territory: null,
        captureEvents: [],
      });
    }

    const territoryId = territoryResult[0].id;

    // 4. Subtract other users' existing territories from this new territory.
    // This affects Territory only. Activity route stays original.
    await captureTerritory({
      userId,
      activityId: activity.id,
      newTerritoryId: territoryId,
    });

    // 5. Merge own territories that touch or overlap.
    // This merges territory boundary. It does not corrupt activity route.
    await prisma.$queryRaw`
      WITH touching AS (
        SELECT id
        FROM territories
        WHERE "userId" = ${userId}
          AND id != ${territoryId}
          AND boundary IS NOT NULL
          AND NOT ST_IsEmpty(boundary)
          AND (
            ST_Intersects(
              boundary,
              (SELECT boundary FROM territories WHERE id = ${territoryId})
            )
            OR ST_Touches(
              boundary,
              (SELECT boundary FROM territories WHERE id = ${territoryId})
            )
          )
      ),
      all_ids AS (
        SELECT ${territoryId}::text AS id
        UNION ALL
        SELECT id::text FROM touching
      ),
      merged AS (
        SELECT
          ST_MakeValid(ST_Union(t.boundary)) AS merged_boundary,
          ST_LineMerge(ST_Union(t."routeGeometry")) AS merged_route,
          COALESCE(${frontendAreaKm2}, ST_Area(ST_Union(t.boundary)::geography) / 1000000) AS merged_area
        FROM territories t
        WHERE t.id IN (SELECT id FROM all_ids)
          AND t.boundary IS NOT NULL
          AND NOT ST_IsEmpty(t.boundary)
      )
      UPDATE territories
      SET
        boundary = ST_Multi((SELECT merged_boundary FROM merged)),
        center = ST_PointOnSurface((SELECT merged_boundary FROM merged)),
        "routeGeometry" = (SELECT merged_route FROM merged),
        "areaKm2" = (SELECT merged_area FROM merged),
        "updatedAt" = NOW()
      WHERE id = ${territoryId}
      RETURNING id;
    `;

    // 6. Delete old own territories that were merged into the new one.
    await prisma.$executeRaw`
      DELETE FROM territories
      WHERE "userId" = ${userId}
        AND id != ${territoryId}
        AND (
          ST_Intersects(
            boundary,
            (SELECT boundary FROM territories WHERE id = ${territoryId})
          )
          OR ST_Touches(
            boundary,
            (SELECT boundary FROM territories WHERE id = ${territoryId})
          )
        );
    `;

    // 7. Fetch final territory.
    const finalTerritory = await prisma.$queryRaw`
      SELECT
        id,
        "userId",
        "activityId",
        "areaKm2",
        "capturedAt",
        "createdAt",
        "updatedAt",
        "routeEncoded",
        "routeSegmentsEncoded",
        ST_AsGeoJSON(boundary)::json AS boundary,
        ST_AsGeoJSON(center)::json AS center,
        ST_AsGeoJSON("routeGeometry")::json AS route
      FROM territories
      WHERE id = ${territoryId}
      LIMIT 1;
    `;

    const recentEvents = await prisma.territoryEvent.findMany({
      where: { activityId: activity.id },
      orderBy: { createdAt: 'desc' },
    });

    // XP
    const MIN_DISTANCE_KM = 0.1;
    const XP_PER_KM = 50;

    const xpEarned = distanceKm > 0 ? Math.round(distanceKm * XP_PER_KM) : 0;

    if (xpEarned > 0) {
      await addXP({
        userId,
        amount: xpEarned,
        type: 'ACTIVITY',
        description: `${mode} — ${distanceKm} km`,
        activityId: activity.id,
      });
    }

    await prisma.userProgress.upsert({
      where: { userId },
      create: {
        userId,
        totalDistanceKm: distanceKm,
        activitiesCount: distanceKm >= MIN_DISTANCE_KM ? 1 : 0,
      },
      update: {
        totalDistanceKm: { increment: distanceKm },
        activitiesCount:
          distanceKm >= MIN_DISTANCE_KM ? { increment: 1 } : undefined,
      },
    });

    const levelResult = await checkLevelUp(userId);
    const newBadges = await checkBadges(userId);

    const progress = await prisma.userProgress.findUnique({
      where: { userId },
    });

    return res.status(201).json({
      success: true,
      message: 'Activity completed successfully',
      activity,
      territory: finalTerritory[0] || null,
      captureEvents: recentEvents,
      progression: {
        xpEarned,
        leveledUp: levelResult?.leveledUp ?? false,
        level: levelResult?.level ?? progress?.level ?? 0,
        newBadges,
        progress: {
          currentXp: progress?.currentXp,
          totalXp: progress?.totalXp,
          xpToNextLevel: progress?.xpToNextLevel,
          level: progress?.level,
          totalDistanceKm: progress?.totalDistanceKm,
          activitiesCount: progress?.activitiesCount,
        },
      },
    });
  } catch (error) {
    console.error('FINISH_ACTIVITY ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ─────────────────────────────────────────────
// Get Activity Detail
// GET /api/activities/:id
// ─────────────────────────────────────────────

export const getActivityDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const activity = await prisma.activity.findUnique({
      where: { id },
    });

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found',
      });
    }

    if (activity.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden',
      });
    }

    const territoryRows = await prisma.$queryRaw`
      SELECT
        t.id,
        t."userId",
        t."activityId",
        t.name,
        t."areaKm2",
        t."capturedAt",
        t."createdAt",
        t."updatedAt",
        t."routeEncoded",
        t."routeSegmentsEncoded",
        ST_AsGeoJSON(t.boundary)::json AS boundary,
        ST_AsGeoJSON(t.center)::json AS center,
        u.username,
        u.full_name AS "fullName"
      FROM territories t
      JOIN users u ON u.id = t."userId"
      ORDER BY t."capturedAt" DESC;
    `;

    const territories = territoryRows.map((t) => ({
      id: t.id,
      userId: t.userId,
      activityId: t.activityId,
      name: t.name,
      owner: {
        username: t.username,
        fullName: t.fullName,
      },
      areaKm2: Number(t.areaKm2),
      capturedAt: t.capturedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      geojson: t.boundary,
      center: t.center,
      routeEncoded: t.routeEncoded,
      routeSegmentsEncoded: t.routeSegmentsEncoded ?? [],
    }));

    return res.status(200).json({
      success: true,
      data: {
        id: activity.id,
        mode: activity.mode,
        startedAt: activity.startedAt,
        endedAt: activity.endedAt,
        durationSec: activity.durationSec,
        elapsedTime: activity.elapsedTime,
        movingTime: activity.movingTime,
        stopTime: activity.stopTime,
        distanceKm: activity.distanceKm,
        avgPace: activity.avgPace,
        avgPaceFormatted: formatPace(activity.avgPace),
        topPace: activity.topPace,
        topPaceFormatted: formatPace(activity.topPace),
        avgSpeed: activity.avgSpeed,
        topSpeed: activity.topSpeed,
        calories: activity.calories,
        elevationGain: activity.elevationGain,
        kmSplits: activity.kmSplits ?? [],

        // Original activity route.
        // This is never clipped/subtracted.
        routeEncoded: activity.routeEncoded,

        // Territory result routes.
        territories,
      },
    });
  } catch (error) {
    console.error('GET_ACTIVITY_DETAIL ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};



// ─────────────────────────────────────────────
// Get My Total Stats
// GET /api/activities/stats/total
// ─────────────────────────────────────────────

export const getMyTotalStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const activityStats = await prisma.activity.aggregate({
      where: { userId },
      _count: { id: true },
      _sum: {
        distanceKm: true,
        durationSec: true,
        movingTime: true,
        stopTime: true,
        calories: true,
        elevationGain: true,
      },
      _avg: {
        avgPace: true,
        avgSpeed: true,
      },
      _max: {
        topSpeed: true,
      },
    });

    const territoryStats = await prisma.territory.aggregate({
      where: { userId },
      _count: { id: true },
      _sum: {
        areaKm2: true,
      },
    });

    return res.status(200).json({
      success: true,
      stats: {
        totalActivities: activityStats._count.id,

        totalDistanceKm: Number(activityStats._sum.distanceKm ?? 0),
        totalDurationSec: Number(activityStats._sum.durationSec ?? 0),
        totalMovingTimeSec: Number(activityStats._sum.movingTime ?? 0),
        totalStopTimeSec: Number(activityStats._sum.stopTime ?? 0),

        totalCalories: Number(activityStats._sum.calories ?? 0),
        totalElevationGain: Number(activityStats._sum.elevationGain ?? 0),

        averagePace: activityStats._avg.avgPace,
        averagePaceFormatted: formatPace(activityStats._avg.avgPace),

        averageSpeed: activityStats._avg.avgSpeed,
        topSpeed: activityStats._max.topSpeed,

        totalTerritories: territoryStats._count.id,
        totalAreaKm2: Number(territoryStats._sum.areaKm2 ?? 0),
      },
    });
  } catch (error) {
    console.error("GET_MY_TOTAL_STATS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch total stats",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Get Today's Total Stats
// GET /api/activities/stats/today
// ─────────────────────────────────────────────

export const getTodayStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const activityStats = await prisma.activity.aggregate({
      where: {
        userId,

        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },

      _count: {
        id: true,
      },

      _sum: {
        distanceKm: true,
        durationSec: true,
        movingTime: true,
        stopTime: true,
        calories: true,
        elevationGain: true,
      },

      _avg: {
        avgPace: true,
        avgSpeed: true,
      },

      _max: {
        topSpeed: true,
      },
    });

    const territoryStats = await prisma.territory.aggregate({
      where: {
        userId,

        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },

      _count: {
        id: true,
      },

      _sum: {
        areaKm2: true,
      },
    });

    return res.status(200).json({
      success: true,

      date: startOfDay,

      stats: {

        totalActivities:
          activityStats._count.id,

        totalDistanceKm:
          Number(activityStats._sum.distanceKm ?? 0),

        totalDurationSec:
          Number(activityStats._sum.durationSec ?? 0),

        totalMovingTimeSec:
          Number(activityStats._sum.movingTime ?? 0),

        totalStopTimeSec:
          Number(activityStats._sum.stopTime ?? 0),

        totalCalories:
          Number(activityStats._sum.calories ?? 0),

        totalElevationGain:
          Number(activityStats._sum.elevationGain ?? 0),

        averagePace:
          activityStats._avg.avgPace,

        averagePaceFormatted:
          formatPace(activityStats._avg.avgPace),

        averageSpeed:
          activityStats._avg.avgSpeed,

        topSpeed:
          activityStats._max.topSpeed,

        totalTerritories:
          territoryStats._count.id,

        totalAreaKm2:
          Number(territoryStats._sum.areaKm2 ?? 0),
      },
    });

  } catch (error) {

    console.error(
      "GET_TODAY_STATS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch today's stats",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });

  }
};



// ─────────────────────────────────────────────
// Get My Today's Activities
// GET /api/activities/my/today
// ─────────────────────────────────────────────

export const getMyTodayActivities = async (req, res) => {
  try {

    const userId = req.user.id;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const activities = await prisma.activity.findMany({
      where: {
        userId,

        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },

      orderBy: {
        startedAt: 'desc',
      },

      include: {
        territories: true,

        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,

      date: startOfDay,

      count: activities.length,

      activities,
    });

  } catch (error) {

    console.error(
      'GET_MY_TODAY_ACTIVITIES ERROR:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch today activities',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined,
    });

  }
};


// ─────────────────────────────────────────────
// Get My Friends Activities With Stats + Route
// GET /api/activities/friends
// ─────────────────────────────────────────────
export const getMyFriendsActivities = async (req, res) => {
  try {
    const userId = req.user.id;

    const friendships = await prisma.friendship.findMany({
      where: { userId },
      select: { friendId: true },
    });

    const friendIds = friendships.map((f) => f.friendId);

    if (friendIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        activities: [],
      });
    }

    const activities = await prisma.activity.findMany({
      where: {
        userId: {
          in: friendIds,
        },
      },
      orderBy: {
        startedAt: "desc",
      },
      take: 30,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
        territories: {
          select: {
            id: true,
            areaKm2: true,
            routeEncoded: true,
            routeSegmentsEncoded: true,
            capturedAt: true,
          },
        },
      },
    });

    const formatted = activities.map((activity) => {
      const totalAreaKm2 = activity.territories.reduce(
        (sum, t) => sum + Number(t.areaKm2 ?? 0),
        0
      );

      return {
        id: activity.id,

        friend: activity.user,

        stats: {
          mode: activity.mode,
          distanceKm: Number(activity.distanceKm ?? 0),
          durationSec: activity.durationSec,
          movingTime: activity.movingTime,
          stopTime: activity.stopTime,
          avgPace: activity.avgPace,
          avgPaceFormatted: formatPace(activity.avgPace),
          avgSpeed: activity.avgSpeed,
          topSpeed: activity.topSpeed,
          calories: activity.calories,
          elevationGain: activity.elevationGain,
          totalAreaKm2,
          territoriesCaptured: activity.territories.length,
        },

        map: {
          routeEncoded: activity.routeEncoded,
          territoryRoutes: activity.territories.map((t) => ({
            territoryId: t.id,
            areaKm2: Number(t.areaKm2 ?? 0),
            routeEncoded: t.routeEncoded,
            routeSegmentsEncoded: t.routeSegmentsEncoded ?? [],
            capturedAt: t.capturedAt,
          })),
        },

        startedAt: activity.startedAt,
        endedAt: activity.endedAt,
        createdAt: activity.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      count: formatted.length,
      activities: formatted,
    });
  } catch (error) {
    console.error("GET_MY_FRIENDS_ACTIVITIES_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch friends activities",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};