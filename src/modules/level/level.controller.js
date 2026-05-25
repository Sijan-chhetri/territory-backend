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

    const currentLevelConfig = LEVELS.find((l) => l.level === progress.level) ?? LEVELS[0];
    const nextLevelConfig    = LEVELS.find((l) => l.level === progress.level + 1) ?? null;

    return res.status(200).json({
      success: true,
      level: {
        current:       progress.level,
        currentXp:     progress.currentXp,
        totalXp:       progress.totalXp,
        xpToNextLevel: progress.xpToNextLevel,
        xpProgress:    nextLevelConfig
          ? Math.round((progress.currentXp / nextLevelConfig.xpNeeded) * 100)
          : 100,
        currentConfig: currentLevelConfig,
        nextConfig:    nextLevelConfig,
      },
    });

  } catch (error) {
    console.error('GET_MY_LEVEL ERROR:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
