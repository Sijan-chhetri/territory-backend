import prisma from '../../config/prisma.js';
import { LEVELS } from '../../config/levels.js';

// ─────────────────────────────────────────────
// Get Level Config (all levels + thresholds)
// GET /api/levels
// ─────────────────────────────────────────────
export const getLevels = async (_req, res) => {
  try {
    return res.status(200).json({ success: true, levels: LEVELS });
  } catch (error) {
    console.error('GET_LEVELS ERROR:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─────────────────────────────────────────────
// Get My Level
// GET /api/levels/me
// ─────────────────────────────────────────────
export const getMyLevel = async (req, res) => {
  try {
    const progress = await prisma.userProgress.findUnique({
      where: { userId: req.user.id },
    });

    if (!progress) {
      return res.status(404).json({
        success: false,
        message: 'No progress found',
      });
    }

    const streakResult = await prisma.$queryRaw`
      WITH activity_days AS (
        SELECT DISTINCT DATE("startedAt") AS activity_date
        FROM activities
        WHERE "userId" = ${req.user.id}
      ),
      ordered_days AS (
        SELECT
          activity_date,
          ROW_NUMBER() OVER (ORDER BY activity_date DESC) AS rn
        FROM activity_days
        WHERE activity_date <= CURRENT_DATE
      ),
      streak_days AS (
        SELECT activity_date
        FROM ordered_days
        WHERE activity_date = CURRENT_DATE - (rn - 1)::int
      )
      SELECT COUNT(*)::int AS streak
      FROM streak_days;
    `;

    const lifetimeStreak = Number(streakResult?.[0]?.streak ?? 0);

    const currentLevelConfig =
      LEVELS.find((l) => l.level === progress.level) ?? {
        level: 0,
        xpNeeded: 0,
      };

    const nextLevelConfig =
      LEVELS.find((l) => l.level === progress.level + 1) ?? null;

    const xpForThisLevel = nextLevelConfig
      ? nextLevelConfig.xpNeeded - currentLevelConfig.xpNeeded
      : 0;

    const xpProgress =
      nextLevelConfig && xpForThisLevel > 0
        ? Math.min(
            100,
            Math.round((Number(progress.currentXp) / xpForThisLevel) * 100)
          )
        : 100;

    return res.status(200).json({
      success: true,
      level: {
        current: progress.level,
        currentXp: progress.currentXp,
        totalXp: progress.totalXp,
        xpToNextLevel: progress.xpToNextLevel,
        xpProgress,
        xpForThisLevel,
        currentConfig: currentLevelConfig,
        nextConfig: nextLevelConfig,
        lifetimeStreak,
      },
    });
  } catch (error) {
    console.error('GET_MY_LEVEL ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};
