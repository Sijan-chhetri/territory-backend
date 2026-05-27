import prisma from '../../config/prisma.js';
import polylineLib from '@mapbox/polyline';

// ─────────────────────────────────────────────
// Re-encode a PostGIS geometry back to Google polyline
// Rounds to 5dp to avoid precision artifacts (? chars)
// ─────────────────────────────────────────────
async function reEncodeRoute(territoryId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT ST_AsGeoJSON(
      ST_SnapToGrid("routeGeometry", 0.00001)
    )::json AS route
    FROM territories
    WHERE id = '${territoryId}'
      AND "routeGeometry" IS NOT NULL
    LIMIT 1;
  `);

  if (!rows[0]?.route) return null;

  const geojson = rows[0].route;

  const round = (n) => Math.round(n * 1e5) / 1e5;

  let coords = [];

  if (geojson.type === 'LineString') {
    coords = geojson.coordinates.map(([lng, lat]) => [round(lat), round(lng)]);
  } else if (geojson.type === 'MultiLineString') {
    // encode each segment separately and join — keeps segments intact
    const segments = geojson.coordinates
      .filter((seg) => seg.length >= 2)
      .map((seg) => seg.map(([lng, lat]) => [round(lat), round(lng)]));

    if (segments.length === 0) return null;
    if (segments.length === 1) {
      coords = segments[0];
    } else {
      // encode each segment and concatenate the polylines
      return segments.map((seg) => polylineLib.encode(seg)).join('');
    }
  }

  if (coords.length < 2) return null;
  return polylineLib.encode(coords);
}

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

    // ── Clip enemy route: remove the portion that now falls inside attacker's territory
    await prisma.$executeRawUnsafe(`
      UPDATE territories
      SET
        "routeGeometry" = CASE
          WHEN "routeGeometry" IS NOT NULL
            AND ST_Intersects(
              "routeGeometry",
              (SELECT boundary FROM territories WHERE id = '${newTerritoryId}')
            )
          THEN ST_Difference(
            "routeGeometry",
            (SELECT boundary FROM territories WHERE id = '${newTerritoryId}')
          )
          ELSE "routeGeometry"
        END,
        "updatedAt" = NOW()
      WHERE id = '${enemy.id}';
    `);

    // Re-encode the clipped enemy route back to Google polyline and save
    const clippedEncoded = await reEncodeRoute(enemy.id);
    if (clippedEncoded !== null) {
      await prisma.$executeRawUnsafe(`
        UPDATE territories
        SET "routeEncoded" = '${clippedEncoded.replace(/'/g, "''")}'
        WHERE id = '${enemy.id}';
      `);
    }

    // ── Clip attacker route: remove sections that still fall inside enemy's remaining boundary
    // (enemy may still own parts of the area the attacker passed through)
    await prisma.$executeRawUnsafe(`
      UPDATE territories
      SET
        "routeGeometry" = CASE
          WHEN "routeGeometry" IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM territories
              WHERE id = '${enemy.id}'
                AND boundary IS NOT NULL
                AND NOT ST_IsEmpty(boundary)
            )
            AND ST_Intersects(
              "routeGeometry",
              (SELECT boundary FROM territories WHERE id = '${enemy.id}')
            )
          THEN ST_Difference(
            "routeGeometry",
            (SELECT boundary FROM territories WHERE id = '${enemy.id}')
          )
          ELSE "routeGeometry"
        END,
        "updatedAt" = NOW()
      WHERE id = '${newTerritoryId}';
    `);

    // Re-encode the attacker's updated route
    const attackerEncoded = await reEncodeRoute(newTerritoryId);
    if (attackerEncoded !== null) {
      await prisma.$executeRawUnsafe(`
        UPDATE territories
        SET "routeEncoded" = '${attackerEncoded.replace(/'/g, "''")}'
        WHERE id = '${newTerritoryId}';
      `);
    }
  }
};


// ─────────────────────────────────────────────
// Color palette — ranked by territory size
// index 0 = biggest (blue), last = smallest (yellow)
// ─────────────────────────────────────────────
const TERRITORY_COLORS = [
  { fill: 'rgba(37,  99, 235, 0.38)', border: 'rgba(30,  64, 175, 1)' }, // deep blue
  { fill: 'rgba(22, 163,  74, 0.38)', border: 'rgba(21, 128,  61, 1)' }, // deep green
  { fill: 'rgba(220,  38,  38, 0.38)', border: 'rgba(153,  27,  27, 1)' }, // deep red
  { fill: 'rgba(147,  51, 234, 0.38)', border: 'rgba(107,  33, 168, 1)' }, // deep purple
  { fill: 'rgba(234,  88,  12, 0.38)', border: 'rgba(154,  52,  18, 1)' }, // deep orange
  { fill: 'rgba(219,  39, 119, 0.38)', border: 'rgba(157,  23,  77, 1)' }, // deep pink
  { fill: 'rgba(75,   85,  99, 0.38)', border: 'rgba(55,   65,  81, 1)' }, // deep gray
  { fill: 'rgba(202, 138,   4, 0.38)', border: 'rgba(133,  77,  14, 1)' }, // deep yellow
];

// ─────────────────────────────────────────────
// Get All Territories (map view)
// GET /api/territories/all
// ─────────────────────────────────────────────
export const getAllTerritories = async (req, res) => {
  try {
    // Single query: for each territory, subtract all newer territories'
    // boundaries so every geographic point shows only the most recent owner.
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
          u.full_name        AS "fullName",
          t."routeEncoded",
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
          -- subtract all newer territories from this one
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
        center,
        ST_AsGeoJSON(clipped_boundary)::json AS boundary
      FROM clipped
      WHERE clipped_boundary IS NOT NULL
        AND NOT ST_IsEmpty(clipped_boundary)
      ORDER BY "updatedAt" DESC;
    `;

    // Assign a stable color per userId (first-seen = newest territory owner)
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

    const territories = territoryRows.map((t) => ({
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
      error: error.message,
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
    const { routeEncoded } = req.body;

    if (!routeEncoded) {
      return res.status(400).json({ success: false, message: 'routeEncoded is required' });
    }

    // Verify ownership
    const territory = await prisma.territory.findUnique({ where: { id } });
    if (!territory) return res.status(404).json({ success: false, message: 'Territory not found' });
    if (territory.userId !== userId) return res.status(403).json({ success: false, message: 'Forbidden' });

    // Decode Google polyline → LINESTRING WKT
    const decoded = polylineLib.decode(routeEncoded);
    if (!decoded || decoded.length < 2) {
      return res.status(400).json({ success: false, message: 'routeEncoded must decode to at least 2 points' });
    }

    const lineString = decoded.map(([lat, lng]) => `${lng} ${lat}`).join(',');
    const routeWKT   = `LINESTRING(${lineString})`;

    // Save routeEncoded + routeGeometry
    await prisma.$executeRawUnsafe(`
      UPDATE territories
      SET
        "routeEncoded"  = '${routeEncoded.replace(/'/g, "''")}',
        "routeGeometry" = ST_SetSRID(ST_GeomFromText('${routeWKT}'), 4326),
        "updatedAt"     = NOW()
      WHERE id = '${id}';
    `);

    const updated = await prisma.$queryRawUnsafe(`
      SELECT
        id, "userId", "activityId", "areaKm2", "capturedAt", "updatedAt",
        "routeEncoded",
        ST_AsGeoJSON(boundary)::json      AS boundary,
        ST_AsGeoJSON("routeGeometry")::json AS route
      FROM territories
      WHERE id = '${id}'
      LIMIT 1;
    `);

    return res.status(200).json({ success: true, territory: updated[0] });

  } catch (error) {
    console.error('UPDATE_TERRITORY_ROUTE ERROR:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};
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
