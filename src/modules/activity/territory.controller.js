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

// export const captureTerritory = async ({ userId, activityId, newTerritoryId }) => {
//   return await prisma.$transaction(async (tx) => {

//     console.log('\n===================================');
//     console.log('CAPTURE TERRITORY START');
//     console.log('userId:', userId);
//     console.log('activityId:', activityId);
//     console.log('newTerritoryId:', newTerritoryId);
//     console.log('===================================\n');


//     // 1. Find captured parts from enemy territories
//     const capturedParts = await tx.$queryRaw`
//       WITH current_territory AS (
//         SELECT
//           id,
//           boundary AS user_movement_boundary
//         FROM territories
//         WHERE id = ${newTerritoryId}
//         LIMIT 1
//       ),

//       captured_parts AS (
//         SELECT
//           enemy.id AS "enemyTerritoryId",
//           enemy."userId" AS "enemyUserId",

//           ST_Multi(
//             ST_CollectionExtract(
//               ST_MakeValid(
//                 ST_Intersection(
//                   enemy.boundary,
//                   current_territory.user_movement_boundary
//                 )
//               ),
//               3
//             )
//           ) AS captured_part

//         FROM territories enemy
//         CROSS JOIN current_territory
//         WHERE enemy."userId" != ${userId}
//           AND enemy.id != ${newTerritoryId}
//           AND enemy.boundary IS NOT NULL
//           AND NOT ST_IsEmpty(enemy.boundary)
//           AND ST_Intersects(
//             enemy.boundary,
//             current_territory.user_movement_boundary
//           )
//       ),

//       valid_captured_parts AS (
//         SELECT
//           "enemyTerritoryId",
//           "enemyUserId",
//           captured_part,
//           ST_Area(captured_part::geography) / 1000000 AS "capturedAreaKm2"
//         FROM captured_parts
//         WHERE captured_part IS NOT NULL
//           AND NOT ST_IsEmpty(captured_part)
//           AND ST_Area(captured_part::geography) > 1
//       )

//       SELECT
//         "enemyTerritoryId",
//         "enemyUserId",
//         "capturedAreaKm2"
//       FROM valid_captured_parts;
//     `;

//     // 2. Save capture events
//     for (const part of capturedParts) {
//       const affectedAreaKm2 = Number(part.capturedAreaKm2 || 0);

//       if (affectedAreaKm2 <= 0.000001) continue;

//       await tx.territoryEvent.create({
//         data: {
//           territoryId: newTerritoryId,
//           userId,
//           opponentUserId: part.enemyUserId,
//           activityId,
//           type: "CAPTURE",
//           affectedAreaKm2,
//         },
//       });
//     }

//     // 3. Remove captured parts from enemy territories
//     await tx.$executeRaw`
//       WITH current_territory AS (
//         SELECT
//           boundary AS user_movement_boundary
//         FROM territories
//         WHERE id = ${newTerritoryId}
//         LIMIT 1
//       ),

//       captured_parts AS (
//         SELECT
//           enemy.id AS enemy_territory_id,

//           ST_Multi(
//             ST_CollectionExtract(
//               ST_MakeValid(
//                 ST_Intersection(
//                   enemy.boundary,
//                   current_territory.user_movement_boundary
//                 )
//               ),
//               3
//             )
//           ) AS captured_part

//         FROM territories enemy
//         CROSS JOIN current_territory
//         WHERE enemy."userId" != ${userId}
//           AND enemy.id != ${newTerritoryId}
//           AND enemy.boundary IS NOT NULL
//           AND NOT ST_IsEmpty(enemy.boundary)
//           AND ST_Intersects(
//             enemy.boundary,
//             current_territory.user_movement_boundary
//           )
//       ),

//       updated_enemies AS (
//         UPDATE territories enemy
//         SET
//           boundary = ST_Multi(
//             ST_CollectionExtract(
//               ST_MakeValid(
//                 ST_Difference(
//                   enemy.boundary,
//                   captured_parts.captured_part
//                 )
//               ),
//               3
//             )
//           ),
//           "updatedAt" = NOW()
//         FROM captured_parts
//         WHERE enemy.id = captured_parts.enemy_territory_id
//           AND captured_parts.captured_part IS NOT NULL
//           AND NOT ST_IsEmpty(captured_parts.captured_part)
//         RETURNING enemy.id
//       )

//       SELECT * FROM updated_enemies;
//     `;

//     // 4. Recalculate enemy area and center
//     await tx.$executeRaw`
//       UPDATE territories
//       SET
//         "areaKm2" = ST_Area(boundary::geography) / 1000000,
//         center = ST_PointOnSurface(boundary),
//         "updatedAt" = NOW()
//       WHERE boundary IS NOT NULL
//         AND NOT ST_IsEmpty(boundary);
//     `;

//     // 5. Delete empty or tiny territories
//     await tx.$executeRaw`
//       DELETE FROM territories
//       WHERE boundary IS NULL
//          OR ST_IsEmpty(boundary)
//          OR ST_Area(boundary::geography) <= 1;
//     `;

//     // 6. Update new territory area and center
//     const updatedNewTerritory = await tx.$queryRaw`
//       UPDATE territories
//       SET
//         boundary = ST_Multi(
//           ST_CollectionExtract(
//             ST_MakeValid(boundary),
//             3
//           )
//         ),
//         center = ST_PointOnSurface(boundary),
//         "areaKm2" = ST_Area(boundary::geography) / 1000000,
//         "updatedAt" = NOW()
//       WHERE id = ${newTerritoryId}
//         AND boundary IS NOT NULL
//         AND NOT ST_IsEmpty(boundary)
//       RETURNING id, "areaKm2";
//     `;

//     if (!updatedNewTerritory || updatedNewTerritory.length === 0) {
//       return {
//         captured: false,
//         areaKm2: 0,
//         capturedCount: 0,
//       };
//     }

//     // 7. Update routeEncoded / routeSegmentsEncoded after geometry changes
//     await updateRouteEncodedFromGeometry(newTerritoryId);

//     return {
//       captured: capturedParts.length > 0,
//       areaKm2: Number(updatedNewTerritory[0].areaKm2 || 0),
//       capturedCount: capturedParts.length,
//     };
//   }

// );


// };



export const captureTerritory = async ({ userId, activityId, newTerritoryId }) => {
  const result = await prisma.$transaction(
    async (tx) => {
      console.log('\n===================================');
      console.log('CAPTURE TERRITORY START');
      console.log('userId:', userId);
      console.log('activityId:', activityId);
      console.log('newTerritoryId:', newTerritoryId);
      console.log('===================================\n');

      // 1. Find captured parts from enemy territories
      const capturedParts = await tx.$queryRaw`
        WITH current_territory AS (
          SELECT
            id,
            boundary AS user_movement_boundary
          FROM territories
          WHERE id = ${newTerritoryId}
          LIMIT 1
        ),

        captured_parts AS (
          SELECT
            enemy.id AS "enemyTerritoryId",
            enemy."userId" AS "enemyUserId",

            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(
                  ST_Intersection(
                    enemy.boundary,
                    current_territory.user_movement_boundary
                  )
                ),
                3
              )
            ) AS captured_part

          FROM territories enemy
          CROSS JOIN current_territory
          WHERE enemy."userId" != ${userId}
            AND enemy.id != ${newTerritoryId}
            AND enemy.boundary IS NOT NULL
            AND NOT ST_IsEmpty(enemy.boundary)
            AND ST_Intersects(
              enemy.boundary,
              current_territory.user_movement_boundary
            )
        ),

        valid_captured_parts AS (
          SELECT
            "enemyTerritoryId",
            "enemyUserId",
            captured_part,
            ST_Area(captured_part::geography) / 1000000 AS "capturedAreaKm2"
          FROM captured_parts
          WHERE captured_part IS NOT NULL
            AND NOT ST_IsEmpty(captured_part)
            AND ST_Area(captured_part::geography) > 1
        )

        SELECT
          "enemyTerritoryId",
          "enemyUserId",
          "capturedAreaKm2"
        FROM valid_captured_parts;
      `;

      // 2. Save capture events
      for (const part of capturedParts) {
        const affectedAreaKm2 = Number(part.capturedAreaKm2 || 0);

        if (affectedAreaKm2 <= 0.000001) continue;

        await tx.territoryEvent.create({
          data: {
            territoryId: newTerritoryId,
            userId,
            opponentUserId: part.enemyUserId,
            activityId,
            type: "CAPTURE",
            affectedAreaKm2,
          },
        });
      }

      // 3. Remove captured parts from enemy territories
      await tx.$executeRaw`
        WITH current_territory AS (
          SELECT
            boundary AS user_movement_boundary
          FROM territories
          WHERE id = ${newTerritoryId}
          LIMIT 1
        ),

        captured_parts AS (
          SELECT
            enemy.id AS enemy_territory_id,

            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(
                  ST_Intersection(
                    enemy.boundary,
                    current_territory.user_movement_boundary
                  )
                ),
                3
              )
            ) AS captured_part

          FROM territories enemy
          CROSS JOIN current_territory
          WHERE enemy."userId" != ${userId}
            AND enemy.id != ${newTerritoryId}
            AND enemy.boundary IS NOT NULL
            AND NOT ST_IsEmpty(enemy.boundary)
            AND ST_Intersects(
              enemy.boundary,
              current_territory.user_movement_boundary
            )
        ),

        updated_enemies AS (
          UPDATE territories enemy
          SET
            boundary = ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(
                  ST_Difference(
                    enemy.boundary,
                    captured_parts.captured_part
                  )
                ),
                3
              )
            ),
            "updatedAt" = NOW()
          FROM captured_parts
          WHERE enemy.id = captured_parts.enemy_territory_id
            AND captured_parts.captured_part IS NOT NULL
            AND NOT ST_IsEmpty(captured_parts.captured_part)
          RETURNING enemy.id
        )

        SELECT * FROM updated_enemies;
      `;

      // 4. Recalculate only affected enemy territories
      await tx.$executeRaw`
        UPDATE territories
        SET
          "areaKm2" = ST_Area(boundary::geography) / 1000000,
          center = ST_PointOnSurface(boundary),
          "updatedAt" = NOW()
        WHERE "userId" != ${userId}
          AND boundary IS NOT NULL
          AND NOT ST_IsEmpty(boundary)
          AND ST_Intersects(
            boundary,
            (
              SELECT boundary
              FROM territories
              WHERE id = ${newTerritoryId}
              LIMIT 1
            )
          );
      `;

      // 5. Delete empty or tiny territories
      await tx.$executeRaw`
        DELETE FROM territories
        WHERE boundary IS NULL
           OR ST_IsEmpty(boundary)
           OR ST_Area(boundary::geography) <= 1;
      `;

      // 6. Update new territory area and center
      const updatedNewTerritory = await tx.$queryRaw`
        UPDATE territories
        SET
          boundary = ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(boundary),
              3
            )
          ),
          center = ST_PointOnSurface(boundary),
          "areaKm2" = ST_Area(boundary::geography) / 1000000,
          "updatedAt" = NOW()
        WHERE id = ${newTerritoryId}
          AND boundary IS NOT NULL
          AND NOT ST_IsEmpty(boundary)
        RETURNING id, "areaKm2";
      `;

      if (!updatedNewTerritory || updatedNewTerritory.length === 0) {
        return {
          captured: false,
          areaKm2: 0,
          capturedCount: 0,
        };
      }

      return {
        captured: capturedParts.length > 0,
        areaKm2: Number(updatedNewTerritory[0].areaKm2 || 0),
        capturedCount: capturedParts.length,
      };
    },
    {
      maxWait: 10000,
      timeout: 30000,
    }
  );

  // Run this after the transaction finishes
  await updateRouteEncodedFromGeometry(newTerritoryId);

  return result;
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

JOIN users u
  ON u.id = t."userId"

LEFT JOIN activities a
  ON a.id = t."activityId"

WHERE t.boundary IS NOT NULL
  AND NOT ST_IsEmpty(t.boundary)

  AND (
    a."include_in_clan" IS NULL
    OR a."include_in_clan" = false
  )
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