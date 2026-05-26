import prisma from '../../config/prisma.js';

// ─────────────────────────────────────────────
// Capture Enemy Territories
//
// When user2 runs over user1's rectangle territory:
//   1. Compute the intersection (the stolen area)
//   2. Subtract it from user1's boundary (ST_Difference)
//   3. Add it to user2's boundary (ST_Union)
//   4. Delete user1's territory if it becomes empty
// ─────────────────────────────────────────────
export const captureTerritory = async ({ userId, activityId, newTerritoryId }) => {

  // Find all enemy territories that overlap the new territory
  const enemyTerritories = await prisma.$queryRawUnsafe(`
    WITH current_territory AS (
      SELECT boundary FROM territories WHERE id = '${newTerritoryId}' LIMIT 1
    )
    SELECT t.id, t."userId"
    FROM territories t
    WHERE
      t."userId" != '${userId}'
      AND ST_Intersects(t.boundary, (SELECT boundary FROM current_territory))
      AND NOT ST_IsEmpty(ST_Intersection(t.boundary, (SELECT boundary FROM current_territory)));
  `);

  for (const enemy of enemyTerritories) {

    // Compute the overlapping area (what gets stolen)
    const overlap = await prisma.$queryRawUnsafe(`
      WITH attacker AS (SELECT boundary FROM territories WHERE id = '${newTerritoryId}'),
           defender AS (SELECT boundary FROM territories WHERE id = '${enemy.id}')
      SELECT
        ST_AsText(
          ST_Intersection(
            (SELECT boundary FROM attacker),
            (SELECT boundary FROM defender)
          )
        ) AS overlap_wkt,
        ST_Area(
          ST_Intersection(
            (SELECT boundary FROM attacker),
            (SELECT boundary FROM defender)
          )::geography
        ) / 1000000 AS overlap_area;
    `);

    if (!overlap[0]?.overlap_wkt || overlap[0].overlap_area < 0.000001) continue;

    const overlapWKT  = overlap[0].overlap_wkt;
    const overlapArea = Number(overlap[0].overlap_area);

    // ── Subtract stolen area from enemy territory FIRST
    await prisma.$executeRawUnsafe(`
      UPDATE territories
      SET
        boundary = ST_Buffer(
          ST_SnapToGrid(
            ST_Difference(
              boundary,
              ST_GeomFromText('${overlapWKT}', 4326)
            ),
            0.0000001
          ),
          0
        ),
        "areaKm2" = GREATEST(0, ST_Area(
          ST_Buffer(
            ST_SnapToGrid(
              ST_Difference(
                boundary,
                ST_GeomFromText('${overlapWKT}', 4326)
              ),
              0.0000001
            ),
            0
          )::geography
        ) / 1000000),
        "updatedAt" = NOW()
      WHERE id = '${enemy.id}';
    `);

    // ── Add stolen area to attacker territory AFTER enemy is trimmed
    await prisma.$executeRawUnsafe(`
      UPDATE territories
      SET
        boundary = ST_Buffer(
          ST_SnapToGrid(
            ST_Union(
              boundary,
              ST_GeomFromText('${overlapWKT}', 4326)
            ),
            0.0000001
          ),
          0
        ),
        "areaKm2" = ST_Area(
          ST_Buffer(
            ST_SnapToGrid(
              ST_Union(
                boundary,
                ST_GeomFromText('${overlapWKT}', 4326)
              ),
              0.0000001
            ),
            0
          )::geography
        ) / 1000000,
        "updatedAt" = NOW()
      WHERE id = '${newTerritoryId}';
    `);

    // ── Record the capture event
    await prisma.territoryEvent.create({
      data: {
        territoryId:    newTerritoryId,
        userId,
        opponentUserId: enemy.userId,
        activityId,
        type:           'CAPTURE',
        affectedAreaKm2: overlapArea,
      },
    });

    // ── Delete enemy territory if it's now empty
    await prisma.$executeRawUnsafe(`
      DELETE FROM territories
      WHERE
        id = '${enemy.id}'
        AND (
          boundary IS NULL
          OR ST_IsEmpty(boundary)
          OR "areaKm2" <= 0.000001
        );
    `);
  }
};


// ─────────────────────────────────────────────
// Color palette — ranked by territory size
// index 0 = biggest (blue), last = smallest (yellow)
// ─────────────────────────────────────────────
const TERRITORY_COLORS = [
  { fill: 'rgba(59,  130, 246, 0.25)', border: 'rgba(59,  130, 246, 0.6)' }, // blue
  { fill: 'rgba(34,  197,  94, 0.25)', border: 'rgba(34,  197,  94, 0.6)' }, // green
  { fill: 'rgba(239,  68,  68, 0.25)', border: 'rgba(239,  68,  68, 0.6)' }, // red
  { fill: 'rgba(168,  85, 247, 0.25)', border: 'rgba(168,  85, 247, 0.6)' }, // purple
  { fill: 'rgba(249, 115,  22, 0.25)', border: 'rgba(249, 115,  22, 0.6)' }, // orange
  { fill: 'rgba(236,  72, 153, 0.25)', border: 'rgba(236,  72, 153, 0.6)' }, // pink
  { fill: 'rgba(107, 114, 128, 0.25)', border: 'rgba(107, 114, 128, 0.6)' }, // gray
  { fill: 'rgba(234, 179,   8, 0.25)', border: 'rgba(234, 179,   8, 0.6)' }, // yellow
];


// ─────────────────────────────────────────────
// Get All Territories (map view)
// GET /api/territories/all
//
// Color logic:
// - Each territory row gets a color based on its position in the
//   TERRITORY_COLORS palette, assigned by order of first appearance (userId).
// - If two territory rows overlap (capture sliver), the more recently
//   updated row wins — the older row's geometry is clipped server-side
//   so the frontend never renders two colors on the same zone.
// ─────────────────────────────────────────────
export const getAllTerritories = async (req, res) => {
  try {
    // Fetch territories ordered newest first (most recent owner wins disputes)
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
        t.boundary                     AS boundary_raw,
        ST_AsGeoJSON(t.boundary)::json AS boundary,
        ST_AsGeoJSON(t.center)::json   AS center,
        u.username,
        u.full_name AS "fullName",
        a."routeEncoded"
      FROM territories t
      JOIN users u ON u.id = t."userId"
      LEFT JOIN activities a ON a.id = t."activityId"
      WHERE t.boundary IS NOT NULL
        AND NOT ST_IsEmpty(t.boundary)
      ORDER BY t."updatedAt" DESC;
    `;

    // ── Assign a stable color per userId (first-seen order)
    const seenUsers = [];
    for (const t of territoryRows) {
      if (!seenUsers.includes(t.userId)) seenUsers.push(t.userId);
    }
    const userColorMap = Object.fromEntries(
      seenUsers.map((userId, index) => [
        userId,
        TERRITORY_COLORS[Math.min(index, TERRITORY_COLORS.length - 1)],
      ])
    );

    // ── Clip overlapping zones: process newest → oldest.
    // Each territory claims its area. Any older territory that overlaps
    // an already-claimed zone gets that zone subtracted from its geojson
    // before sending to the frontend. This is purely a display fix —
    // the DB geometry is unchanged.
    const claimedWKTs = []; // array of WKT strings already claimed
    const result = [];

    for (const t of territoryRows) {
      if (!t.boundary) continue;

      // Check if this territory overlaps any already-claimed zone
      if (claimedWKTs.length > 0) {
        // Build union of all claimed zones and subtract from this territory's geojson
        const clippedRows = await prisma.$queryRawUnsafe(`
          WITH this_geom AS (
            SELECT boundary FROM territories WHERE id = '${t.id}'
          ),
          claimed AS (
            SELECT ST_Union(ARRAY[${claimedWKTs.map((w) => `ST_GeomFromText('${w}', 4326)`).join(',')}]) AS geom
          ),
          clipped AS (
            SELECT
              CASE
                WHEN ST_Intersects((SELECT boundary FROM this_geom), (SELECT geom FROM claimed))
                THEN ST_Difference((SELECT boundary FROM this_geom), (SELECT geom FROM claimed))
                ELSE (SELECT boundary FROM this_geom)
              END AS final_geom
          )
          SELECT
            ST_AsGeoJSON(final_geom)::json AS geojson,
            ST_IsEmpty(final_geom) AS is_empty
          FROM clipped;
        `);

        const clipped = clippedRows[0];
        if (clipped.is_empty) continue; // fully consumed by newer territories

        result.push({
          id:          t.id,
          userId:      t.userId,
          activityId:  t.activityId,
          name:        t.name,
          owner:       { username: t.username, fullName: t.fullName },
          areaKm2:     Number(t.areaKm2),
          capturedAt:  t.capturedAt,
          createdAt:   t.createdAt,
          updatedAt:   t.updatedAt,
          geojson:     clipped.geojson,
          center:      t.center,
          routeEncoded: t.routeEncoded,
          color:       userColorMap[t.userId] ?? TERRITORY_COLORS[TERRITORY_COLORS.length - 1],
        });
      } else {
        result.push({
          id:          t.id,
          userId:      t.userId,
          activityId:  t.activityId,
          name:        t.name,
          owner:       { username: t.username, fullName: t.fullName },
          areaKm2:     Number(t.areaKm2),
          capturedAt:  t.capturedAt,
          createdAt:   t.createdAt,
          updatedAt:   t.updatedAt,
          geojson:     t.boundary,
          center:      t.center,
          routeEncoded: t.routeEncoded,
          color:       userColorMap[t.userId] ?? TERRITORY_COLORS[TERRITORY_COLORS.length - 1],
        });
      }

      // Mark this territory's area as claimed (use WKT for SQL reuse)
      const wktRow = await prisma.$queryRawUnsafe(`
        SELECT ST_AsText(boundary) AS wkt FROM territories WHERE id = '${t.id}';
      `);
      if (wktRow[0]?.wkt) claimedWKTs.push(wktRow[0].wkt);
    }

    return res.status(200).json({
      success: true,
      count: result.length,
      territories: result,
    });

  } catch (error) {
    console.error('GET_ALL_TERRITORIES ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch territories',
      error: error.message,
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

    return res.status(200).json({ success: true, events });

  } catch (error) {
    console.error('GET_TERRITORY_EVENTS ERROR:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
};
