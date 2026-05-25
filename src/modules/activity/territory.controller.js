const prisma = require('../../config/prisma');

exports.captureTerritory = async ({
  userId,
  activityId,
  newTerritoryId,
}) => {

  // ─────────────────────────────────────────
  // Find all enemy territories overlapping
  // ─────────────────────────────────────────

  const enemyTerritories = await prisma.$queryRawUnsafe(`
    WITH current_territory AS (
      SELECT boundary
      FROM territories
      WHERE id = '${newTerritoryId}'
      LIMIT 1
    )

    SELECT
      t.id,
      t."userId",
      ST_AsText(t.boundary) AS boundary
    FROM territories t
    WHERE
      t."userId" != '${userId}'
      AND ST_Intersects(
        t.boundary,
        (SELECT boundary FROM current_territory)
      );
  `);

  // ─────────────────────────────────────────
  // Loop enemy territories
  // ─────────────────────────────────────────

  for (const enemy of enemyTerritories) {

    // geometry stolen from enemy
    const overlap = await prisma.$queryRawUnsafe(`
      WITH attacker AS (
        SELECT boundary
        FROM territories
        WHERE id = '${newTerritoryId}'
      ),
      defender AS (
        SELECT boundary
        FROM territories
        WHERE id = '${enemy.id}'
      )

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

    if (!overlap[0]?.overlap_wkt) continue;

    const overlapWKT = overlap[0].overlap_wkt;
    const overlapArea = overlap[0].overlap_area;

    // ─────────────────────────────────────────
    // REMOVE captured area from enemy
    // ─────────────────────────────────────────

    await prisma.$executeRawUnsafe(`
      UPDATE territories
      SET
        boundary = ST_Difference(
          boundary,
          ST_GeomFromText('${overlapWKT}', 4326)
        ),

        "areaKm2" = ST_Area(
          ST_Difference(
            boundary,
            ST_GeomFromText('${overlapWKT}', 4326)
          )::geography
        ) / 1000000,

        "updatedAt" = NOW()

      WHERE id = '${enemy.id}';
    `);

    // ─────────────────────────────────────────
    // ADD captured geometry to attacker
    // ─────────────────────────────────────────

    await prisma.$executeRawUnsafe(`
      UPDATE territories
      SET
        boundary = ST_Union(
          boundary,
          ST_GeomFromText('${overlapWKT}', 4326)
        ),

        "areaKm2" = ST_Area(
          ST_Union(
            boundary,
            ST_GeomFromText('${overlapWKT}', 4326)
          )::geography
        ) / 1000000,

        "updatedAt" = NOW()

      WHERE id = '${newTerritoryId}';
    `);

    // ─────────────────────────────────────────
    // Create territory event
    // ─────────────────────────────────────────

    await prisma.territoryEvent.create({
      data: {
        territoryId: newTerritoryId,
        userId,
        opponentUserId: enemy.userId,
        activityId,
        type: 'CAPTURE',
        affectedAreaKm2: overlapArea,
      },
    });

    // ─────────────────────────────────────────
    // Delete empty enemy territory
    // ─────────────────────────────────────────

    await prisma.$executeRawUnsafe(`
      DELETE FROM territories
      WHERE
        id = '${enemy.id}'
        AND (
          boundary IS NULL
          OR ST_IsEmpty(boundary)
          OR "areaKm2" <= 0.00001
        );
    `);
  }
};


// ─────────────────────────────────────────────
// Color palette — ranked by territory size
// index 0 = biggest (blue), last = smallest (yellow)
// All colors are semi-transparent RGBA
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
exports.getAllTerritories = async (req, res) => {
  try {
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
        ST_AsGeoJSON(t.center)::json   AS center,
        u.username,
        u.full_name AS "fullName"
      FROM territories t
      JOIN users u ON u.id = t."userId"
      ORDER BY t."capturedAt" DESC;
    `;

    // ── Aggregate total area per user, rank largest → smallest
    const userAreaMap = {};
    for (const t of territoryRows) {
      userAreaMap[t.userId] = (userAreaMap[t.userId] || 0) + Number(t.areaKm2);
    }

    // Sort users by total area descending → assign color index
    const rankedUsers = Object.entries(userAreaMap)
      .sort((a, b) => b[1] - a[1])
      .map(([userId], index) => ({
        userId,
        color: TERRITORY_COLORS[Math.min(index, TERRITORY_COLORS.length - 1)],
      }));

    const userColorMap = Object.fromEntries(
      rankedUsers.map(({ userId, color }) => [userId, color])
    );

    const territories = territoryRows.map((t) => ({
      id:         t.id,
      userId:     t.userId,
      activityId: t.activityId,
      name:       t.name,
      owner: {
        username: t.username,
        fullName: t.fullName,
      },
      areaKm2:    Number(t.areaKm2),
      capturedAt: t.capturedAt,
      createdAt:  t.createdAt,
      updatedAt:  t.updatedAt,
      geojson:    t.boundary,
      center:     t.center,
      // ── Color for map rendering
      color:      userColorMap[t.userId] ?? TERRITORY_COLORS[TERRITORY_COLORS.length - 1],
    }));

    return res.status(200).json({ success: true, territories });

  } catch (error) {
    console.error('GET_ALL_TERRITORIES ERROR:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// Get Territory Events
// GET /api/territories/events
// ─────────────────────────────────────────────
exports.getTerritoryEvents = async (req, res) => {
  try {
    const userId = req.user.id;

    const events = await prisma.territoryEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.status(200).json({ success: true, events });

  } catch (error) {
    console.error('GET_TERRITORY_EVENTS ERROR:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
};
