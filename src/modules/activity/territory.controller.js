import prisma from '../../config/prisma.js';

// ─────────────────────────────────────────────
// Capture Enemy Territories
// ─────────────────────────────────────────────
export const captureTerritory = async ({ userId, activityId, newTerritoryId }) => {

  const enemyTerritories = await prisma.$queryRawUnsafe(`
    WITH current_territory AS (
      SELECT boundary FROM territories WHERE id = '${newTerritoryId}' LIMIT 1
    )
    SELECT t.id, t."userId", ST_AsText(t.boundary) AS boundary
    FROM territories t
    WHERE
      t."userId" != '${userId}'
      AND ST_Intersects(t.boundary, (SELECT boundary FROM current_territory));
  `);

  for (const enemy of enemyTerritories) {

    const overlap = await prisma.$queryRawUnsafe(`
      WITH attacker AS (SELECT boundary FROM territories WHERE id = '${newTerritoryId}'),
           defender AS (SELECT boundary FROM territories WHERE id = '${enemy.id}')
      SELECT
        ST_AsText(ST_Intersection((SELECT boundary FROM attacker), (SELECT boundary FROM defender))) AS overlap_wkt,
        ST_Area(ST_Intersection((SELECT boundary FROM attacker), (SELECT boundary FROM defender))::geography) / 1000000 AS overlap_area;
    `);

    if (!overlap[0]?.overlap_wkt) continue;

    const overlapWKT = overlap[0].overlap_wkt;
    const overlapArea = overlap[0].overlap_area;

    await prisma.$executeRawUnsafe(`
      UPDATE territories
      SET
        boundary = ST_Difference(boundary, ST_GeomFromText('${overlapWKT}', 4326)),
        "areaKm2" = ST_Area(ST_Difference(boundary, ST_GeomFromText('${overlapWKT}', 4326))::geography) / 1000000,
        "updatedAt" = NOW()
      WHERE id = '${enemy.id}';
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE territories
      SET
        boundary = ST_Union(boundary, ST_GeomFromText('${overlapWKT}', 4326)),
        "areaKm2" = ST_Area(ST_Union(boundary, ST_GeomFromText('${overlapWKT}', 4326))::geography) / 1000000,
        "updatedAt" = NOW()
      WHERE id = '${newTerritoryId}';
    `);

    await prisma.territoryEvent.create({
      data: { territoryId: newTerritoryId, userId, opponentUserId: enemy.userId, activityId, type: 'CAPTURE', affectedAreaKm2: overlapArea },
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM territories
      WHERE id = '${enemy.id}' AND (boundary IS NULL OR ST_IsEmpty(boundary) OR "areaKm2" <= 0.00001);
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
// ─────────────────────────────────────────────
export const getAllTerritories = async (req, res) => {
  try {
    // ── Get Territories + Activity Route ──────────────────────
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
        u.full_name AS "fullName",

        a."routeEncoded"

      FROM territories t

      JOIN users u
        ON u.id = t."userId"

      LEFT JOIN activities a
        ON a.id = t."activityId"

      ORDER BY t."capturedAt" DESC;
    `;

    // ── Calculate Total Area Per User ─────────────────────────
    const userAreaMap = {};

    for (const territory of territoryRows) {
      userAreaMap[territory.userId] =
        (userAreaMap[territory.userId] || 0) +
        Number(territory.areaKm2);
    }

    // ── Assign Colors Based On Rank ───────────────────────────
    const userColorMap = Object.fromEntries(
      Object.entries(userAreaMap)
        .sort((a, b) => b[1] - a[1])
        .map(([userId], index) => [
          userId,
          TERRITORY_COLORS[
            Math.min(index, TERRITORY_COLORS.length - 1)
          ],
        ])
    );

    // ── Format Response ───────────────────────────────────────
    const territories = territoryRows.map((territory) => ({
      id: territory.id,

      userId: territory.userId,

      activityId: territory.activityId,

      name: territory.name,

      owner: {
        username: territory.username,
        fullName: territory.fullName,
      },

      areaKm2: Number(territory.areaKm2),

      capturedAt: territory.capturedAt,
      createdAt: territory.createdAt,
      updatedAt: territory.updatedAt,

      geojson: territory.boundary,

      center: territory.center,

      // ── Activity Route ──────────────────────────────────────
      routeEncoded: territory.routeEncoded,

      color:
        userColorMap[territory.userId] ??
        TERRITORY_COLORS[TERRITORY_COLORS.length - 1],
    }));

    // ── Success Response ──────────────────────────────────────
    return res.status(200).json({
      success: true,
      count: territories.length,
      territories,
    });

  } catch (error) {

    // ── Error ─────────────────────────────────────────────────
    console.error("GET_ALL_TERRITORIES ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch territories",
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
