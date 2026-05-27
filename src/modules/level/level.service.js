import prisma from '../../config/prisma.js';
import { LEVELS } from '../../config/levels.js';

export const checkLevelUp = async (userId) => {

  const progress = await prisma.userProgress.findUnique({ where: { userId } });
  if (!progress) return null;

  let newLevel = progress.level;

  // Find the highest level the user has reached based on totalXp
  for (const lvl of LEVELS) {
    if (Number(progress.totalXp) >= lvl.xpNeeded) {
      newLevel = lvl.level;
    }
  }

  if (newLevel > progress.level) {
    const currentLevelConfig = LEVELS.find((l) => l.level === newLevel);
    const nextLevelConfig    = LEVELS.find((l) => l.level === newLevel + 1);

    // currentXp = XP earned since the start of the new level
    // = totalXp minus the XP needed to reach this level
    const xpAtCurrentLevel = currentLevelConfig?.xpNeeded ?? 0;
    const newCurrentXp     = Number(progress.totalXp) - xpAtCurrentLevel;

    await prisma.userProgress.update({
      where: { userId },
      data: {
        level:         newLevel,
        currentXp:     Math.max(0, newCurrentXp),
        xpToNextLevel: nextLevelConfig?.xpNeeded ?? progress.xpToNextLevel,
      },
    });

    return { leveledUp: true, level: newLevel };
  }

  return { leveledUp: false, level: progress.level };
};
