import prisma from '../../config/prisma.js';

export const checkBadges = async (userId) => {

  const progress = await prisma.userProgress.findUnique({
    where: { userId },
  });

  const badges = await prisma.badge.findMany();

  const earned = [];

  for (const badge of badges) {

    const exists = await prisma.userBadge.findFirst({
      where: {
        userId,
        badgeId: badge.id,
      },
    });

    if (exists) continue;

    let achieved = false;

    switch (badge.requirementType) {

      case 'DISTANCE':
        achieved = progress.totalDistanceKm >= badge.requirementValue;
        break;

      case 'LEVEL':
        achieved = progress.level >= badge.requirementValue;
        break;

      case 'ACTIVITIES':
        achieved = progress.activitiesCount >= badge.requirementValue;
        break;
    }

    if (achieved) {

      await prisma.userBadge.create({
        data: {
          userId,
          badgeId: badge.id,
        },
      });

      earned.push(badge);
    }
  }

  return earned;
};