import prisma from '../../config/prisma.js';

export const addXP = async ({
  userId,
  amount,
  type,
  description = '',
  activityId = null,
}) => {

  let progress = await prisma.userProgress.findUnique({ where: { userId } });

  if (!progress) {
    progress = await prisma.userProgress.create({ data: { userId } });
  }

  const newTotalXp   = Number(progress.totalXp)   + amount;
  const newCurrentXp = Number(progress.currentXp)  + amount;

  await prisma.xPTransaction.create({
    data: { userId, amount, type, description, activityId },
  });

  return prisma.userProgress.update({
    where: { userId },
    data: {
      totalXp:   newTotalXp,
      currentXp: newCurrentXp,   // level service resets this on level up
    },
  });
};
