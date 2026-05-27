import prisma from '../../config/prisma.js';
import polylineLib from '@mapbox/polyline';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function roundCoord(n) {
  return parseFloat(Number(n).toFixed(5));
}

function encodeLineString(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;

  const points = coords
    .map(([lng, lat]) => [roundCoord(lat), roundCoord(lng)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

  const deduped = points.filter(
    (pt, i) =>
      i === 0 ||
      pt[0] !== points[i - 1][0] ||
      pt[1] !== points[i - 1][1]
  );

  if (deduped.length < 2) return null;

  return polylineLib.encode(deduped);
}

function encodeRouteSegmentsFromGeoJson(geojson) {
  if (!geojson) {
    return {
      main: null,
      segments: [],
    };
  }

  if (geojson.type === 'LineString') {
    const encoded = encodeLineString(geojson.coordinates);

    return {
      main: encoded,
      segments: encoded ? [encoded] : [],
    };
  }

  if (geojson.type === 'MultiLineString') {
    const segments = geojson.coordinates
      .map((segment) => encodeLineString(segment))
      .filter(Boolean);

    if (segments.length === 0) {
      return {
        main: null,
        segments: [],
      };
    }

    // Choose longest encoded segment as routeEncoded.
    // Keep all segments in routeSegmentsEncoded.
    const main = [...segments].sort((a, b) => b.length - a.length)[0];

    return {
      main,
      segments,
    };
  }

  return {
    main: null,
    segments: [],
  };
}

async function updateRouteEncodedFromGeometry(territoryId) {
  const rows = await prisma.$queryRaw`
    SELECT ST_AsGeoJSON("routeGeometry")::json AS route
    FROM territories
    WHERE id = ${territoryId}
      AND "routeGeometry" IS NOT NULL
    LIMIT 1;
  `;

  const routeGeoJson = rows[0]?.route;

  const { main, segments } = encodeRouteSegmentsFromGeoJson(routeGeoJson);

  await prisma.$executeRaw`
    UPDATE territories
    SET
      "routeEncoded" = ${main},
      "routeSegmentsEncoded" = ${JSON.stringify(segments)}::jsonb,
      "updatedAt" = NOW()
    WHERE id = ${territoryId};
  `;

  return {
    routeEncoded: main,
    routeSegmentsEncoded: segments,
  };
}

// ─────────────────────────────────────────────
// Capture Territory
//
// Rule:
// Activity route stays full/original.
// Territory boundary is subtracted.
// Territory routeGeometry is clipped.
// routeSegmentsEncoded stores all resulting route parts.
// ─────────────────────────────────────────────

export const captureTerritory = async ({ userId, activityId, newTerritoryId }) => {
  // 1. Subtract all other users' existing territory boundaries
  // from the new territory boundary.
  const subtractionResult = await prisma.$queryRaw`
    WITH current_territory AS (
      SELECT
        id,
        boundary,
        "routeGeometry"
      FROM territories
      WHERE id = ${newTerritoryId}
      LIMIT 1
    ),
    enemy_union AS (
      SELECT ST_MakeValid(ST_Union(boundary)) AS boundary
      FROM territories
      WHERE "userId" != ${userId}
        AND id != ${newTerritoryId}
        AND boundary IS NOT NULL
        AND NOT ST_IsEmpty(boundary)
        AND ST_Intersects(
          boundary,
          (SELECT boundary FROM current_territory)
        )
    ),
    diffed AS (
      SELECT
        CASE
          WHEN enemy_union.boundary IS NULL THEN current_territory.boundary
          ELSE ST_Difference(
            current_territory.boundary,
            enemy_union.boundary
          )
        END AS new_boundary,
        CASE
          WHEN enemy_union.boundary IS NULL THEN current_territory."routeGeometry"
          ELSE ST_Difference(
            current_territory."routeGeometry",
            enemy_union.boundary
          )
        END AS new_route
      FROM current_territory
      LEFT JOIN enemy_union ON true
    ),
    cleaned AS (
      SELECT
        ST_Multi(
          ST_CollectionExtract(
            ST_MakeValid(new_boundary),
            3
          )
        ) AS boundary,
        ST_CollectionExtract(
          ST_MakeValid(new_route),
          2
        ) AS route
      FROM diffed
      WHERE new_boundary IS NOT NULL
        AND NOT ST_IsEmpty(new_boundary)
    ),
    updated AS (
      UPDATE territories
      SET
        boundary = cleaned.boundary,
        center = ST_PointOnSurface(cleaned.boundary),
        "routeGeometry" = cleaned.route,
        "areaKm2" = ST_Area(cleaned.boundary::geography) / 1000000,
        "updatedAt" = NOW()
      FROM cleaned
      WHERE territories.id = ${newTerritoryId}
        AND cleaned.boundary IS NOT NULL
        AND NOT ST_IsEmpty(cleaned.boundary)
      RETURNING
        territories.id,
        territories."areaKm2"
    )
    SELECT * FROM updated;
  `;

  // If no remaining territory exists, delete the new territory.
  if (!subtractionResult || subtractionResult.length === 0) {
    await prisma.$executeRaw`
      DELETE FROM territories
      WHERE id = ${newTerritoryId};
    `;

    return {
      captured: false,
      areaKm2: 0,
    };
  }

  const finalAreaKm2 = Number(subtractionResult[0].areaKm2 || 0);

  if (finalAreaKm2 <= 0.000001) {
    await prisma.$executeRaw`
      DELETE FROM territories
      WHERE id = ${newTerritoryId};
    `;

    return {
      captured: false,
      areaKm2: 0,
    };
  }

  // 2. Update routeEncoded + routeSegmentsEncoded from clipped routeGeometry.
  await updateRouteEncodedFromGeometry(newTerritoryId);

  // 3. Record capture events for enemies that overlapped.
  const overlappedEnemies = await prisma.$queryRaw`
    WITH current_territory AS (
      SELECT boundary
      FROM territories
      WHERE id = ${newTerritoryId}
      LIMIT 1
    )
    SELECT
      t.id,
      t."userId",
      ST_Area(
        ST_Intersection(
          t.boundary,
          (SELECT boundary FROM current_territory)
        )::geography
      ) / 1000000 AS overlap_area
    FROM territories t
    WHERE t."userId" != ${userId}
      AND t.id != ${newTerritoryId}
      AND t.boundary IS NOT NULL
      AND NOT ST_IsEmpty(t.boundary)
      AND ST_Intersects(
        t.boundary,
        (SELECT boundary FROM current_territory)
      );
  `;

  for (const enemy of overlappedEnemies) {
    const affectedAreaKm2 = Number(enemy.overlap_area || 0);

    if (affectedAreaKm2 <= 0.000001) continue;

    await prisma.territoryEvent.create({
      data: {
        territoryId: newTerritoryId,
        userId,
        opponentUserId: enemy.userId,
        activityId,
        type: 'CAPTURE',
        affectedAreaKm2,
      },
    });
  }

  return {
    captured: true,
    areaKm2: finalAreaKm2,
  };
};

// ─────────────────────────────────────────────
// Color palette
// ─────────────────────────────────────────────

const TERRITORY_COLORS = [
  { fill: 'rgba(37,  99, 235, 0.38)', border: 'rgba(30,  64, 175, 1)' },
  { fill: 'rgba(22, 163,  74, 0.38)', border: 'rgba(21, 128,  61, 1)' },
  { fill: 'rgba(220,  38,  38, 0.38)', border: 'rgba(153,  27,  27, 1)' },
  { fill: 'rgba(147,  51, 234, 0.38)', border: 'rgba(107,  33, 168, 1)' },
  { fill: 'rgba(234,  88,  12, 0.38)', border: 'rgba(154,  52,  18, 1)' },
  { fill: 'rgba(219,  39, 119, 0.38)', border: 'rgba(157,  23,  77, 1)' },
  { fill: 'rgba(75,   85,  99, 0.38)', border: 'rgba(55,   65,  81, 1)' },
  { fill: 'rgba(202, 138,   4, 0.38)', border: 'rgba(133,  77,  14, 1)' },
];

// ─────────────────────────────────────────────
// Get All Territories
// GET /api/territories/all
// ─────────────────────────────────────────────

export const getAllTerritories = async (req, res) => {
  try {
    const territoryRows = await prisma.$queryRaw`
      WITH ranked AS (
        SELECT
          t.id,
          t."userId",
          t."activityId",
          t.name,
          t."areaKm2",
          t."capturedAt",
          t."createdAt",
          t."updatedAt",
          t.boundary,
          t.center,
          u.username,
          u.full_name AS "fullName",
          t."routeEncoded",
          t."routeSegmentsEncoded",
          ROW_NUMBER() OVER (ORDER BY t."updatedAt" DESC) AS rn
        FROM territories t
        JOIN users u ON u.id = t."userId"
        WHERE t.boundary IS NOT NULL
          AND NOT ST_IsEmpty(t.boundary)
      ),
      clipped AS (
        SELECT
          r.id,
          r."userId",
          r."activityId",
          r.name,
          r."areaKm2",
          r."capturedAt",
          r."createdAt",
          r."updatedAt",
          r.username,
          r."fullName",
          r."routeEncoded",
          r."routeSegmentsEncoded",
          COALESCE(
            (
              SELECT ST_Difference(
                r.boundary,
                ST_Union(newer.boundary)
              )
              FROM ranked newer
              WHERE newer.rn < r.rn
                AND ST_Intersects(r.boundary, newer.boundary)
            ),
            r.boundary
          ) AS clipped_boundary,
          ST_AsGeoJSON(r.center)::json AS center
        FROM ranked r
      )
      SELECT
        id,
        "userId",
        "activityId",
        name,
        "areaKm2",
        "capturedAt",
        "createdAt",
        "updatedAt",
        username,
        "fullName",
        "routeEncoded",
        "routeSegmentsEncoded",
        center,
        ST_AsGeoJSON(clipped_boundary)::json AS boundary
      FROM clipped
      WHERE clipped_boundary IS NOT NULL
        AND NOT ST_IsEmpty(clipped_boundary)
      ORDER BY "updatedAt" DESC;
    `;

    const seenUsers = [];

    for (const t of territoryRows) {
      if (!seenUsers.includes(t.userId)) {
        seenUsers.push(t.userId);
      }
    }

    const userColorMap = Object.fromEntries(
      seenUsers.map((userId, index) => [
        userId,
        TERRITORY_COLORS[Math.min(index, TERRITORY_COLORS.length - 1)],
      ])
    );

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
      color:
        userColorMap[t.userId] ??
        TERRITORY_COLORS[TERRITORY_COLORS.length - 1],
    }));

    return res.status(200).json({
      success: true,
      count: territories.length,
      territories,
    });
  } catch (error) {
    console.error('GET_ALL_TERRITORIES ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch territories',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ─────────────────────────────────────────────
// Update Territory Route
// PUT /api/territories/:id/route
// ─────────────────────────────────────────────

export const updateTerritoryRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { routeEncoded, routeSegmentsEncoded } = req.body;

    const territory = await prisma.territory.findUnique({
      where: { id },
    });

    if (!territory) {
      return res.status(404).json({
        success: false,
        message: 'Territory not found',
      });
    }

    if (territory.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden',
      });
    }

    let segments = [];

    if (Array.isArray(routeSegmentsEncoded) && routeSegmentsEncoded.length > 0) {
      segments = routeSegmentsEncoded.filter(
        (segment) => typeof segment === 'string' && segment.trim().length > 0
      );
    } else if (routeEncoded) {
      segments = [routeEncoded];
    }

    if (segments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'routeEncoded or routeSegmentsEncoded is required',
      });
    }

    const lineGeoJsonSegments = [];

    for (const segment of segments) {
      let decoded;

      try {
        decoded = polylineLib.decode(segment);
      } catch {
        continue;
      }

      if (!decoded || decoded.length < 2) continue;

      const coordinates = decoded
        .map(([lat, lng]) => [Number(lng), Number(lat)])
        .filter(
          ([lng, lat]) =>
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            lat >= -90 &&
            lat <= 90 &&
            lng >= -180 &&
            lng <= 180
        );

      if (coordinates.length >= 2) {
        lineGeoJsonSegments.push(coordinates);
      }
    }

    if (lineGeoJsonSegments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid route segments found',
      });
    }

    const routeGeoJson =
      lineGeoJsonSegments.length === 1
        ? {
            type: 'LineString',
            coordinates: lineGeoJsonSegments[0],
          }
        : {
            type: 'MultiLineString',
            coordinates: lineGeoJsonSegments,
          };

    const routeGeoJsonString = JSON.stringify(routeGeoJson);
    const mainRouteEncoded =
      routeEncoded || [...segments].sort((a, b) => b.length - a.length)[0];

    await prisma.$executeRaw`
      UPDATE territories
      SET
        "routeEncoded" = ${mainRouteEncoded},
        "routeSegmentsEncoded" = ${JSON.stringify(segments)}::jsonb,
        "routeGeometry" = ST_SetSRID(
          ST_GeomFromGeoJSON(${routeGeoJsonString}),
          4326
        ),
        "updatedAt" = NOW()
      WHERE id = ${id};
    `;

    const updated = await prisma.$queryRaw`
      SELECT
        id,
        "userId",
        "activityId",
        "areaKm2",
        "capturedAt",
        "updatedAt",
        "routeEncoded",
        "routeSegmentsEncoded",
        ST_AsGeoJSON(boundary)::json AS boundary,
        ST_AsGeoJSON("routeGeometry")::json AS route
      FROM territories
      WHERE id = ${id}
      LIMIT 1;
    `;

    return res.status(200).json({
      success: true,
      territory: updated[0],
    });
  } catch (error) {
    console.error('UPDATE_TERRITORY_ROUTE ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ─────────────────────────────────────────────
// Get Territory Events
// GET /api/territories/events
// ─────────────────────────────────────────────

export const getTerritoryEvents = async (req, res) => {
  try {
    const events = await prisma.territoryEvent.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.status(200).json({
      success: true,
      events,
    });
  } catch (error) {
    console.error('GET_TERRITORY_EVENTS ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
    });
  }
};