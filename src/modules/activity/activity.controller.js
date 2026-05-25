import prisma from '../../config/prisma.js';
import { captureTerritory } from './territory.controller.js';
import { addXP } from '../xp/xp.service.js';
import { checkLevelUp } from '../level/level.service.js';
import { checkBadges } from '../badge/badge.service.js';


// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatPace(secPerKm) {
  if (secPerKm == null) return null;
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60).toString().padStart(2, '0');
  return `${mins}:${secs}/km`;
}

function computeKmSplits(coordinates) {
  if (!coordinates || coordinates.length < 2) return [];

  const toRad = (deg) => (deg * Math.PI) / 180;

  function haversine(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(h));
  }

  const splits = [];
  let kmCount = 0;
  let accDist = 0;
  let kmStartTime = new Date(coordinates[0].timestamp).getTime();

  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    accDist += haversine(prev, curr);

    while (accDist >= 1) {
      kmCount++;
      const timeSec = Math.round((new Date(curr.timestamp).getTime() - kmStartTime) / 1000);
      splits.push({ km: kmCount, timeSec, pace: timeSec, paceFormatted: formatPace(timeSec) });
      kmStartTime = new Date(curr.timestamp).getTime();
      accDist -= 1;
    }
  }

  return splits;
}


// ─────────────────────────────────────────────
// Get My Activities
// GET /api/activities/my
// ─────────────────────────────────────────────
export const getMyActivities = async (req, res) => {
  try {
    const activities = await prisma.activity.findMany({
      where: { userId: req.user.id },
      orderBy: { startedAt: 'desc' },
      include: { territories: true },
    });

    return res.status(200).json({ message: 'Activities loaded', activities });

  } catch (error) {
    console.error('GET_MY_ACTIVITIES ERROR:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};


// ─────────────────────────────────────────────
// Finish Activity
// POST /api/activities/finish
// ─────────────────────────────────────────────
export const finishActivity = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      mode, distanceKm, durationSec, stopTime, elapsedTime, movingTime,
      avgPace, topPace, avgSpeed, topSpeed, calories, elevationGain,
      startedAt, endedAt, routeEncoded,
      coordinates,
      kmSplits: clientKmSplits,
    } = req.body;

    if (!coordinates || coordinates.length < 2) {
      return res.status(400).json({ message: 'Not enough GPS points' });
    }

    const kmSplits = (clientKmSplits?.length > 0) ? clientKmSplits : computeKmSplits(coordinates);

    const lineString = coordinates.map((p) => `${p.lng} ${p.lat}`).join(',');
    const routeWKT = `LINESTRING(${lineString})`;

    const activity = await prisma.activity.create({
      data: {
        userId, mode, distanceKm, durationSec, stopTime, elapsedTime, movingTime,
        avgPace, topPace, avgSpeed, topSpeed, calories, elevationGain,
        startedAt: new Date(startedAt), endedAt: new Date(endedAt),
        routeEncoded, kmSplits,
      },
    });

    // ── Create territory
    const territoryResult = await prisma.$queryRawUnsafe(`
      WITH new_route AS (SELECT ST_GeomFromText('${routeWKT}', 4326) AS route),
           new_area  AS (SELECT ST_Buffer(route::geography, 20)::geometry AS territory FROM new_route)
      INSERT INTO territories (id, "userId", "activityId", boundary, "areaKm2", "capturedAt", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), '${userId}', '${activity.id}', territory,
             ST_Area(territory::geography) / 1000000, NOW(), NOW(), NOW()
      FROM new_area
      RETURNING id;
    `);

    const territoryId = territoryResult[0].id;

    // ── Capture enemy territories
    await captureTerritory({ userId, activityId: activity.id, newTerritoryId: territoryId });

    // ── Merge own territories
    await prisma.$executeRawUnsafe(`
      WITH merged AS (SELECT ST_Union(boundary) AS merged_boundary FROM territories WHERE "userId" = '${userId}')
      UPDATE territories
      SET
        boundary = (SELECT merged_boundary FROM merged),
        "areaKm2" = (SELECT ST_Area(merged_boundary::geography) / 1000000 FROM merged),
        "updatedAt" = NOW()
      WHERE "userId" = '${userId}';
    `);

    // ── Keep only the newest territory per user
    await prisma.$executeRawUnsafe(`
      DELETE FROM territories
      WHERE id NOT IN (
        SELECT DISTINCT ON ("userId") id FROM territories WHERE "userId" = '${userId}' ORDER BY "userId", "createdAt" DESC
      )
      AND "userId" = '${userId}';
    `);

    // ── Get final territory
    const finalTerritory = await prisma.$queryRawUnsafe(`
      SELECT id, "userId", "activityId", "areaKm2", "capturedAt", "createdAt", "updatedAt",
             ST_AsGeoJSON(boundary)::json AS boundary
      FROM territories WHERE id = '${territoryId}' LIMIT 1;
    `);

    const recentEvents = await prisma.territoryEvent.findMany({
      where: { activityId: activity.id },
      orderBy: { createdAt: 'desc' },
    });

    // ─────────────────────────────────────────
    // XP — only award for meaningful activities
    // minimum 0.1 km, 10 XP per km
    // ─────────────────────────────────────────
    const MIN_DISTANCE_KM = 0.1;
    
    const XP_PER_KM = 50;

    const xpEarned = distanceKm > 0
      ? Math.round(distanceKm * XP_PER_KM)
      : 0;

    if (xpEarned > 0) {
      await addXP({
        userId,
        amount: xpEarned,
        type: 'ACTIVITY',
        description: `${mode} — ${distanceKm} km`,
        activityId: activity.id,
      });
    }

    // bonus XP for each territory captured
    const captureBonus = recentEvents.length * 25;
    if (captureBonus > 0) {
      await addXP({
        userId,
        amount: captureBonus,
        type: 'TERRITORY_CAPTURE',
        description: `Captured ${recentEvents.length} territory`,
        activityId: activity.id,
      });
    }

    // ─────────────────────────────────────────
    // Update progress stats
    // ─────────────────────────────────────────
    await prisma.userProgress.upsert({
      where: { userId },
      create: {
        userId,
        totalDistanceKm: distanceKm,
        activitiesCount: distanceKm >= MIN_DISTANCE_KM ? 1 : 0,
      },
      update: {
        totalDistanceKm: { increment: distanceKm },
        activitiesCount: distanceKm >= MIN_DISTANCE_KM ? { increment: 1 } : undefined,
      },
    });

    // ─────────────────────────────────────────
    // Level check
    // ─────────────────────────────────────────
    const levelResult = await checkLevelUp(userId);

    // ─────────────────────────────────────────
    // Badge check
    // ─────────────────────────────────────────
    const newBadges = await checkBadges(userId);

    // ─────────────────────────────────────────
    // Final progress snapshot
    // ─────────────────────────────────────────
    const progress = await prisma.userProgress.findUnique({
      where: { userId },
    });

    return res.status(201).json({
      success: true,
      message: 'Activity completed successfully',
      activity,
      territory: finalTerritory[0] || null,
      captureEvents: recentEvents,
      // ── Progression
      progression: {
        xpEarned:      xpEarned + captureBonus,
        leveledUp:     levelResult?.leveledUp ?? false,
        level:         levelResult?.level ?? progress?.level ?? 0,
        newBadges,
        progress: {
          currentXp:      progress?.currentXp,
          totalXp:        progress?.totalXp,
          xpToNextLevel:  progress?.xpToNextLevel,
          level:          progress?.level,
          totalDistanceKm: progress?.totalDistanceKm,
          activitiesCount: progress?.activitiesCount,
        },
      },
    });

  } catch (error) {
    console.error('FINISH_ACTIVITY ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Get Activity Detail (map + stats)
// GET /api/activities/:id
// ─────────────────────────────────────────────
export const getActivityDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const activity = await prisma.activity.findUnique({ where: { id } });

    if (!activity) return res.status(404).json({ success: false, message: 'Activity not found' });
    if (activity.userId !== userId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const territoryRows = await prisma.$queryRaw`
      SELECT
        t.id, t."userId", t."activityId", t.name, t."areaKm2",
        t."capturedAt", t."createdAt", t."updatedAt",
        ST_AsGeoJSON(t.boundary)::json AS boundary,
        ST_AsGeoJSON(t.center)::json   AS center,
        u.username, u."fullName"
      FROM territories t
      JOIN users u ON u.id = t."userId"
      ORDER BY t."capturedAt" DESC;
    `;

    const territories = territoryRows.map((t) => ({
      id: t.id, userId: t.userId, activityId: t.activityId, name: t.name,
      owner: { username: t.username, fullName: t.fullName },
      areaKm2: t.areaKm2, capturedAt: t.capturedAt, createdAt: t.createdAt, updatedAt: t.updatedAt,
      geojson: t.boundary, center: t.center,
    }));

    return res.status(200).json({
      success: true,
      data: {
        id: activity.id, mode: activity.mode,
        startedAt: activity.startedAt, endedAt: activity.endedAt,
        durationSec: activity.durationSec, elapsedTime: activity.elapsedTime,
        movingTime: activity.movingTime, stopTime: activity.stopTime,
        distanceKm: activity.distanceKm,
        avgPace: activity.avgPace, avgPaceFormatted: formatPace(activity.avgPace),
        topPace: activity.topPace, topPaceFormatted: formatPace(activity.topPace),
        avgSpeed: activity.avgSpeed, topSpeed: activity.topSpeed,
        calories: activity.calories, elevationGain: activity.elevationGain,
        kmSplits: activity.kmSplits ?? [],
        routeEncoded: activity.routeEncoded,
        territories,
      },
    });

  } catch (error) {
    console.error('GET_ACTIVITY_DETAIL ERROR:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};
