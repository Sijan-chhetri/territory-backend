import prisma from '../../config/prisma.js';
import polylineLib from '@mapbox/polyline';
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




 // Requires the existing prisma and createNotification imports from your controller/service.
 // This function assumes finishActivity already created a valid closed-loop territory.
 // Recent means 24 hours after the opposing territory's capturedAt timestamp.

export const captureTerritory = async ({
  userId,
  activityId,
  newTerritoryId,
}) => {
  const MIN_CAPTURE_AREA_M2 = 1;

  // ============================================================
  // GET CAPTURING USER
  // ============================================================

  const capturingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
    },
  });

  const capturingUsername =
    capturingUser?.username?.trim() || "A player";

  // ============================================================
  // FORMAT CAPTURED AREA FOR NOTIFICATIONS
  // ============================================================

  const formatCapturedArea = (areaKm2) => {
    const area = Number(areaKm2);

    if (!Number.isFinite(area) || area <= 0) {
      return "0 m²";
    }

    if (area < 0.01) {
      return `${(area * 1000000).toLocaleString("en-US", {
        maximumFractionDigits: 1,
      })} m²`;
    }

    return `${area.toFixed(4)} km²`;
  };

  // ============================================================
  // DATABASE TRANSACTION
  // ============================================================

  const transactionResult = await prisma.$transaction(
    async (tx) => {
      // --------------------------------------------------------
      // STEP 1: PREVENT CONCURRENT CAPTURE CONFLICTS
      // --------------------------------------------------------
      // All territory ownership writers should use this lock.
      // This prevents concurrent executions of this capture
      // function from modifying overlapping areas simultaneously.

      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(20261011, 1)
      `;

      // --------------------------------------------------------
      // STEP 2: VALIDATE NEW TERRITORY
      // --------------------------------------------------------
      // The new territory must:
      // - Exist
      // - Belong to the current user
      // - Belong to the specified activity
      // - Have a valid, non-empty capture polygon
      // - Have an existing GPS route
      //
      // Closed-loop validation must already have happened
      // inside finishActivity.

      const territory = await tx.$queryRaw`
        SELECT
          t.id,
          ST_Area(
            ST_CollectionExtract(
              ST_MakeValid(t.boundary),
              3
            )::geography
          ) AS "areaM2"

        FROM territories t

        JOIN activities a
          ON a.id = t."activityId"

        WHERE t.id = ${newTerritoryId}
          AND t."userId" = ${userId}
          AND t."activityId" = ${activityId}
          AND t.boundary IS NOT NULL
          AND NOT ST_IsEmpty(t.boundary)
          AND ST_IsValid(t.boundary)
          AND ST_Area(t.boundary::geography)
              > ${MIN_CAPTURE_AREA_M2}
          AND t."routeGeometry" IS NOT NULL
          AND NOT ST_IsEmpty(t."routeGeometry")

        LIMIT 1
      `;

      if (!territory.length) {
        throw new Error(
          "New territory not found, invalid, or does not belong to this activity/user"
        );
      }

      // --------------------------------------------------------
      // STEP 3: FIND AND CAPTURE ALL OVERLAPPING TERRITORIES
      // --------------------------------------------------------
      //
      // NEW DURO CAPTURE RULES:
      //
      // 1. NO TIME LIMIT.
      //
      // 2. NEWEST VALID CLOSED LOOP WINS.
      //
      // 3. CAPTURE THE FULL POLYGON INTERSECTION.
      //
      // 4. REMOVE CAPTURED LAND FROM OLDER POLYGONS.
      //
      // 5. INCLUDE OLDER TERRITORIES OF THE SAME USER.
      //
      // 6. PERSONAL AND CLUB MODES REMAIN SEPARATE.
      //
      // 7. NEVER LEAVE A POSITIVE-AREA OVERLAP.
      //
      // EXAMPLE:
      //
      // Runner B owns 10,000 m².
      // Runner C captures 3,000 m² inside B's area.
      //
      // B remaining = 7,000 m²
      // C territory = 3,000 m²
      //
      // It does not matter whether B captured the area
      // 1 hour ago or 1 year ago.
      //
      // --------------------------------------------------------

      const affected = await tx.$queryRaw`
        WITH current_territory AS (
          SELECT
            t.id,
            t."userId",
            t.boundary,

            COALESCE(
              a."include_in_clan",
              false
            ) AS in_clan

          FROM territories t

          JOIN activities a
            ON a.id = t."activityId"

          WHERE t.id = ${newTerritoryId}
        ),

        // ----------------------------------------------------
        // FIND ALL TERRITORIES OVERLAPPING THE NEW POLYGON
        // ----------------------------------------------------

        overlapping_territories AS (
          SELECT
            enemy.id AS enemy_id,
            enemy."userId" AS enemy_user_id,
            enemy.boundary AS enemy_boundary,

            ct.boundary AS new_boundary,

            CASE
              WHEN ST_Covers(
                ct.boundary,
                enemy.boundary
              )
              THEN 'FULL_ENCLOSURE'

              ELSE 'LOOP_OVERLAP'
            END AS capture_method

          FROM territories enemy

          JOIN activities ea
            ON ea.id = enemy."activityId"

          CROSS JOIN current_territory ct

          WHERE enemy.id <> ${newTerritoryId}

            AND COALESCE(
              ea."include_in_clan",
              false
            ) = ct.in_clan

            AND enemy.boundary IS NOT NULL

            AND NOT ST_IsEmpty(enemy.boundary)

            AND ST_Intersects(
              enemy.boundary,
              ct.boundary
            )
        ),

        // ----------------------------------------------------
        // CALCULATE THE EXACT INTERSECTION
        // ----------------------------------------------------
        // Only land inside both polygons can be captured.
        // Polygonal components are extracted to avoid lines
        // and points being counted as owned land.

        candidate_parts AS (
          SELECT
            o.enemy_id,
            o.enemy_user_id,
            o.capture_method,

            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(
                  ST_Intersection(
                    o.enemy_boundary,
                    o.new_boundary
                  )
                ),
                3
              )
            ) AS captured_part

          FROM overlapping_territories o
        ),

        // ----------------------------------------------------
        // MEASURE CAPTURED AREAS
        // ----------------------------------------------------

        eligible AS (
          SELECT
            cp.enemy_id,
            cp.enemy_user_id,
            cp.capture_method,
            cp.captured_part,

            ST_Area(
              cp.captured_part::geography
            ) AS captured_m2

          FROM candidate_parts cp

          WHERE cp.captured_part IS NOT NULL
            AND NOT ST_IsEmpty(cp.captured_part)
        ),

        // ----------------------------------------------------
        // REMOVE CAPTURED LAND FROM OLD TERRITORIES
        // ----------------------------------------------------
        //
        // CRITICAL:
        //
        // ST_Difference removes the new polygon's overlapping
        // area from each old polygon.
        //
        // This applies to:
        // - Other runners
        // - The same runner's older territory records
        //
        // We remove every positive-area intersection, even
        // below 1 m², to prevent tiny ownership overlaps.
        //
        // The 1 m² threshold is only used later for capture
        // events and notifications.

        changed AS (
          UPDATE territories AS enemy

          SET
            boundary = ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(
                  ST_Difference(
                    enemy.boundary,
                    e.captured_part
                  )
                ),
                3
              )
            ),

            "updatedAt" = NOW()

          FROM eligible e

          WHERE enemy.id = e.enemy_id
            AND e.captured_m2 > 0

          RETURNING
            enemy.id AS "enemyTerritoryId",

            e.enemy_user_id AS "enemyUserId",

            e.capture_method AS "captureMethod",

            e.captured_m2 / 1000000.0
              AS "capturedAreaKm2"
        )

        SELECT *
        FROM changed
      `;

      // --------------------------------------------------------
      // STEP 4: UPDATE OLD TERRITORY AREAS AND CENTERS
      // --------------------------------------------------------
      //
      // Every affected old territory must reflect its
      // remaining polygon.
      //
      // Fully captured:
      // areaKm2 = 0
      // center = NULL
      //
      // Partially captured:
      // areaKm2 = remaining area
      // center = point inside remaining polygon

      for (const part of affected) {
        await tx.$executeRaw`
          UPDATE territories t

          SET
            "areaKm2" = CASE
              WHEN t.boundary IS NULL
                OR ST_IsEmpty(t.boundary)
              THEN 0

              ELSE ST_Area(
                t.boundary::geography
              ) / 1000000.0
            END,

            center = CASE
              WHEN t.boundary IS NULL
                OR ST_IsEmpty(t.boundary)
              THEN NULL

              ELSE ST_PointOnSurface(
                t.boundary
              )
            END

          WHERE t.id = ${part.enemyTerritoryId}
        `;
      }

      // --------------------------------------------------------
      // STEP 5: KEEP THE NEW TERRITORY'S FULL CAPTURE AREA
      // --------------------------------------------------------
      //
      // VERY IMPORTANT:
      //
      // Do not subtract remaining older territory polygons
      // from the new territory.
      //
      // Those overlapping parts were already removed from
      // old territories in STEP 3.
      //
      // New territory takes priority.
      //
      // Recalculate area and center from its polygon.

      await tx.$executeRaw`
        UPDATE territories t

        SET
          boundary = ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(t.boundary),
              3
            )
          ),

          "areaKm2" = ST_Area(
            ST_CollectionExtract(
              ST_MakeValid(t.boundary),
              3
            )::geography
          ) / 1000000.0,

          center = ST_PointOnSurface(
            ST_CollectionExtract(
              ST_MakeValid(t.boundary),
              3
            )
          ),

          "updatedAt" = NOW()

        WHERE t.id = ${newTerritoryId}
      `;

      // --------------------------------------------------------
      // STEP 6: CREATE CAPTURE EVENTS
      // --------------------------------------------------------
      //
      // Opponent capture:
      // - Save CAPTURE event
      // - Prepare opponent notification
      //
      // Own older territory:
      // - Already clipped correctly
      // - No opponent capture event
      // - No self-notification
      //
      // Tiny captures <= 1 m²:
      // - Geometry still updated
      // - No capture event or notification

      const pendingNotifications = [];

      for (const part of affected) {
        const capturedAreaKm2 = Number(
          part.capturedAreaKm2
        );

        if (
          !Number.isFinite(capturedAreaKm2) ||
          capturedAreaKm2 <= MIN_CAPTURE_AREA_M2 / 1000000
        ) {
          continue;
        }

        // Ignore capture events against the same user.
        if (
          String(part.enemyUserId) === String(userId)
        ) {
          continue;
        }

        await tx.territoryEvent.create({
          data: {
            territoryId: newTerritoryId,

            userId,

            opponentUserId: part.enemyUserId,

            activityId,

            type: "CAPTURE",

            affectedAreaKm2: capturedAreaKm2,
          },
        });

        pendingNotifications.push({
          enemyUserId: part.enemyUserId,

          enemyTerritoryId: part.enemyTerritoryId,

          capturedAreaKm2,

          captureMethod: part.captureMethod,
        });
      }

      // --------------------------------------------------------
      // STEP 7: PRESERVE EMPTY TERRITORY RECORDS
      // --------------------------------------------------------
      //
      // Never delete fully captured territory records here.
      //
      // They may be referenced by:
      // - Activity history
      // - Territory events
      // - Other foreign keys
      //
      // Map and leaderboard queries should exclude:
      // - Empty boundaries
      // - Zero-area territories

      // --------------------------------------------------------
      // STEP 8: GET FINAL NEW TERRITORY AREA
      // --------------------------------------------------------

      const [updatedNewTerritory] = await tx.$queryRaw`
        SELECT
          "areaKm2"

        FROM territories

        WHERE id = ${newTerritoryId}

        LIMIT 1
      `;

      // --------------------------------------------------------
      // STEP 9: RETURN TRANSACTION RESULT
      // --------------------------------------------------------

      return {
        captured: pendingNotifications.length > 0,

        areaKm2: Number(
          updatedNewTerritory?.areaKm2 || 0
        ),

        // Number of opponent territory records captured.
        capturedCount: pendingNotifications.length,

        pendingNotifications,
      };
    },

    {
      maxWait: 10000,
      timeout: 30000,
    }
  );

  // ============================================================
  // STEP 10: SEND NOTIFICATIONS AFTER TRANSACTION
  // ============================================================
  //
  // Notifications should not block or roll back a successful
  // capture transaction.

  const {
    pendingNotifications,
    ...result
  } = transactionResult;

  if (pendingNotifications.length) {
    const notificationResults = await Promise.allSettled(
      pendingNotifications.map((part) => {
        const playerName =
          capturingUsername === "A player"
            ? capturingUsername
            : `@${capturingUsername}`;

        const fullTakeover =
          part.captureMethod === "FULL_ENCLOSURE";

        return createNotification({
          userId: part.enemyUserId,

          title: fullTakeover
            ? "Territory Taken Over"
            : "Territory Captured",

          message: fullTakeover
            ? `${playerName} captured your entire territory (${formatCapturedArea(part.capturedAreaKm2)}).`
            : `${playerName} captured ${formatCapturedArea(part.capturedAreaKm2)} of your territory.`,

          type: "TERRITORY_CAPTURED",

          territoryId: part.enemyTerritoryId,

          activityId,

          data: {
            capturedByUserId: String(userId),

            capturedByUsername:
              capturingUsername,

            capturedAreaKm2: String(
              part.capturedAreaKm2
            ),

            captureMethod: part.captureMethod,
          },
        });
      })
    );

    // ----------------------------------------------------------
    // LOG FAILED NOTIFICATIONS
    // ----------------------------------------------------------

    notificationResults.forEach((entry, index) => {
      if (
        entry.status === "rejected" ||
        entry.value == null
      ) {
        console.error(
          "TERRITORY_CAPTURE_NOTIFICATION_FAILED:",
          {
            enemyUserId:
              pendingNotifications[index].enemyUserId,

            error:
              entry.status === "rejected"
                ? entry.reason
                : "createNotification returned null",
          }
        );
      }
    });
  }

  // ============================================================
  // FINAL RESULT
  // ============================================================

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







export const getAllTerritories = async (req, res) => {
  const startTime = Date.now();

  try {
    // =========================================================
    // LIMIT
    // =========================================================

    // Example:
    // GET /api/territories?limit=100
    //
    // Default = 100
    // Maximum = 300

    const requestedLimit = parseInt(req.query.limit, 10);

    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 300)
        : 100;

    // =========================================================
    // FETCH TERRITORIES
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

        -- ============================
        -- CENTER
        -- ============================

        CASE
          WHEN t.center IS NULL THEN NULL
          ELSE ST_AsGeoJSON(t.center)::json
        END AS center,

        -- ============================
        -- BOUNDARY
        -- ============================

        ST_AsGeoJSON(
          ST_SimplifyPreserveTopology(
            CASE
              WHEN ST_IsValid(t.boundary)
                THEN t.boundary
              ELSE ST_MakeValid(t.boundary)
            END,

            -- Simplification tolerance
            0.00001
          )
        )::json AS boundary

      FROM territories t

      JOIN users u
        ON u.id = t."userId"

      LEFT JOIN activities a
        ON a.id = t."activityId"

      WHERE
        t.boundary IS NOT NULL

        AND NOT ST_IsEmpty(t.boundary)

        AND (
          a."include_in_clan" IS NULL
          OR a."include_in_clan" = false
        )

      ORDER BY
        t."updatedAt" DESC,
        t.id DESC

      LIMIT ${limit};
    `;

    console.log(
      `Territory SQL finished in ${
        (Date.now() - startTime) / 1000
      } seconds`,
    );

    // =========================================================
    // ASSIGN COLORS TO USERS
    // =========================================================

    const seenUsers = new Set();

    for (const territory of territoryRows) {
      seenUsers.add(territory.userId);
    }

    const userColorMap = {};

    let colorIndex = 0;

    for (const userId of seenUsers) {
      userColorMap[userId] =
        TERRITORY_COLORS[
          Math.min(
            colorIndex,
            TERRITORY_COLORS.length - 1,
          )
        ];

      colorIndex++;
    }

    // =========================================================
    // FORMAT RESPONSE
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

      areaKm2: Number(t.areaKm2),

      capturedAt: t.capturedAt,

      createdAt: t.createdAt,

      updatedAt: t.updatedAt,

      geojson: t.boundary,

      center: t.center,

      routeEncoded: t.routeEncoded,

      routeSegmentsEncoded:
        t.routeSegmentsEncoded ?? [],

      color:
        userColorMap[t.userId] ??
        TERRITORY_COLORS[
          TERRITORY_COLORS.length - 1
        ],
    }));

    // =========================================================
    // RESPONSE
    // =========================================================

    const totalTime =
      (Date.now() - startTime) / 1000;

    console.log(
      `GET ALL TERRITORIES completed in ${totalTime} seconds`,
    );

    return res.status(200).json({
      success: true,

      count: territories.length,

      territories,

      processingTime: `${totalTime}s`,
    });
  } catch (error) {
    console.error(
      'GET_ALL_TERRITORIES ERROR:',
      error,
    );

    console.error(
      `Failed after ${
        (Date.now() - startTime) / 1000
      } seconds`,
    );

    return res.status(500).json({
      success: false,

      message: 'Failed to fetch territories',

      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined,
    });
  }
};






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






// export const getAllTerritories = async (req, res) => {
//   const startTime = Date.now();

//   try {
//     // ============================================================
//     // STEP 1: PAGINATION LIMIT
//     // ============================================================

//     const requestedLimit = Number.parseInt(
//       req.query.limit,
//       10
//     );

//     const limit =
//       Number.isInteger(requestedLimit) &&
//       requestedLimit > 0
//         ? Math.min(requestedLimit, 300)
//         : 100;

//     // ============================================================
//     // STEP 2: FETCH AND RESOLVE VISIBLE TERRITORIES
//     // ============================================================
//     //
//     // DURO TERRITORY DISPLAY RULES
//     //
//     // 1. Newer territory takes priority over older territory.
//     //
//     // 2. If a newer territory overlaps an older territory,
//     //    remove that overlapping area from the older
//     //    territory's visible polygon.
//     //
//     // 3. If a territory is completely covered, hide it.
//     //
//     // 4. If partially covered, show only its remaining area.
//     //
//     // 5. No 24-hour restriction.
//     //
//     // 6. Same rules apply across different users.
//     //
//     // 7. Older territories belonging to the same user
//     //    also lose overlapping visible portions.
//     //
//     // 8. Only personal territories are returned.
//     //    Club territories remain separate.
//     //
//     // 9. Existing database boundaries are not modified.
//     //
//     // 10. Preserve Polygon and MultiPolygon holes.
//     //
//     // IMPORTANT:
//     // capturedAt / createdAt determine precedence.
//     // updatedAt is NOT used because an old territory
//     // can be modified by a newer capture.

//     const territoryRows = await prisma.$queryRaw`
//       WITH selected_territories AS MATERIALIZED (
//         SELECT
//           t.id,
//           t."userId",
//           t."activityId",
//           t.name,
//           t."capturedAt",
//           t."createdAt",
//           t."updatedAt",
//           t.boundary,
//           t."routeEncoded",
//           t."routeSegmentsEncoded",

//           u.username,
//           u.full_name AS "fullName",

//           COALESCE(
//             a."include_in_clan",
//             false
//           ) AS in_clan

//         FROM territories t

//         JOIN users u
//           ON u.id = t."userId"

//         LEFT JOIN activities a
//           ON a.id = t."activityId"

//         WHERE
//           t.boundary IS NOT NULL

//           AND NOT ST_IsEmpty(t.boundary)

//           AND COALESCE(
//             a."include_in_clan",
//             false
//           ) = false

//         ORDER BY
//           t."createdAt" DESC,
//           t.id::text DESC

//         LIMIT ${limit}
//       ),

//       -- ==========================================================
//       -- STEP 3: PREPARE POLYGON GEOMETRIES
//       -- ==========================================================
//       --
//       -- Fix invalid geometry and keep only polygonal components.
//       -- This supports both Polygon and MultiPolygon boundaries.
//       --
//       -- This does not update the stored geometry.

//       prepared_territories AS (
//         SELECT
//           t.*,

//           ST_Multi(
//             ST_CollectionExtract(
//               ST_MakeValid(t.boundary),
//               3
//             )
//           ) AS valid_boundary

//         FROM selected_territories t
//       ),

//       -- ==========================================================
//       -- STEP 4: FIND NEWER OVERLAPPING TERRITORIES
//       -- ==========================================================
//       --
//       -- For each selected territory:
//       --
//       -- Find ALL newer territories that overlap it.
//       --
//       -- These newer territories may belong to:
//       -- - The same user
//       -- - Different users
//       --
//       -- Only territories from the same capture mode
//       -- are considered.
//       --
//       -- Use the raw stored polygon of newer territories
//       -- when calculating overlap.
//       --
//       -- The newer territories are not restricted to the
//       -- selected result limit.

//       clipped_territories AS (
//         SELECT
//           t.*,

//           ST_Multi(
//             ST_CollectionExtract(
//               ST_MakeValid(
//                 CASE
//                   WHEN newer.newer_union IS NULL
//                   THEN t.valid_boundary

//                   ELSE ST_Difference(
//                     t.valid_boundary,
//                     newer.newer_union
//                   )
//                 END
//               ),
//               3
//             )
//           ) AS visible_boundary

//         FROM prepared_territories t

//         LEFT JOIN LATERAL (
//           SELECT
//             ST_UnaryUnion(
//               ST_Collect(
//                 ST_CollectionExtract(
//                   ST_MakeValid(n.boundary),
//                   3
//                 )
//               )
//             ) AS newer_union

//           FROM territories n

//           LEFT JOIN activities na
//             ON na.id = n."activityId"

//           WHERE
//             n.id <> t.id

//             AND n.boundary IS NOT NULL

//             AND NOT ST_IsEmpty(n.boundary)

//             AND COALESCE(
//               na."include_in_clan",
//               false
//             ) = t.in_clan

//             -- Newer territory has priority.
//             AND (
//               n."createdAt" > t."createdAt"

//               OR (
//                 n."createdAt" = t."createdAt"

//                 AND n.id::text > t.id::text
//               )
//             )

//             -- Bounding box check for spatial index.
//             AND n.boundary && t.boundary

//             -- Exact geometry intersection check.
//             AND ST_Intersects(
//               n.boundary,
//               t.boundary
//             )

//         ) newer ON TRUE
//       ),

//       -- ==========================================================
//       -- STEP 5: REMOVE EMPTY TERRITORIES
//       -- ==========================================================
//       --
//       -- A fully captured territory will have no visible area.
//       --
//       -- Do not send empty polygons to Flutter.

//       visible_territories AS (
//         SELECT
//           t.*

//         FROM clipped_territories t

//         WHERE
//           t.visible_boundary IS NOT NULL

//           AND NOT ST_IsEmpty(
//             t.visible_boundary
//           )
//       ),

//       -- ==========================================================
//       -- STEP 6: CALCULATE FINAL VISIBLE AREAS
//       -- ==========================================================
//       --
//       -- Calculate area based on the visible polygon,
//       -- not the original stored territory area.
//       --
//       -- This ensures the API reflects only visible land.

//       measured_territories AS (
//         SELECT
//           t.*,

//           ST_Area(
//             t.visible_boundary::geography
//           ) AS visible_area_m2

//         FROM visible_territories t
//       )

//       -- ==========================================================
//       -- STEP 7: RETURN FINAL TERRITORY GEOMETRIES
//       -- ==========================================================
//       --
//       -- IMPORTANT:
//       --
//       -- Do not simplify each polygon independently.
//       --
//       -- Simplification may reintroduce small overlaps
//       -- or gaps between neighboring boundaries.
//       --
//       -- The returned GeoJSON may contain interior rings
//       -- representing holes.
//       --
//       -- Flutter must render those holes correctly.

//       SELECT
//         t.id,

//         t."userId",

//         t."activityId",

//         t.name,

//         t.visible_area_m2 / 1000000.0
//           AS "areaKm2",

//         t."capturedAt",

//         t."createdAt",

//         t."updatedAt",

//         t.username,

//         t."fullName",

//         t."routeEncoded",

//         t."routeSegmentsEncoded",

//         ST_AsGeoJSON(
//           ST_PointOnSurface(
//             t.visible_boundary
//           )
//         )::json AS center,

//         ST_AsGeoJSON(
//           t.visible_boundary
//         )::json AS boundary

//       FROM measured_territories t

//       WHERE t.visible_area_m2 > 0

//       ORDER BY
//         t."createdAt" DESC,
//         t.id::text DESC
//     `;

//     const sqlTime =
//       (Date.now() - startTime) / 1000;

//     console.log(
//       `Territory SQL finished in ${sqlTime}s`
//     );

//     // ============================================================
//     // STEP 8: ASSIGN USER COLORS
//     // ============================================================
//     //
//     // Retain existing DURO color behavior.
//     //
//     // Each user receives the same color for all
//     // returned territories belonging to that user.

//     const seenUsers = new Set();

//     for (const territory of territoryRows) {
//       seenUsers.add(String(territory.userId));
//     }

//     const userColorMap = {};

//     let colorIndex = 0;

//     for (const id of seenUsers) {
//       userColorMap[id] =
//         TERRITORY_COLORS[
//           Math.min(
//             colorIndex,
//             TERRITORY_COLORS.length - 1
//           )
//         ];

//       colorIndex++;
//     }

//     // ============================================================
//     // STEP 9: FORMAT TERRITORIES
//     // ============================================================
//     //
//     // Keep response structure compatible with the
//     // current DURO Flutter application.

//     const territories = territoryRows.map((t) => {
//       const ownerId = String(t.userId);

//       return {
//         id: t.id,

//         userId: t.userId,

//         activityId: t.activityId,

//         name: t.name,

//         owner: {
//           username: t.username,
//           fullName: t.fullName,
//         },

//         // Visible territory area after clipping.
//         areaKm2: Number(t.areaKm2 || 0),

//         capturedAt: t.capturedAt,

//         createdAt: t.createdAt,

//         updatedAt: t.updatedAt,

//         // Clipped visible Polygon/MultiPolygon.
//         geojson: t.boundary,

//         // Center of visible owned area.
//         center: t.center,

//         routeEncoded: t.routeEncoded,

//         routeSegmentsEncoded:
//           t.routeSegmentsEncoded ?? [],

//         color:
//           userColorMap[ownerId] ??
//           TERRITORY_COLORS[
//             TERRITORY_COLORS.length - 1
//           ],
//       };
//     });

//     // ============================================================
//     // STEP 10: DEBUG LOGGING
//     // ============================================================

//     console.log(
//       "GET_ALL_TERRITORIES:",
//       {
//         count: territories.length,

//         polygons: territories.filter(
//           (t) => t.geojson?.type === "Polygon"
//         ).length,

//         multiPolygons: territories.filter(
//           (t) => t.geojson?.type === "MultiPolygon"
//         ).length,

//         durationSeconds:
//           (Date.now() - startTime) / 1000,
//       }
//     );

//     // ============================================================
//     // STEP 11: SEND RESPONSE
//     // ============================================================

//     const totalTime =
//       (Date.now() - startTime) / 1000;

//     console.log(
//       `GET ALL TERRITORIES completed in ${totalTime}s`
//     );

//     return res.status(200).json({
//       success: true,

//       count: territories.length,

//       territories,

//       processingTime: `${totalTime}s`,
//     });

//   } catch (error) {
//     // ============================================================
//     // ERROR HANDLING
//     // ============================================================

//     console.error(
//       "GET_ALL_TERRITORIES ERROR:",
//       error
//     );

//     console.error(
//       `Failed after ${
//         (Date.now() - startTime) / 1000
//       } seconds`
//     );

//     return res.status(500).json({
//       success: false,

//       message: "Failed to fetch territories",

//       error:
//         process.env.NODE_ENV === "development"
//           ? error.message
//           : undefined,
//     });
//   }
// };





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