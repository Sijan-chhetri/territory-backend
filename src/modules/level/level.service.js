import prisma from '../../config/prisma.js';
import { LEVELS } from '../../config/levels.js';

export const checkLevelUp = async (userId) => {

  const progress = await prisma.userProgress.findUnique({
    where: { userId },
  });

  if (!progress) return null;

  let newLevel = progress.level;

  for (const lvl of LEVELS) {
    if (progress.totalXp >= lvl.xpNeeded) {
      newLevel = lvl.level;
    }
  }

  if (newLevel > progress.level) {

    const nextLevel = LEVELS.find((l) => l.level === newLevel + 1);

    await prisma.userProgress.update({
      where: { userId },
      data: {
        level: newLevel,
        xpToNextLevel: nextLevel?.xpNeeded || progress.xpToNextLevel,
      },
    });

    return {
      leveledUp: true,
      level: newLevel,
    };
  }

  return {
    leveledUp: false,
    level: progress.level,
  };
};