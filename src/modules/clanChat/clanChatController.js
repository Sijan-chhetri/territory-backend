import prisma from '../../config/prisma.js';

export const getMyClanMessages = async (req, res) => {
  try {
    const userId = req.user.id;

    const membership = await prisma.clanMember.findFirst({
      where: { userId },
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You are not in a clan',
      });
    }

    const messages = await prisma.clanMessage.findMany({
      where: {
        clanId: membership.clanId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            fullName: true,
            // profileImage: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      clanId: membership.clanId,
      messages: messages.reverse(),
    });
  } catch (error) {
    console.error('GET_MY_CLAN_MESSAGES_ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};