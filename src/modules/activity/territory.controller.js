import prisma from "../../config/prisma.js";
import polylineLib from "@mapbox/polyline";
import { createNotification } from "../notification/notification.controller.js";

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
      i === 0 || pt[0] !== points[i - 1][0] || pt[1] !== points[i - 1][1],
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

  if (geojson.type === "LineString") {
    const encoded = encodeLineString(geojson.coordinates);

    return {
      main: encoded,
      segments: encoded ? [encoded] : [],
    };
  }

  if (geojson.type === "MultiLineString") {
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

//previous capture territory

// export const captureTerritory = async ({ userId, activityId, newTerritoryId }) => {
//   const result = await prisma.$transaction(
//     async (tx) => {
//       console.log('\n===================================');
//       console.log('CAPTURE TERRITORY START');
//       console.log('userId:', userId);
//       console.log('activityId:', activityId);
//       console.log('newTerritoryId:', newTerritoryId);
//       console.log('===================================\n');

//       // 1. Find captured parts from enemy territories
//       const capturedParts = await tx.$queryRaw`
//         WITH current_territory AS (
//           SELECT
//             id,
//             boundary AS user_movement_boundary
//           FROM territories
//           WHERE id = ${newTerritoryId}
//           LIMIT 1
//         ),

//         captured_parts AS (
//           SELECT
//             enemy.id AS "enemyTerritoryId",
//             enemy."userId" AS "enemyUserId",

//             ST_Multi(
//               ST_CollectionExtract(
//                 ST_MakeValid(
//                   ST_Intersection(
//                     enemy.boundary,
//                     current_territory.user_movement_boundary
//                   )
//                 ),
//                 3
//               )
//             ) AS captured_part

//           FROM territories enemy
//           CROSS JOIN current_territory
//           WHERE enemy."userId" != ${userId}
//             AND enemy.id != ${newTerritoryId}
//             AND enemy.boundary IS NOT NULL
//             AND NOT ST_IsEmpty(enemy.boundary)
//             AND ST_Intersects(
//               enemy.boundary,
//               current_territory.user_movement_boundary
//             )
//         ),

//         valid_captured_parts AS (
//           SELECT
//             "enemyTerritoryId",
//             "enemyUserId",
//             captured_part,
//             ST_Area(captured_part::geography) / 1000000 AS "capturedAreaKm2"
//           FROM captured_parts
//           WHERE captured_part IS NOT NULL
//             AND NOT ST_IsEmpty(captured_part)
//             AND ST_Area(captured_part::geography) > 1
//         )

//         SELECT
//           "enemyTerritoryId",
//           "enemyUserId",
//           "capturedAreaKm2"
//         FROM valid_captured_parts;
//       `;

//       // 2. Save capture events
//       for (const part of capturedParts) {
//         const affectedAreaKm2 = Number(part.capturedAreaKm2 || 0);

//         if (affectedAreaKm2 <= 0.000001) continue;

//         await tx.territoryEvent.create({
//           data: {
//             territoryId: newTerritoryId,
//             userId,
//             opponentUserId: part.enemyUserId,
//             activityId,
//             type: "CAPTURE",
//             affectedAreaKm2,
//           },
//         });

//         await createNotification({
//           userId: part.enemyUserId,

//           title: "Territory Captured",

//           message:
//             "Another player captured part of your territory.",

//           type: "TERRITORY_CAPTURED",

//           territoryId: part.enemyTerritoryId,

//           activityId,
//         });

//       }

//       // 3. Remove captured parts from enemy territories
//       await tx.$executeRaw`
//         WITH current_territory AS (
//           SELECT
//             boundary AS user_movement_boundary
//           FROM territories
//           WHERE id = ${newTerritoryId}
//           LIMIT 1
//         ),

//         captured_parts AS (
//           SELECT
//             enemy.id AS enemy_territory_id,

//             ST_Multi(
//               ST_CollectionExtract(
//                 ST_MakeValid(
//                   ST_Intersection(
//                     enemy.boundary,
//                     current_territory.user_movement_boundary
//                   )
//                 ),
//                 3
//               )
//             ) AS captured_part

//           FROM territories enemy
//           CROSS JOIN current_territory
//           WHERE enemy."userId" != ${userId}
//             AND enemy.id != ${newTerritoryId}
//             AND enemy.boundary IS NOT NULL
//             AND NOT ST_IsEmpty(enemy.boundary)
//             AND ST_Intersects(
//               enemy.boundary,
//               current_territory.user_movement_boundary
//             )
//         ),

//         updated_enemies AS (
//           UPDATE territories enemy
//           SET
//             boundary = ST_Multi(
//               ST_CollectionExtract(
//                 ST_MakeValid(
//                   ST_Difference(
//                     enemy.boundary,
//                     captured_parts.captured_part
//                   )
//                 ),
//                 3
//               )
//             ),
//             "updatedAt" = NOW()
//           FROM captured_parts
//           WHERE enemy.id = captured_parts.enemy_territory_id
//             AND captured_parts.captured_part IS NOT NULL
//             AND NOT ST_IsEmpty(captured_parts.captured_part)
//           RETURNING enemy.id
//         )

//         SELECT * FROM updated_enemies;
//       `;

//       // 4. Recalculate only affected enemy territories
//       await tx.$executeRaw`
//         UPDATE territories
//         SET
//           "areaKm2" = ST_Area(boundary::geography) / 1000000,
//           center = ST_PointOnSurface(boundary),
//           "updatedAt" = NOW()
//         WHERE "userId" != ${userId}
//           AND boundary IS NOT NULL
//           AND NOT ST_IsEmpty(boundary)
//           AND ST_Intersects(
//             boundary,
//             (
//               SELECT boundary
//               FROM territories
//               WHERE id = ${newTerritoryId}
//               LIMIT 1
//             )
//           );
//       `;

//       // 5. Delete empty or tiny territories
//       await tx.$executeRaw`
//         DELETE FROM territories
//         WHERE boundary IS NULL
//            OR ST_IsEmpty(boundary)
//            OR ST_Area(boundary::geography) <= 1;
//       `;

//       // 6. Update new territory area and center
//       const updatedNewTerritory = await tx.$queryRaw`
//         UPDATE territories
//         SET
//           boundary = ST_Multi(
//             ST_CollectionExtract(
//               ST_MakeValid(boundary),
//               3
//             )
//           ),
//           center = ST_PointOnSurface(boundary),
//           "areaKm2" = ST_Area(boundary::geography) / 1000000,
//           "updatedAt" = NOW()
//         WHERE id = ${newTerritoryId}
//           AND boundary IS NOT NULL
//           AND NOT ST_IsEmpty(boundary)
//         RETURNING id, "areaKm2";
//       `;

//       if (!updatedNewTerritory || updatedNewTerritory.length === 0) {
//         return {
//           captured: false,
//           areaKm2: 0,
//           capturedCount: 0,
//         };
//       }

//       return {
//         captured: capturedParts.length > 0,
//         areaKm2: Number(updatedNewTerritory[0].areaKm2 || 0),
//         capturedCount: capturedParts.length,
//       };
//     },
//     {
//       maxWait: 10000,
//       timeout: 30000,
//     }
//   );

//   // Run this after the transaction finishes
//   await updateRouteEncodedFromGeometry(newTerritoryId);

//   return result;
// };

// new latest previous
// export const captureTerritory = async ({ userId, activityId, newTerritoryId }) => {
//   const result = await prisma.$transaction(
//     async (tx) => {
//       console.log('\n===================================');
//       console.log('CAPTURE TERRITORY START');
//       console.log('userId:', userId);
//       console.log('activityId:', activityId);
//       console.log('newTerritoryId:', newTerritoryId);
//       console.log('===================================\n');

//       // 1. Find captured parts from enemy territories
//       const capturedParts = await tx.$queryRaw`
//         WITH current_territory AS (
//           SELECT
//             id,
//             boundary AS user_movement_boundary
//           FROM territories
//           WHERE id = ${newTerritoryId}
//           LIMIT 1
//         ),

//         captured_parts AS (
//           SELECT
//             enemy.id AS "enemyTerritoryId",
//             enemy."userId" AS "enemyUserId",

//             ST_Multi(
//               ST_CollectionExtract(
//                 ST_MakeValid(
//                   ST_Intersection(
//                     enemy.boundary,
//                     current_territory.user_movement_boundary
//                   )
//                 ),
//                 3
//               )
//             ) AS captured_part

//           FROM territories enemy
//           CROSS JOIN current_territory
//           WHERE enemy."userId" != ${userId}
//             AND enemy.id != ${newTerritoryId}
//             AND enemy.boundary IS NOT NULL
//             AND NOT ST_IsEmpty(enemy.boundary)
//             AND ST_Intersects(
//               enemy.boundary,
//               current_territory.user_movement_boundary
//             )
//         ),

//         valid_captured_parts AS (
//           SELECT
//             "enemyTerritoryId",
//             "enemyUserId",
//             captured_part,
//             ST_Area(captured_part::geography) / 1000000 AS "capturedAreaKm2"
//           FROM captured_parts
//           WHERE captured_part IS NOT NULL
//             AND NOT ST_IsEmpty(captured_part)
//             AND ST_Area(captured_part::geography) > 1
//         )

//         SELECT
//           "enemyTerritoryId",
//           "enemyUserId",
//           "capturedAreaKm2"
//         FROM valid_captured_parts;
//       `;

//       // 2. Save capture events
//       for (const part of capturedParts) {
//         const affectedAreaKm2 = Number(part.capturedAreaKm2 || 0);

//         if (affectedAreaKm2 <= 0.000001) continue;

//         await tx.territoryEvent.create({
//           data: {
//             territoryId: newTerritoryId,
//             userId,
//             opponentUserId: part.enemyUserId,
//             activityId,
//             type: "CAPTURE",
//             affectedAreaKm2,
//           },
//         });

//         await createNotification({
//           userId: part.enemyUserId,

//           title: "Territory Captured",

//           message:
//             "Another player captured part of your territory.",

//           type: "TERRITORY_CAPTURED",

//           territoryId: part.enemyTerritoryId,

//           activityId,
//         });

//       }

//       // 3. Remove captured parts from enemy territories
//       await tx.$executeRaw`
//   WITH current_territory AS (
//     SELECT boundary AS user_movement_boundary
//     FROM territories
//     WHERE id = ${newTerritoryId}
//     LIMIT 1
//   ),
//   updated_enemies AS (
//     UPDATE territories enemy
//     SET
//       boundary = ST_Multi(
//         ST_CollectionExtract(
//           ST_MakeValid(
//             ST_Difference(
//               enemy.boundary,
//               current_territory.user_movement_boundary
//             )
//           ),
//           3
//         )
//       ),
//       "areaKm2" = ST_Area(
//         ST_MakeValid(
//           ST_Difference(
//             enemy.boundary,
//             current_territory.user_movement_boundary
//           )
//         )::geography
//       ) / 1000000,
//       "updatedAt" = NOW()
//     FROM current_territory
//     WHERE enemy."userId" != ${userId}
//       AND enemy.id != ${newTerritoryId}
//       AND enemy.boundary IS NOT NULL
//       AND NOT ST_IsEmpty(enemy.boundary)
//       AND ST_Intersects(enemy.boundary, current_territory.user_movement_boundary)
//     RETURNING enemy.id
//   )
//   SELECT * FROM updated_enemies;
// `;

//       // 4. Recalculate only affected enemy territories
//       await tx.$executeRaw`
//         UPDATE territories
//         SET
//           "areaKm2" = ST_Area(boundary::geography) / 1000000,
//           center = ST_PointOnSurface(boundary),
//           "updatedAt" = NOW()
//         WHERE "userId" != ${userId}
//           AND boundary IS NOT NULL
//           AND NOT ST_IsEmpty(boundary)
//           AND ST_Intersects(
//             boundary,
//             (
//               SELECT boundary
//               FROM territories
//               WHERE id = ${newTerritoryId}
//               LIMIT 1
//             )
//           );
//       `;

//       // 5. Delete empty or tiny territories
//       await tx.$executeRaw`
//         DELETE FROM territories
//         WHERE boundary IS NULL
//            OR ST_IsEmpty(boundary)
//            OR ST_Area(boundary::geography) <= 1;
//       `;

//       // 6. Update new territory area and center
//       const updatedNewTerritory = await tx.$queryRaw`
//         UPDATE territories
//         SET
//           boundary = ST_Multi(
//             ST_CollectionExtract(
//               ST_MakeValid(boundary),
//               3
//             )
//           ),
//           center = ST_PointOnSurface(boundary),
//           "areaKm2" = ST_Area(boundary::geography) / 1000000,
//           "updatedAt" = NOW()
//         WHERE id = ${newTerritoryId}
//           AND boundary IS NOT NULL
//           AND NOT ST_IsEmpty(boundary)
//         RETURNING id, "areaKm2";
//       `;

//       if (!updatedNewTerritory || updatedNewTerritory.length === 0) {
//         return {
//           captured: false,
//           areaKm2: 0,
//           capturedCount: 0,
//         };
//       }

//       return {
//         captured: capturedParts.length > 0,
//         areaKm2: Number(updatedNewTerritory[0].areaKm2 || 0),
//         capturedCount: capturedParts.length,
//       };
//     },
//     {
//       maxWait: 10000,
//       timeout: 30000,
//     }
//   );

//   // Run this after the transaction finishes
//   await updateRouteEncodedFromGeometry(newTerritoryId);

//   return result;
// };

// latest code capture
// export const captureTerritory = async ({ userId, activityId, newTerritoryId }) => {
//   const result = await prisma.$transaction(
//     async (tx) => {
//       // 1. Find captured parts from enemy territories
//       const capturedParts = await tx.$queryRaw`
//         WITH current_territory AS (
//           SELECT
//             t.id,
//             t.boundary AS user_movement_boundary,
//             COALESCE(a."include_in_clan", false) AS "currentIncludeInClan"
//           FROM territories t
//           JOIN activities a ON a.id = t."activityId"
//           WHERE t.id = ${newTerritoryId}
//           LIMIT 1
//         ),

//         captured_parts AS (
//           SELECT
//             enemy.id AS "enemyTerritoryId",
//             enemy."userId" AS "enemyUserId",
//             ST_Multi(
//               ST_CollectionExtract(
//                 ST_MakeValid(
//                   ST_Intersection(
//                     enemy.boundary,
//                     current_territory.user_movement_boundary
//                   )
//                 ),
//                 3
//               )
//             ) AS captured_part
//           FROM territories enemy
//           JOIN activities enemy_activity
//             ON enemy_activity.id = enemy."activityId"
//           CROSS JOIN current_territory
//           WHERE enemy."userId" != ${userId}
//             AND enemy.id != ${newTerritoryId}
//             AND COALESCE(enemy_activity."include_in_clan", false)
//                 = current_territory."currentIncludeInClan"
//             AND enemy.boundary IS NOT NULL
//             AND NOT ST_IsEmpty(enemy.boundary)
//             AND ST_Intersects(
//               enemy.boundary,
//               current_territory.user_movement_boundary
//             )
//         ),

//         valid_captured_parts AS (
//           SELECT
//             "enemyTerritoryId",
//             "enemyUserId",
//             captured_part,
//             ST_Area(captured_part::geography) / 1000000 AS "capturedAreaKm2"
//           FROM captured_parts
//           WHERE captured_part IS NOT NULL
//             AND NOT ST_IsEmpty(captured_part)
//             AND ST_Area(captured_part::geography) > 1
//         )

//         SELECT
//           "enemyTerritoryId",
//           "enemyUserId",
//           "capturedAreaKm2"
//         FROM valid_captured_parts;
//       `;

//       // 2. Save capture events
//       for (const part of capturedParts) {
//         const affectedAreaKm2 = Number(part.capturedAreaKm2 || 0);
//         if (affectedAreaKm2 <= 0.000001) continue;

//         await tx.territoryEvent.create({
//           data: {
//             territoryId: newTerritoryId,
//             userId,
//             opponentUserId: part.enemyUserId,
//             activityId,
//             type: "CAPTURE",
//             affectedAreaKm2,
//           },
//         });

//         await createNotification({
//           userId: part.enemyUserId,
//           title: "Territory Captured",
//           message: "Another player captured part of your territory.",
//           type: "TERRITORY_CAPTURED",
//           territoryId: part.enemyTerritoryId,
//           activityId,
//         });
//       }

//       // 3. Remove captured parts from enemy territories
//       await tx.$executeRaw`
//         WITH current_territory AS (
//           SELECT
//             t.boundary AS user_movement_boundary,
//             COALESCE(a."include_in_clan", false) AS "currentIncludeInClan"
//           FROM territories t
//           JOIN activities a ON a.id = t."activityId"
//           WHERE t.id = ${newTerritoryId}
//           LIMIT 1
//         ),
//         updated_enemies AS (
//           UPDATE territories enemy
//           SET
//             boundary = ST_Multi(
//               ST_CollectionExtract(
//                 ST_MakeValid(
//                   ST_Difference(
//                     enemy.boundary,
//                     current_territory.user_movement_boundary
//                   )
//                 ),
//                 3
//               )
//             ),
//             "areaKm2" = ST_Area(
//               ST_MakeValid(
//                 ST_Difference(
//                   enemy.boundary,
//                   current_territory.user_movement_boundary
//                 )
//               )::geography
//             ) / 1000000,
//             "updatedAt" = NOW()
//           FROM activities enemy_activity, current_territory
//           WHERE enemy_activity.id = enemy."activityId"
//             AND enemy."userId" != ${userId}
//             AND enemy.id != ${newTerritoryId}
//             AND COALESCE(enemy_activity."include_in_clan", false)
//                 = current_territory."currentIncludeInClan"
//             AND enemy.boundary IS NOT NULL
//             AND NOT ST_IsEmpty(enemy.boundary)
//             AND ST_Intersects(
//               enemy.boundary,
//               current_territory.user_movement_boundary
//             )
//           RETURNING enemy.id
//         )
//         SELECT * FROM updated_enemies;
//       `;

//       // 4. Recalculate affected enemy territories in the same lane
//       await tx.$executeRaw`
//         WITH current_territory AS (
//           SELECT
//             t.boundary AS user_movement_boundary,
//             COALESCE(a."include_in_clan", false) AS "currentIncludeInClan"
//           FROM territories t
//           JOIN activities a ON a.id = t."activityId"
//           WHERE t.id = ${newTerritoryId}
//           LIMIT 1
//         )
//         UPDATE territories enemy
//         SET
//           "areaKm2" = ST_Area(enemy.boundary::geography) / 1000000,
//           center = ST_PointOnSurface(enemy.boundary),
//           "updatedAt" = NOW()
//         FROM activities enemy_activity, current_territory
//         WHERE enemy_activity.id = enemy."activityId"
//           AND enemy."userId" != ${userId}
//           AND enemy.id != ${newTerritoryId}
//           AND COALESCE(enemy_activity."include_in_clan", false)
//               = current_territory."currentIncludeInClan"
//           AND enemy.boundary IS NOT NULL
//           AND NOT ST_IsEmpty(enemy.boundary)
//           AND ST_Intersects(
//             enemy.boundary,
//             current_territory.user_movement_boundary
//           );
//       `;

//       // 5. Delete empty or tiny territories
//       await tx.$executeRaw`
//         DELETE FROM territories
//         WHERE boundary IS NULL
//            OR ST_IsEmpty(boundary)
//            OR ST_Area(boundary::geography) <= 1;
//       `;

//       // 6. Update new territory area and center
//       const updatedNewTerritory = await tx.$queryRaw`
//         UPDATE territories
//         SET
//           boundary = ST_Multi(
//             ST_CollectionExtract(
//               ST_MakeValid(boundary),
//               3
//             )
//           ),
//           center = ST_PointOnSurface(boundary),
//           "areaKm2" = ST_Area(boundary::geography) / 1000000,
//           "updatedAt" = NOW()
//         WHERE id = ${newTerritoryId}
//           AND boundary IS NOT NULL
//           AND NOT ST_IsEmpty(boundary)
//         RETURNING id, "areaKm2";
//       `;

//       return {
//         captured: capturedParts.length > 0,
//         areaKm2: Number(updatedNewTerritory?.[0]?.areaKm2 || 0),
//         capturedCount: capturedParts.length,
//       };
//     },
//     {
//       maxWait: 10000,
//       timeout: 30000,
//     }
//   );

//   await updateRouteEncodedFromGeometry(newTerritoryId);

//   return result;
// };

export const captureTerritory = async ({
  userId,
  activityId,
  newTerritoryId,
}) => {
  if (!userId || !activityId || !newTerritoryId) {
    throw new Error("userId, activityId and newTerritoryId are required.");
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // Serialize capture operations.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(847291, 1)
      `;

      // 1. Validate newly created territory and its ownership.
      const currentRows = await tx.$queryRaw`
        SELECT
          t.id,
          t."userId",
          t."activityId",
          t."areaKm2",
          ct."clanId"
        FROM territories t
        LEFT JOIN clan_territories ct
          ON ct."territoryId" = t.id
        WHERE t.id = ${newTerritoryId}
          AND t."userId" = ${userId}
          AND t."activityId" = ${activityId}
          AND t.boundary IS NOT NULL
          AND NOT ST_IsEmpty(t.boundary)
        LIMIT 2
      `;

      if (currentRows.length === 0) {
        return {
          captured: false,
          capturedCount: 0,
          areaKm2: 0,
          affectedTerritoryIds: [],
          notifications: [],
        };
      }

      if (currentRows.length > 1) {
        throw new Error("New territory has multiple club associations.");
      }

      const current = currentRows[0];
      const currentClanId = current.clanId ?? null;

      // 2. Find opposing territories in the SAME layer.
      //
      // Personal capture: other personal users.
      // Club capture: different clubs.
      //
      // FOR UPDATE locks the opponent rows before changes.
      const opponents = await tx.$queryRaw`
        WITH current_area AS (
          SELECT
            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(boundary),
                3
              )
            ) AS geom
          FROM territories
          WHERE id = ${newTerritoryId}
        )
        SELECT
          enemy.id,
          enemy."userId",
          ect."clanId",

          ST_Area(
            ST_CollectionExtract(
              ST_Intersection(
                ST_MakeValid(enemy.boundary),
                current_area.geom
              ),
              3
            )::geography
          ) AS "overlapM2"

        FROM territories enemy

        LEFT JOIN clan_territories ect
          ON ect."territoryId" = enemy.id

        CROSS JOIN current_area

        WHERE enemy.id <> ${newTerritoryId}
          AND enemy.boundary IS NOT NULL
          AND NOT ST_IsEmpty(enemy.boundary)

          AND (
            (
              ${currentClanId}::text IS NULL
              AND ect."clanId" IS NULL
              AND enemy."userId" <> ${userId}
            )
            OR
            (
              ${currentClanId}::text IS NOT NULL
              AND ect."clanId" IS NOT NULL
              AND ect."clanId"::text
                  <> ${currentClanId}::text
            )
          )

          AND ST_Intersects(
            enemy.boundary,
            current_area.geom
          )

        ORDER BY enemy.id
        FOR UPDATE OF enemy
      `;

      const notifications = [];
      const affectedClans = new Set();
      const affectedTerritoryIds = new Set();
      let capturedCount = 0;

      // 3. Subtract B from each opponent A.
      for (const opponent of opponents) {
        const overlapM2 = Number(opponent.overlapM2) || 0;

        // Ignore boundary-only contact.
        if (overlapM2 <= 0) continue;

        const changed = await tx.$queryRaw`
          WITH current_area AS (
            SELECT
              ST_Multi(
                ST_CollectionExtract(
                  ST_MakeValid(boundary),
                  3
                )
              ) AS geom
            FROM territories
            WHERE id = ${newTerritoryId}
          ),

          remaining AS (
            SELECT
              enemy.id,

              ST_Multi(
                ST_CollectionExtract(
                  ST_MakeValid(
                    ST_Difference(
                      ST_Multi(
                        ST_CollectionExtract(
                          ST_MakeValid(enemy.boundary),
                          3
                        )
                      ),
                      current_area.geom
                    )
                  ),
                  3
                )
              ) AS geom

            FROM territories enemy
            CROSS JOIN current_area

            WHERE enemy.id = ${opponent.id}
          )

          UPDATE territories t

          SET
            boundary = r.geom,

            center = CASE
              WHEN ST_IsEmpty(r.geom)
                THEN NULL
              ELSE ST_PointOnSurface(r.geom)
            END,

            "areaKm2" =
              ST_Area(r.geom::geography)
              / 1000000.0,

            "updatedAt" = NOW()

          FROM remaining r
          WHERE t.id = r.id

          RETURNING
            t.id,
            t."areaKm2",
            ST_IsEmpty(t.boundary) AS "isEmpty"
        `;

        if (changed.length === 0) continue;

        affectedTerritoryIds.add(opponent.id);

        // Keep historical rows, but their empty geometries
        // and zero areas must never appear on ownership maps.
        //
        // Do NOT remove their clan_territories association.
        // That association identifies the ownership layer.

        if (opponent.clanId) {
          affectedClans.add(opponent.clanId);
        }

        // Tiny overlaps are still subtracted to prevent
        // duplicate ownership, but do not create events.
        if (overlapM2 <= 1) continue;

        const affectedAreaKm2 = overlapM2 / 1000000.0;

        await tx.territoryEvent.create({
          data: {
            territoryId: newTerritoryId,
            userId,
            opponentUserId: opponent.userId,
            activityId,
            type: "CAPTURE",
            affectedAreaKm2,
          },
        });

        capturedCount++;

        notifications.push({
          userId: opponent.userId,
          territoryId: opponent.id,
        });
      }

      // 4. Synchronize the changed club-territory areas.
      //
      // Only affected rows are synchronized.
      const changedIds = [...affectedTerritoryIds];

      if (changedIds.length > 0) {
        await tx.$executeRaw`
          UPDATE clan_territories ct
          SET "areaKm2" = t."areaKm2"
          FROM territories t
          WHERE ct."territoryId" = t.id
            AND t.id IN (${Prisma.join(changedIds)})
        `;
      }

      // 5. Recalculate affected clubs.
      //
      // Count only territories that still have area.
      // Fully captured historical rows count as zero.
      for (const clanId of affectedClans) {
        const totals = await tx.$queryRaw`
          SELECT
            COUNT(*)::integer AS "territoryCount",

            COALESCE(
              SUM(t."areaKm2"),
              0
            )::double precision AS "totalAreaKm2"

          FROM clan_territories ct
          JOIN territories t
            ON t.id = ct."territoryId"

          WHERE ct."clanId" = ${clanId}
            AND t.boundary IS NOT NULL
            AND NOT ST_IsEmpty(t.boundary)
            AND t."areaKm2" > 0
        `;

        const stats = totals[0];

        await tx.clan.update({
          where: { id: clanId },
          data: {
            territoryCount: Number(stats.territoryCount),
            totalAreaKm2: Number(stats.totalAreaKm2),
          },
        });
      }

      return {
        captured: capturedCount > 0,
        capturedCount,
        areaKm2: Number(current.areaKm2) || 0,
        affectedTerritoryIds: changedIds,
        notifications,
      };
    },
    {
      maxWait: 10000,
      timeout: 60000,
    },
  );

  // 6. Send notifications AFTER successful commit.
  for (const item of result.notifications) {
    try {
      await createNotification({
        userId: item.userId,
        title: "Territory Captured",
        message: "Another player captured part of your territory.",
        type: "TERRITORY_CAPTURED",
        territoryId: item.territoryId,
        activityId,
      });
    } catch (error) {
      console.error("TERRITORY_CAPTURE_NOTIFICATION_ERROR:", error);
    }
  }

  return {
    captured: result.captured,
    capturedCount: result.capturedCount,
    areaKm2: result.areaKm2,
    affectedTerritoryIds: result.affectedTerritoryIds,
  };
};

// ─────────────────────────────────────────────
// Color palette
// ─────────────────────────────────────────────

const TERRITORY_COLORS = [
  { fill: "rgba(37,  99, 235, 0.38)", border: "rgba(30,  64, 175, 1)" },
  { fill: "rgba(22, 163,  74, 0.38)", border: "rgba(21, 128,  61, 1)" },
  { fill: "rgba(220,  38,  38, 0.38)", border: "rgba(153,  27,  27, 1)" },
  { fill: "rgba(147,  51, 234, 0.38)", border: "rgba(107,  33, 168, 1)" },
  { fill: "rgba(234,  88,  12, 0.38)", border: "rgba(154,  52,  18, 1)" },
  { fill: "rgba(219,  39, 119, 0.38)", border: "rgba(157,  23,  77, 1)" },
  { fill: "rgba(75,   85,  99, 0.38)", border: "rgba(55,   65,  81, 1)" },
  { fill: "rgba(202, 138,   4, 0.38)", border: "rgba(133,  77,  14, 1)" },
];

// ─────────────────────────────────────────────
// Get All Territories
// GET /api/territories/all
// ─────────────────────────────────────────────

// export const getAllTerritories = async (req, res) => {
//   try {
//     const territoryRows = await prisma.$queryRaw`
//       WITH ranked AS (
//         SELECT
//           t.id,
//           t."userId",
//           t."activityId",
//           t.name,
//           t."areaKm2",
//           t."capturedAt",
//           t."createdAt",
//           t."updatedAt",
//           t.boundary,
//           t.center,
//           u.username,
//           u.full_name AS "fullName",
//           t."routeEncoded",
//           t."routeSegmentsEncoded",
//           ROW_NUMBER() OVER (ORDER BY t."updatedAt" DESC) AS rn
//         FROM territories t

// JOIN users u
//   ON u.id = t."userId"

// LEFT JOIN activities a
//   ON a.id = t."activityId"

// WHERE t.boundary IS NOT NULL
//   AND NOT ST_IsEmpty(t.boundary)

//   AND (
//     a."include_in_clan" IS NULL
//     OR a."include_in_clan" = false
//   )
//       ),
//       clipped AS (
//         SELECT
//           r.id,
//           r."userId",
//           r."activityId",
//           r.name,
//           r."areaKm2",
//           r."capturedAt",
//           r."createdAt",
//           r."updatedAt",
//           r.username,
//           r."fullName",
//           r."routeEncoded",
//           r."routeSegmentsEncoded",
//           COALESCE(
//             (
//               SELECT ST_Difference(
//                 r.boundary,
//                 ST_Union(newer.boundary)
//               )
//               FROM ranked newer
//               WHERE newer.rn < r.rn
//                 AND ST_Intersects(r.boundary, newer.boundary)
//             ),
//             r.boundary
//           ) AS clipped_boundary,
//           ST_AsGeoJSON(r.center)::json AS center
//         FROM ranked r
//       )
//       SELECT
//         id,
//         "userId",
//         "activityId",
//         name,
//         "areaKm2",
//         "capturedAt",
//         "createdAt",
//         "updatedAt",
//         username,
//         "fullName",
//         "routeEncoded",
//         "routeSegmentsEncoded",
//         center,
//         ST_AsGeoJSON(clipped_boundary)::json AS boundary
//       FROM clipped
//       WHERE clipped_boundary IS NOT NULL
//         AND NOT ST_IsEmpty(clipped_boundary)
//       ORDER BY "updatedAt" DESC;
//     `;

//     const seenUsers = [];

//     for (const t of territoryRows) {
//       if (!seenUsers.includes(t.userId)) {
//         seenUsers.push(t.userId);
//       }
//     }

//     const userColorMap = Object.fromEntries(
//       seenUsers.map((userId, index) => [
//         userId,
//         TERRITORY_COLORS[Math.min(index, TERRITORY_COLORS.length - 1)],
//       ])
//     );

//     const territories = territoryRows.map((t) => ({
//       id: t.id,
//       userId: t.userId,
//       activityId: t.activityId,
//       name: t.name,
//       owner: {
//         username: t.username,
//         fullName: t.fullName,
//       },
//       areaKm2: Number(t.areaKm2),
//       capturedAt: t.capturedAt,
//       createdAt: t.createdAt,
//       updatedAt: t.updatedAt,
//       geojson: t.boundary,
//       center: t.center,
//       routeEncoded: t.routeEncoded,
//       routeSegmentsEncoded: t.routeSegmentsEncoded ?? [],
//       color:
//         userColorMap[t.userId] ??
//         TERRITORY_COLORS[TERRITORY_COLORS.length - 1],
//     }));

//     return res.status(200).json({
//       success: true,
//       count: territories.length,
//       territories,
//     });
//   } catch (error) {
//     console.error('GET_ALL_TERRITORIES ERROR:', error);

//     return res.status(500).json({
//       success: false,
//       message: 'Failed to fetch territories',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined,
//     });
//   }
// };

//------------------------------------------------
//old one to use if anything is wrong
//------------------------------------------------

// export const getAllTerritories = async (req, res) => {
//   try {
//     const territoryRows = await prisma.$queryRaw`
//       WITH base AS (
//         SELECT
//           t.id,
//           t."userId",
//           t."activityId",
//           t.name,
//           t."areaKm2",
//           t."capturedAt",
//           t."createdAt",
//           t."updatedAt",

//           -- Validate once here instead of repeatedly below.
//           ST_MakeValid(t.boundary) AS boundary,

//           t.center,

//           u.username,
//           u.full_name AS "fullName",

//           t."routeEncoded",
//           t."routeSegmentsEncoded"

//         FROM territories t

//         JOIN users u
//           ON u.id = t."userId"

//         LEFT JOIN activities a
//           ON a.id = t."activityId"

//         WHERE
//           t.boundary IS NOT NULL

//           AND NOT ST_IsEmpty(t.boundary)

//           AND (
//             a."include_in_clan" IS NULL
//             OR a."include_in_clan" = false
//           )
//       ),

//       ranked AS (
//         SELECT
//           b.*,

//           ROW_NUMBER() OVER (
//             ORDER BY
//               b."updatedAt" DESC,
//               b.id DESC
//           ) AS rn

//         FROM base b
//       ),

//       /*
//        * Build one cumulative union.
//        *
//        * For each territory, previous_union contains every territory
//        * newer than the current territory.
//        *
//        * This avoids the expensive correlated:
//        *
//        * SELECT ST_UnaryUnion(ST_Collect(...))
//        * FROM ranked newer
//        * WHERE newer.rn < r.rn
//        *
//        * being executed independently for every territory.
//        */
//       cumulative AS (
//         SELECT
//           r.*,

//           ST_Union(r.boundary) OVER (
//             ORDER BY
//               r."updatedAt" DESC,
//               r.id DESC

//             ROWS BETWEEN
//               UNBOUNDED PRECEDING
//               AND 1 PRECEDING
//           ) AS previous_union

//         FROM ranked r
//       ),

//       clipped AS (
//         SELECT
//           c.id,
//           c."userId",
//           c."activityId",
//           c.name,
//           c."areaKm2",
//           c."capturedAt",
//           c."createdAt",
//           c."updatedAt",

//           c.username,
//           c."fullName",

//           c."routeEncoded",
//           c."routeSegmentsEncoded",

//           ST_AsGeoJSON(c.center)::json AS center,

//           /*
//            * First territory has no newer territory,
//            * therefore return its original boundary.
//            */
//           CASE
//             WHEN c.previous_union IS NULL THEN
//               ST_Multi(
//                 ST_CollectionExtract(
//                   c.boundary,
//                   3
//                 )
//               )

//             /*
//              * Avoid ST_Difference entirely when there
//              * is no intersection.
//              */
//             WHEN NOT ST_Intersects(
//               c.boundary,
//               c.previous_union
//             ) THEN
//               ST_Multi(
//                 ST_CollectionExtract(
//                   c.boundary,
//                   3
//                 )
//               )

//             ELSE
//               ST_Multi(
//                 ST_CollectionExtract(
//                   ST_MakeValid(
//                     ST_Difference(
//                       c.boundary,
//                       c.previous_union
//                     )
//                   ),
//                   3
//                 )
//               )
//           END AS clipped_boundary

//         FROM cumulative c
//       )

//       SELECT
//         id,
//         "userId",
//         "activityId",
//         name,
//         "areaKm2",
//         "capturedAt",
//         "createdAt",
//         "updatedAt",

//         username,
//         "fullName",

//         "routeEncoded",
//         "routeSegmentsEncoded",

//         center,

//         ST_AsGeoJSON(clipped_boundary)::json AS boundary

//       FROM clipped

//       WHERE
//         clipped_boundary IS NOT NULL

//         AND NOT ST_IsEmpty(clipped_boundary)

//         AND GeometryType(clipped_boundary)
//           IN ('POLYGON', 'MULTIPOLYGON')

//       ORDER BY
//         "updatedAt" DESC,
//         id DESC;
//     `;

//     // =========================================================
//     // ASSIGN COLORS TO USERS
//     // =========================================================

//     const seenUsers = new Set();

//     for (const territory of territoryRows) {
//       seenUsers.add(territory.userId);
//     }

//     const userColorMap = {};

//     let colorIndex = 0;

//     for (const userId of seenUsers) {
//       userColorMap[userId] =
//         TERRITORY_COLORS[
//           Math.min(
//             colorIndex,
//             TERRITORY_COLORS.length - 1
//           )
//         ];

//       colorIndex++;
//     }

//     // =========================================================
//     // FORMAT RESPONSE
//     // =========================================================

//     const territories = territoryRows.map((t) => ({
//       id: t.id,

//       userId: t.userId,

//       activityId: t.activityId,

//       name: t.name,

//       owner: {
//         username: t.username,
//         fullName: t.fullName,
//       },

//       areaKm2: Number(t.areaKm2),

//       capturedAt: t.capturedAt,

//       createdAt: t.createdAt,

//       updatedAt: t.updatedAt,

//       geojson: t.boundary,

//       center: t.center,

//       routeEncoded: t.routeEncoded,

//       routeSegmentsEncoded:
//         t.routeSegmentsEncoded ?? [],

//       color:
//         userColorMap[t.userId] ??
//         TERRITORY_COLORS[
//           TERRITORY_COLORS.length - 1
//         ],
//     }));

//     // =========================================================
//     // RESPONSE
//     // =========================================================

//     return res.status(200).json({
//       success: true,

//       count: territories.length,

//       territories,
//     });
//   } catch (error) {
//     console.error(
//       'GET_ALL_TERRITORIES ERROR:',
//       error
//     );

//     return res.status(500).json({
//       success: false,

//       message: 'Failed to fetch territories',

//       error:
//         process.env.NODE_ENV === 'development'
//           ? error.message
//           : undefined,
//     });
//   }
// };

// // old code
// export const getAllTerritories = async (req, res) => {
//   const startTime = Date.now();

//   try {
//     // =========================================================
//     // LIMIT
//     // =========================================================

//     // Example:
//     // GET /api/territories?limit=100
//     //
//     // Default = 100
//     // Maximum = 300

//     const requestedLimit = parseInt(req.query.limit, 10);

//     const limit =
//       Number.isInteger(requestedLimit) && requestedLimit > 0
//         ? Math.min(requestedLimit, 300)
//         : 100;

//     // =========================================================
//     // FETCH TERRITORIES
//     // =========================================================

//     const territoryRows = await prisma.$queryRaw`
//       SELECT
//         t.id,
//         t."userId",
//         t."activityId",
//         t.name,
//         t."areaKm2",
//         t."capturedAt",
//         t."createdAt",
//         t."updatedAt",

//         u.username,
//         u.full_name AS "fullName",

//         t."routeEncoded",
//         t."routeSegmentsEncoded",

//         -- ============================
//         -- CENTER
//         -- ============================

//         CASE
//           WHEN t.center IS NULL THEN NULL
//           ELSE ST_AsGeoJSON(t.center)::json
//         END AS center,

//         -- ============================
//         -- BOUNDARY
//         -- ============================

//         ST_AsGeoJSON(
//           ST_SimplifyPreserveTopology(
//             CASE
//               WHEN ST_IsValid(t.boundary)
//                 THEN t.boundary
//               ELSE ST_MakeValid(t.boundary)
//             END,

//             -- Simplification tolerance
//             0.00001
//           )
//         )::json AS boundary

//       FROM territories t

//       JOIN users u
//         ON u.id = t."userId"

//       LEFT JOIN activities a
//         ON a.id = t."activityId"

//       WHERE
//         t.boundary IS NOT NULL

//         AND NOT ST_IsEmpty(t.boundary)

//         AND (
//           a."include_in_clan" IS NULL
//           OR a."include_in_clan" = false
//         )

//       ORDER BY
//         t."updatedAt" DESC,
//         t.id DESC

//       LIMIT ${limit};
//     `;

//     console.log(
//       `Territory SQL finished in ${
//         (Date.now() - startTime) / 1000
//       } seconds`,
//     );

//     // =========================================================
//     // ASSIGN COLORS TO USERS
//     // =========================================================

//     const seenUsers = new Set();

//     for (const territory of territoryRows) {
//       seenUsers.add(territory.userId);
//     }

//     const userColorMap = {};

//     let colorIndex = 0;

//     for (const userId of seenUsers) {
//       userColorMap[userId] =
//         TERRITORY_COLORS[
//           Math.min(
//             colorIndex,
//             TERRITORY_COLORS.length - 1,
//           )
//         ];

//       colorIndex++;
//     }

//     // =========================================================
//     // FORMAT RESPONSE
//     // =========================================================

//     const territories = territoryRows.map((t) => ({
//       id: t.id,

//       userId: t.userId,

//       activityId: t.activityId,

//       name: t.name,

//       owner: {
//         username: t.username,
//         fullName: t.fullName,
//       },

//       areaKm2: Number(t.areaKm2),

//       capturedAt: t.capturedAt,

//       createdAt: t.createdAt,

//       updatedAt: t.updatedAt,

//       geojson: t.boundary,

//       center: t.center,

//       routeEncoded: t.routeEncoded,

//       routeSegmentsEncoded:
//         t.routeSegmentsEncoded ?? [],

//       color:
//         userColorMap[t.userId] ??
//         TERRITORY_COLORS[
//           TERRITORY_COLORS.length - 1
//         ],
//     }));

//     // =========================================================
//     // RESPONSE
//     // =========================================================

//     const totalTime =
//       (Date.now() - startTime) / 1000;

//     console.log(
//       `GET ALL TERRITORIES completed in ${totalTime} seconds`,
//     );

//     return res.status(200).json({
//       success: true,

//       count: territories.length,

//       territories,

//       processingTime: `${totalTime}s`,
//     });
//   } catch (error) {
//     console.error(
//       'GET_ALL_TERRITORIES ERROR:',
//       error,
//     );

//     console.error(
//       `Failed after ${
//         (Date.now() - startTime) / 1000
//       } seconds`,
//     );

//     return res.status(500).json({
//       success: false,

//       message: 'Failed to fetch territories',

//       error:
//         process.env.NODE_ENV === 'development'
//           ? error.message
//           : undefined,
//     });
//   }
// };

// new code

export const getAllTerritories = async (req, res) => {
  const startTime = Date.now();

  try {
    // =========================================================
    // STEP 1: VALIDATE LIMIT
    // =========================================================

    // const requestedLimit = Number.parseInt(
    //   req.query.limit,
    //   10
    // );

    // const limit =
    //   Number.isInteger(requestedLimit) &&
    //   requestedLimit > 0
    //     ? Math.min(requestedLimit, 300)
    //     : 100;

    // =========================================================
    // STEP 2: FETCH PERSONAL TERRITORIES
    // =========================================================
    //
    // Rules:
    //
    // 1. Only return personal territories.
    // 2. Exclude fully captured territories.
    // 3. Return actual remaining ownership geometry.
    // 4. Preserve holes inside polygons.
    // 5. Preserve separated MultiPolygon components.
    // 6. Never independently simplify ownership boundaries.
    // 7. Never replace current boundaries with old routes.
    //
    // NOTE:
    // This expects captureTerritory() to store valid,
    // updated Polygon/MultiPolygon geometry.
    // =========================================================

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

        u.username,
        u.full_name AS "fullName",

        t."routeEncoded",
        t."routeSegmentsEncoded",

        -- =========================================
        -- CENTER
        -- =========================================

        CASE
          WHEN t.center IS NULL
            THEN NULL

          WHEN ST_IsEmpty(t.center)
            THEN NULL

          ELSE ST_AsGeoJSON(
            t.center
          )::json
        END AS center,

        -- =========================================
        -- OWNERSHIP BOUNDARY
        -- =========================================
        --
        -- IMPORTANT:
        --
        -- Return the real PostGIS boundary.
        --
        -- Polygon:
        --   outer ring + interior holes
        --
        -- MultiPolygon:
        --   all separated polygon components
        --
        -- No simplification because independently
        -- simplified boundaries can visually overlap.
        -- =========================================

        ST_AsGeoJSON(
          t.boundary
        )::json AS boundary

      FROM territories t

      INNER JOIN users u
        ON u.id = t."userId"

      WHERE
        -- Valid ownership geometry must exist.
        t.boundary IS NOT NULL

        -- Completely captured territory is hidden.
        AND NOT ST_IsEmpty(t.boundary)

        -- Never display zero-area territory.
        AND t."areaKm2" > 0

        -- Exclude points/lines with no polygon area.
        AND ST_Dimension(t.boundary) = 2

        -- Personal and club layers are separate.
        --
        -- An association means club territory.
        -- Do not rely on activities.include_in_clan.
        AND NOT EXISTS (
          SELECT 1
          FROM clan_territories ct
          WHERE ct."territoryId" = t.id
        )

      ORDER BY
  t."updatedAt" DESC,
  t.id DESC;
    `;

    const sqlTime = (Date.now() - startTime) / 1000;

    console.log(`Territory SQL finished in ${sqlTime.toFixed(3)} seconds`);

    // =========================================================
    // STEP 3: ASSIGN STABLE COLORS TO USERS
    // =========================================================
    //
    // Previous approach:
    // Colors changed depending on the order of users.
    //
    // New approach:
    // Same userId consistently maps to the same color.
    //
    // Different users can still share a color because
    // the palette contains a limited number of colors.
    // =========================================================

    const getStableUserColor = (userId) => {
      if (!Array.isArray(TERRITORY_COLORS) || TERRITORY_COLORS.length === 0) {
        return "#3B82F6";
      }

      const value = String(userId ?? "");

      let hash = 0;

      for (let i = 0; i < value.length; i++) {
        hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
      }

      const index = (hash >>> 0) % TERRITORY_COLORS.length;

      return TERRITORY_COLORS[index];
    };

    // =========================================================
    // STEP 4: FORMAT RESPONSE
    // =========================================================

    const territories = territoryRows.map((t) => ({
      id: t.id,

      userId: t.userId,

      activityId: t.activityId,

      name: t.name,

      owner: {
        username: t.username,
        fullName: t.fullName,
      },

      areaKm2: Number(t.areaKm2) || 0,

      capturedAt: t.capturedAt,

      createdAt: t.createdAt,

      updatedAt: t.updatedAt,

      // Actual remaining geometry after capture.
      //
      // May contain:
      // - Polygon
      // - Polygon with holes
      // - MultiPolygon
      geojson: t.boundary,

      center: t.center,

      // Historical activity route.
      // Do not use these as territory outlines.
      routeEncoded: t.routeEncoded,

      routeSegmentsEncoded: t.routeSegmentsEncoded ?? [],

      color: getStableUserColor(t.userId),
    }));

    // =========================================================
    // STEP 5: RESPONSE
    // =========================================================

    const totalTime = (Date.now() - startTime) / 1000;

    console.log(
      `GET ALL TERRITORIES completed in ${totalTime.toFixed(3)} seconds`,
    );

    return res.status(200).json({
      success: true,

      count: territories.length,

      territories,

      processingTime: `${totalTime.toFixed(3)}s`,
    });
  } catch (error) {
    const elapsed = (Date.now() - startTime) / 1000;

    console.error("GET_ALL_TERRITORIES_ERROR:", error);

    console.error(`Failed after ${elapsed.toFixed(3)} seconds`);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch territories",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
        message: "Territory not found",
      });
    }

    if (territory.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    let segments = [];

    if (
      Array.isArray(routeSegmentsEncoded) &&
      routeSegmentsEncoded.length > 0
    ) {
      segments = routeSegmentsEncoded.filter(
        (segment) => typeof segment === "string" && segment.trim().length > 0,
      );
    } else if (routeEncoded) {
      segments = [routeEncoded];
    }

    if (segments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "routeEncoded or routeSegmentsEncoded is required",
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
            lng <= 180,
        );

      if (coordinates.length >= 2) {
        lineGeoJsonSegments.push(coordinates);
      }
    }

    if (lineGeoJsonSegments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid route segments found",
      });
    }

    const routeGeoJson =
      lineGeoJsonSegments.length === 1
        ? {
            type: "LineString",
            coordinates: lineGeoJsonSegments[0],
          }
        : {
            type: "MultiLineString",
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
    console.error("UPDATE_TERRITORY_ROUTE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res.status(200).json({
      success: true,
      events,
    });
  } catch (error) {
    console.error("GET_TERRITORY_EVENTS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};
