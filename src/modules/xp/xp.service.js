import prisma from '../../config/prisma.js';

export const addXP = async ({
  userId,
  amount,
  type,
  description = '',
  activityId = null,
}) => {

  let progress = await prisma.userProgress.findUnique({
    where: { userId },
  });

  if (!progress) {
    progress = await prisma.userProgress.create({
      data: {
        userId,
      },
    });
  }

  const updatedXp = progress.currentXp + amount;
  const updatedTotalXp = progress.totalXp + amount;

  await prisma.xPTransaction.create({
    data: {
      userId,
      amount,
      type,
      description,
      activityId,
    },
  });

  return prisma.userProgress.update({
    where: { userId },
    data: {
      currentXp: updatedXp,
      totalXp: updatedTotalXp,
    },
  });
};