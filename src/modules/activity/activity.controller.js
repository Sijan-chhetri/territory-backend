// activity.controller.js

const prisma = require('../../config/prisma');


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
exports.getMyActivities = async (req, res) => {
  try {
    const userId = req.user.id;

    const activities = await prisma.activity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: activities });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Failed to fetch activities' });
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
      // [{ lat, lng, timestamp }]  — timestamp required for splits
      coordinates,
      // optional: pre-computed splits from device
      // [{ km, timeSec, pace, paceFormatted }]
      kmSplits: clientKmSplits,
    } = req.body;

    if (!coordinates || coordinates.length < 3) {
      return res.status(400).json({ message: 'Not enough GPS points' });
    }

    // ── Use device splits if provided, otherwise compute server-side
    const kmSplits = (clientKmSplits && clientKmSplits.length > 0)
      ? clientKmSplits
      : computeKmSplits(coordinates);

    // ── Build LINESTRING
    const lineString = coordinates.map((p) => `${p.lng} ${p.lat}`).join(',');
    const routeWKT = `LINESTRING(${lineString})`;

    // ── Save activity
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
        startedAt:  new Date(startedAt),
        endedAt:    new Date(endedAt),
        routeEncoded,
        kmSplits,
      },
    });

    // ── Create buffered territory (20 m around path)
    await prisma.$queryRawUnsafe(`
      WITH new_route AS (
        SELECT ST_GeomFromText('${routeWKT}', 4326) AS route
      ),
      new_area AS (
        SELECT ST_Buffer(route::geography, 20)::geometry AS territory
        FROM new_route
      )
      INSERT INTO territories (
        id, "userId", "activityId", boundary, "areaKm2", "capturedAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        '${userId}',
        '${activity.id}',
        territory,
        ST_Area(territory::geography) / 1000000,
        NOW(),
        NOW()
      FROM new_area
      RETURNING id;
    `);

    // ── Merge overlapping territories for this user
    await prisma.$executeRawUnsafe(`
      UPDATE territories t
      SET
        boundary  = merged.new_boundary,
        "areaKm2" = merged.new_area,
        "updatedAt" = NOW()
      FROM (
        SELECT
          t1.id,
          ST_Union(t1.boundary::geometry, t2.boundary::geometry) AS new_boundary,
          ST_Area(
            ST_Union(t1.boundary::geometry, t2.boundary::geometry)::geography
          ) / 1000000 AS new_area
        FROM territories t1
        JOIN territories t2
          ON  t1."userId" = t2."userId"
          AND t1.id != t2.id
        WHERE
          t1."userId" = '${userId}'
          AND ST_Intersects(t1.boundary, t2.boundary)
      ) merged
      WHERE t.id = merged.id;
    `);

    // ── Find enemy territories that overlap the new one
    const enemies = await prisma.$queryRawUnsafe(`
      WITH current_territory AS (
        SELECT boundary FROM territories
        WHERE "activityId" = '${activity.id}'
        LIMIT 1
      )
      SELECT id, "userId"
      FROM territories
      WHERE
        "userId" != '${userId}'
        AND ST_Intersects(boundary, (SELECT boundary FROM current_territory));
    `);

    return res.status(201).json({
      message: 'Activity completed',
      activity,
      enemyTerritories: enemies,
    });

  } catch (error) {
    console.error('FINISH_ACTIVITY ERROR:', error);
    return res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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

    const activity = await prisma.activity.findUnique({ where: { id } });

    if (!activity) {
      return res.status(404).json({ success: false, message: 'Activity not found' });
    }

    if (activity.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    // ── Territory as GeoJSON for map overlay
    const territoryRows = await prisma.$queryRawUnsafe(`
      SELECT
        id,
        "areaKm2",
        "capturedAt",
        ST_AsGeoJSON(boundary)::json AS boundary
      FROM territories
      WHERE "activityId" = '${id}'
      LIMIT 1;
    `);

    const territory = territoryRows[0] ?? null;

    return res.status(200).json({
      success: true,
      data: {
        // ── Identity
        id:                   activity.id,
        mode:                 activity.mode,

        // ── Timing
        startedAt:            activity.startedAt,
        endedAt:              activity.endedAt,
        durationSec:          activity.durationSec,
        elapsedTime:          activity.elapsedTime,
        movingTime:           activity.movingTime,
        stopTime:             activity.stopTime,

        // ── Distance
        distanceKm:           activity.distanceKm,

        // ── Pace
        avgPace:              activity.avgPace,
        avgPaceFormatted:     formatPace(activity.avgPace),
        topPace:              activity.topPace,
        topPaceFormatted:     formatPace(activity.topPace),

        // ── Speed (km/h)
        avgSpeed:             activity.avgSpeed,
        topSpeed:             activity.topSpeed,

        // ── Effort
        calories:             activity.calories,
        elevationGain:        activity.elevationGain,

        // ── Per-km splits [{ km, timeSec, pace, paceFormatted }]
        kmSplits:             activity.kmSplits ?? [],

        // ── Map data
        routeEncoded:         activity.routeEncoded,
        territory: territory ? {
          id:         territory.id,
          areaKm2:    territory.areaKm2,
          capturedAt: territory.capturedAt,
          geojson:    territory.boundary,
        } : null,
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
