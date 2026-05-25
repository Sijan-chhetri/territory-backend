import prisma from '../../config/prisma.js';

export const getMyProgress = async (req, res) => {

  try {

    const progress = await prisma.userProgress.findUnique({
      where: {
        userId: req.user.id,
      },
      include: {
        user: true,
      },
    });

    return res.status(200).json({
      success: true,
      progress,
    });

  } catch (error) {

    console.error('GET_PROGRESS_ERROR', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};


export const getMyBadges = async (req, res) => {

  try {

    const badges = await prisma.userBadge.findMany({
      where: {
        userId: req.user.id,
      },
      include: {
        badge: true,
      },
      orderBy: {
        earnedAt: 'desc',
      },
    });

    return res.status(200).json({
      success: true,
      badges,
    });

  } catch (error) {

    console.error('GET_BADGES_ERROR', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};