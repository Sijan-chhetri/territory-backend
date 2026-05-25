// activity.controller.js

const prisma = require('../../config/prisma');

const territoryController = require('./territory.controller');


// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Format sec/km → "m:ss/km" string */
function formatPace(secPerKm) {
  if (secPerKm == null) return null;
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60).toString().padStart(2, '0');
  return `${mins}:${secs}/km`;
}

/**
 * Compute per-km splits from GPS coordinates + timestamps.
 *
 * Each coordinate must have: { lat, lng, timestamp } (Unix ms or ISO string)
 *
 * Returns: [{ km, timeSec, pace, paceFormatted }]
 *   km            — split number (1 = first km, 2 = second km, …)
 *   timeSec       — seconds taken for that km
 *   pace          — sec/km for that split
 *   paceFormatted — "m:ss/km"
 */
function computeKmSplits(coordinates) {
  if (!coordinates || coordinates.length < 2) return [];

  const toRad = (deg) => (deg * Math.PI) / 180;

  // Haversine distance in km between two points
  function haversine(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(h));
  }
  

  const splits = [];
  let kmCount = 0;
  let accDist = 0;
  let kmStartTime = new Date(coordinates[0].timestamp).getTime();

  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    const segDist = haversine(prev, curr);
    accDist += segDist;

    // crossed a km boundary
    while (accDist >= 1) {
      kmCount++;
      const kmEndTime = new Date(curr.timestamp).getTime();
      const timeSec = Math.round((kmEndTime - kmStartTime) / 1000);
      const pace = timeSec; // sec/km for this split

      splits.push({
        km:           kmCount,
        timeSec,
        pace,
        paceFormatted: formatPace(pace),
      });

      kmStartTime = kmEndTime;
      accDist -= 1;
    }
  }

  return splits;
}


// ─────────────────────────────────────────────
// Get My Activities
// GET /api/activities/my
// ─────────────────────────────────────────────
// exports.getMyActivities = async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const activities = await prisma.activity.findMany({
//       where: { userId },
//       orderBy: { createdAt: 'desc' },
//     });

//     return res.status(200).json({ success: true, data: activities });

//   } catch (error) {
//     console.error(error);
//     return res.status(500).json({ success: false, message: 'Failed to fetch activities' });
//   }
// };

exports.getMyActivities = async (req, res) => {
  try {
    const userId = req.user.id;

    const activities = await prisma.activity.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: {
        territories: true,
      },
    });

    return res.status(200).json({
      message: 'Activities loaded',
      activities,
    });
  } catch (error) {
    console.error('GET_MY_ACTIVITIES ERROR:', error);
    return res.status(500).json({
      message: 'Server error',
    });
  }
};

// ─────────────────────────────────────────────
// Finish Activity
// POST /api/activities/finish
// ─────────────────────────────────────────────
exports.finishActivity = async (req, res) => {
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

      // [{ lat, lng, timestamp }]
      coordinates,

      // optional device splits
      kmSplits: clientKmSplits,

    } = req.body;

    // ─────────────────────────────────────────
    // Validation
    // ─────────────────────────────────────────

    if (!coordinates || coordinates.length < 2) {
      return res.status(400).json({
        message: 'Not enough GPS points',
      });
    }

    // ─────────────────────────────────────────
    // Splits
    // ─────────────────────────────────────────

    const kmSplits =
      (clientKmSplits && clientKmSplits.length > 0)
        ? clientKmSplits
        : computeKmSplits(coordinates);

    // ─────────────────────────────────────────
    // Build LINESTRING
    // ─────────────────────────────────────────

    const lineString = coordinates
      .map((p) => `${p.lng} ${p.lat}`)
      .join(',');

    const routeWKT = `LINESTRING(${lineString})`;

    // ─────────────────────────────────────────
    // Save Activity
    // ─────────────────────────────────────────

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

        routeEncoded,

        kmSplits,
      },
    });

    // ─────────────────────────────────────────
    // Create Territory
    // ─────────────────────────────────────────

    const territoryResult = await prisma.$queryRawUnsafe(`
      WITH new_route AS (
        SELECT ST_GeomFromText('${routeWKT}', 4326) AS route
      ),

      new_area AS (
        SELECT ST_Buffer(route::geography, 20)::geometry AS territory
        FROM new_route
      )

      INSERT INTO territories (
        id,
        "userId",
        "activityId",
        boundary,
        "areaKm2",
        "capturedAt",
        "createdAt",
        "updatedAt"
      )

      SELECT
        gen_random_uuid(),

        '${userId}',

        '${activity.id}',

        territory,

        ST_Area(territory::geography) / 1000000,

        NOW(),
        NOW(),
        NOW()

      FROM new_area

      RETURNING id;
    `);

    const territoryId = territoryResult[0].id;

    // ─────────────────────────────────────────
    // Capture Enemy Territories
    // ─────────────────────────────────────────

    await territoryController.captureTerritory({
      userId,
      activityId: activity.id,
      newTerritoryId: territoryId,
    });

    // ─────────────────────────────────────────
    // Merge Own Territories
    // ─────────────────────────────────────────

    await prisma.$executeRawUnsafe(`
      WITH merged AS (

        SELECT
          ST_Union(boundary) AS merged_boundary

        FROM territories

        WHERE "userId" = '${userId}'
      )

      UPDATE territories

      SET
        boundary = (
          SELECT merged_boundary
          FROM merged
        ),

        "areaKm2" = (
          SELECT
            ST_Area(
              merged_boundary::geography
            ) / 1000000
          FROM merged
        ),

        "updatedAt" = NOW()

      WHERE "userId" = '${userId}';
    `);

    // ─────────────────────────────────────────
    // Delete duplicate territories
    // keep newest only
    // ─────────────────────────────────────────

    await prisma.$executeRawUnsafe(`
      DELETE FROM territories

      WHERE id NOT IN (

        SELECT DISTINCT ON ("userId")
          id

        FROM territories

        WHERE "userId" = '${userId}'

        ORDER BY "userId", "createdAt" DESC
      )

      AND "userId" = '${userId}';
    `);

    // ─────────────────────────────────────────
    // Get Updated Territory
    // ─────────────────────────────────────────

    const finalTerritory = await prisma.$queryRawUnsafe(`
      SELECT
        id,
        "userId",
        "activityId",
        "areaKm2",
        "capturedAt",
        "createdAt",
        "updatedAt",

        ST_AsGeoJSON(boundary)::json AS boundary

      FROM territories

      WHERE id = '${territoryId}'

      LIMIT 1;
    `);

    // ─────────────────────────────────────────
    // Recent Capture Events
    // ─────────────────────────────────────────

    const recentEvents = await prisma.territoryEvent.findMany({
      where: {
        activityId: activity.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // ─────────────────────────────────────────
    // Response
    // ─────────────────────────────────────────

    return res.status(201).json({

      success: true,

      message: 'Activity completed successfully',

      activity,

      territory: finalTerritory[0] || null,

      captureEvents: recentEvents,
    });

  } catch (error) {

    console.error('FINISH_ACTIVITY ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Get Activity Detail (map + stats)
// GET /api/activities/:id
// ─────────────────────────────────────────────
exports.getActivityDetail = async (req, res) => {
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

    // Get ALL territories from ALL users
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
        ST_AsGeoJSON(t.boundary)::json AS boundary,
        ST_AsGeoJSON(t.center)::json AS center,
        u.username,
        u."fullName"
      FROM territories t
      JOIN users u ON u.id = t."userId"
      ORDER BY t."capturedAt" DESC;
    `;

    const territories = territoryRows.map((territory) => ({
      id: territory.id,
      userId: territory.userId,
      activityId: territory.activityId,
      name: territory.name,

      owner: {
        username: territory.username,
        fullName: territory.fullName,
      },

      areaKm2: territory.areaKm2,
      capturedAt: territory.capturedAt,
      createdAt: territory.createdAt,
      updatedAt: territory.updatedAt,

      geojson: territory.boundary,
      center: territory.center,
    }));

    return res.status(200).json({
      success: true,
      data: {
        // ── Identity
        id: activity.id,
        mode: activity.mode,

        // ── Timing
        startedAt: activity.startedAt,
        endedAt: activity.endedAt,
        durationSec: activity.durationSec,
        elapsedTime: activity.elapsedTime,
        movingTime: activity.movingTime,
        stopTime: activity.stopTime,

        // ── Distance
        distanceKm: activity.distanceKm,

        // ── Pace
        avgPace: activity.avgPace,
        avgPaceFormatted: formatPace(activity.avgPace),
        topPace: activity.topPace,
        topPaceFormatted: formatPace(activity.topPace),

        // ── Speed
        avgSpeed: activity.avgSpeed,
        topSpeed: activity.topSpeed,

        // ── Effort
        calories: activity.calories,
        elevationGain: activity.elevationGain,

        // ── Splits
        kmSplits: activity.kmSplits ?? [],

        // ── Map data
        routeEncoded: activity.routeEncoded,

        // All territories from all users
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




// Remove getAllTerritories from here — it lives in territory.controller.js