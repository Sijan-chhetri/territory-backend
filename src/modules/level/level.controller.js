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
      return res.status(404).json({ success: false, message: 'No progress found' });
    }

    const currentLevelConfig = LEVELS.find((l) => l.level === progress.level) ?? { level: 0, xpNeeded: 0 };
    const nextLevelConfig    = LEVELS.find((l) => l.level === progress.level + 1) ?? null;

    // XP needed just for this level span (not cumulative)
    // e.g. level 2 needs 150 total, level 3 needs 450 total → span = 300
    const xpForThisLevel = nextLevelConfig
      ? nextLevelConfig.xpNeeded - currentLevelConfig.xpNeeded
      : 0;

    const xpProgress = nextLevelConfig && xpForThisLevel > 0
      ? Math.min(100, Math.round((Number(progress.currentXp) / xpForThisLevel) * 100))
      : 100;

    return res.status(200).json({
      success: true,
      level: {
        current:       progress.level,
        currentXp:     progress.currentXp,
        totalXp:       progress.totalXp,
        xpToNextLevel: progress.xpToNextLevel,
        xpProgress,
        xpForThisLevel,
        currentConfig: currentLevelConfig,
        nextConfig:    nextLevelConfig,
      },
    });

  } catch (error) {
    console.error('GET_MY_LEVEL ERROR:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
