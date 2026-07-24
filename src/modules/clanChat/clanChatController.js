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




/**
 * DELETE CLAN MESSAGES OLDER THAN 7 DAYS
 *
 * Deletes messages older than seven days from the authenticated
 * user's current clan.
 */
export const deleteOldClanMessages = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find the clan joined by the authenticated user
    const membership = await prisma.clanMember.findFirst({
      where: {
        userId,
      },
      select: {
        clanId: true,
      },
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You are not in a clan',
      });
    }

    // Calculate the date exactly seven days ago
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    );

    const deletedMessages = await prisma.clanMessage.deleteMany({
      where: {
        clanId: membership.clanId,
        createdAt: {
          lt: sevenDaysAgo,
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: `${deletedMessages.count} old clan messages deleted`,
      clanId: membership.clanId,
      deletedCount: deletedMessages.count,
      deletedBefore: sevenDaysAgo,
    });
  } catch (error) {
    console.error('DELETE_OLD_CLAN_MESSAGES_ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error while deleting old clan messages',
    });
  }
};