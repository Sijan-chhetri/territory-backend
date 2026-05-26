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
  { fill: 'rgba(59,  130, 246, 0.28)', border: 'rgba(59,  130, 246, 1)' }, // blue
  { fill: 'rgba(34,  197,  94, 0.28)', border: 'rgba(34,  197,  94, 1)' }, // green
  { fill: 'rgba(239,  68,  68, 0.28)', border: 'rgba(239,  68,  68, 1)' }, // red
  { fill: 'rgba(168,  85, 247, 0.28)', border: 'rgba(168,  85, 247, 1)' }, // purple
  { fill: 'rgba(249, 115,  22, 0.28)', border: 'rgba(249, 115,  22, 1)' }, // orange
  { fill: 'rgba(236,  72, 153, 0.28)', border: 'rgba(236,  72, 153, 1)' }, // pink
  { fill: 'rgba(107, 114, 128, 0.28)', border: 'rgba(107, 114, 128, 1)' }, // gray
  { fill: 'rgba(234, 179,   8, 0.28)', border: 'rgba(234, 179,   8, 1)' }, // yellow
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
          a."routeEncoded",
          ROW_NUMBER() OVER (ORDER BY t."updatedAt" DESC) AS rn
        FROM territories t
        JOIN users u ON u.id = t."userId"
        LEFT JOIN activities a ON a.id = t."activityId"
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
