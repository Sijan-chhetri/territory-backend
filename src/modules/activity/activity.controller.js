// activity.controller.js

const prisma = require('../../config/prisma');



exports.getMyActivities = async (req, res) => {
  try {
    const userId = req.user.id;

    const activities = await prisma.activity.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.status(200).json({
      success: true,
      data: activities,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch activities',
    });
  }
};


// src/modules/activity/activity.controller.js

exports.finishActivity = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      mode,
      distanceKm,
      durationSec,
      avgPace,
      calories,
      elevationGain,
      startedAt,
      endedAt,
      routeEncoded,

      // array of GPS points
      // [{ lat: 27.7, lng: 85.3 }]
      coordinates
    } = req.body;

    if (!coordinates || coordinates.length < 3) {
      return res.status(400).json({
        message: 'Not enough GPS points'
      });
    }

    /*
      CREATE LINESTRING
      LINESTRING(lng lat, lng lat)
    */
    const lineString = coordinates
      .map((p) => `${p.lng} ${p.lat}`)
      .join(',');

    const routeWKT = `LINESTRING(${lineString})`;

    /*
      SAVE ACTIVITY
    */
    const activity = await prisma.activity.create({
      data: {
        userId,
        mode,
        distanceKm,
        durationSec,
        avgPace,
        calories,
        elevationGain,
        startedAt: new Date(startedAt),
        endedAt: new Date(endedAt),
        routeEncoded
      }
    });

    /*
      CREATE BUFFERED TERRITORY — 20 meters around path
    */
    await prisma.$queryRawUnsafe(`
      WITH new_route AS (
        SELECT ST_GeomFromText('${routeWKT}', 4326) AS route
      ),
      new_area AS (
        SELECT
          ST_Buffer(route::geography, 20)::geometry AS territory
        FROM new_route
      )
      INSERT INTO territories (
        id,
        "userId",
        "activityId",
        boundary,
        "areaKm2",
        "capturedAt",
        "updatedAt"
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

    /*
      MERGE OVERLAPPING TERRITORIES FOR THIS USER
      ST_Union result stored as generic geometry — handles both Polygon and MultiPolygon
    */
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

    /*
      FIND ENEMY TERRITORIES
    */
    const enemies = await prisma.$queryRawUnsafe(`
      WITH current_territory AS (
        SELECT boundary
        FROM territories
        WHERE "activityId" = '${activity.id}'
        LIMIT 1
      )
      SELECT id, "userId"
      FROM territories
      WHERE
        "userId" != '${userId}'
        AND ST_Intersects(
          boundary,
          (SELECT boundary FROM current_territory)
        );
    `);

    return res.status(201).json({
      message: 'Activity completed',
      activity,
      enemyTerritories: enemies
    });

  } catch (error) {
    console.error('FINISH_ACTIVITY ERROR:', error);

    return res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

    // ── Fetch activity
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

    // ── Fetch territory boundary as GeoJSON for map rendering
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

    // ── Format pace as mm:ss string helper
    const formatPace = (secPerKm) => {
      if (secPerKm == null) return null;
      const mins = Math.floor(secPerKm / 60);
      const secs = Math.round(secPerKm % 60).toString().padStart(2, '0');
      return `${mins}:${secs}/km`;
    };

    return res.status(200).json({
      success: true,
      data: {
        // ── Identity
        id:             activity.id,
        mode:           activity.mode,

        // ── Timing
        startedAt:      activity.startedAt,
        endedAt:        activity.endedAt,
        durationSec:    activity.durationSec,
        elapsedTime:    activity.elapsedTime,
        movingTime:     activity.movingTime,
        stopTime:       activity.stopTime,

        // ── Distance
        distanceKm:     activity.distanceKm,

        // ── Pace (sec/km + human-readable)
        avgPace:        activity.avgPace,
        avgPaceFormatted: formatPace(activity.avgPace),
        topPace:        activity.topPace,
        topPaceFormatted: formatPace(activity.topPace),

        // ── Speed (km/h)
        avgSpeed:       activity.avgSpeed,
        topSpeed:       activity.topSpeed,

        // ── Effort
        calories:       activity.calories,
        elevationGain:  activity.elevationGain,

        // ── Map data
        routeEncoded:   activity.routeEncoded,   // polyline for map path
        territory: territory ? {
          id:         territory.id,
          areaKm2:    territory.areaKm2,
          capturedAt: territory.capturedAt,
          geojson:    territory.boundary,        // GeoJSON polygon for map overlay
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
