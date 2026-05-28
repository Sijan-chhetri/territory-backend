
import prisma from "../../config/prisma.js";



/**
 * |--------------------------------------------------------------------------
 * | GET CLAN JOIN REQUESTS
 * |--------------------------------------------------------------------------
 */

export const getClanJoinRequests = async (req, res) => {
  try {

    const currentUserId = req.user.id;

    const { clanId } = req.params;

    // check clan exists
    const clan = await prisma.clan.findUnique({
      where: {
        id: clanId
      }
    });

    if (!clan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found"
      });
    }

    // only leader/captain can view requests
    const isCaptain = clan.captainId === currentUserId;

    const isLeader = await prisma.clanMember.findFirst({
      where: {
        clanId,
        userId: currentUserId,
        role: "LEADER"
      }
    });

    if (!isCaptain && !isLeader) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const requests = await prisma.clanJoinRequest.findMany({
      where: {
        clanId,
        status: "PENDING"
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePicture: true,
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.status(200).json({
      success: true,
      data: requests
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch join requests"
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | CREATE CLAN
 * |--------------------------------------------------------------------------
 */

export const createClan = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      name,
      slug,
      description,
      logo,
      banner,
      isPrivate,
    } = req.body;

    const existingClan = await prisma.clan.findFirst({
      where: {
        OR: [
          { name },
          { slug }
        ]
      }
    });

    if (existingClan) {
      return res.status(400).json({
        success: false,
        message: "Clan already exists"
      });
    }

    const clan = await prisma.$transaction(async (tx) => {

      const createdClan = await tx.clan.create({
        data: {
          name,
          slug,
          description,
          logo,
          banner,
          isPrivate,
          captainId: userId,
        }
      });

      await tx.clanMember.create({
        data: {
          clanId: createdClan.id,
          userId,
          role: "LEADER"
        }
      });

      return createdClan;
    });

    return res.status(201).json({
      success: true,
      message: "Clan created successfully",
      data: clan
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to create clan"
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | GET ALL CLANS
 * |--------------------------------------------------------------------------
 */

export const getAllClans = async (req, res) => {
  try {

    const clans = await prisma.clan.findMany({
      include: {
        captain: {
          select: {
            id: true,
            username: true,
            fullName: true,
          }
        },
        _count: {
          select: {
            members: true
          }
        }
      },
      orderBy: {
        totalXp: "desc"
      }
    });

    return res.status(200).json({
      success: true,
      data: clans
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch clans"
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | REQUEST TO JOIN CLAN
 * |--------------------------------------------------------------------------
 */

export const requestToJoinClan = async (req, res) => {
  try {

    const userId = req.user.id;

    const { clanId } = req.params;

    const existingMember = await prisma.clanMember.findFirst({
      where: {
        clanId,
        userId
      }
    });

    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: "Already a clan member"
      });
    }

    const existingRequest = await prisma.clanJoinRequest.findFirst({
      where: {
        clanId,
        userId,
        status: "PENDING"
      }
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: "Join request already sent"
      });
    }

    const request = await prisma.clanJoinRequest.create({
      data: {
        clanId,
        userId,
      }
    });

    return res.status(201).json({
      success: true,
      message: "Join request sent",
      data: request
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to request join"
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | ACCEPT JOIN REQUEST
 * |--------------------------------------------------------------------------
 */

export const acceptClanJoinRequest = async (req, res) => {
  try {

    const currentUserId = req.user.id;

    const { requestId } = req.params;

    const request = await prisma.clanJoinRequest.findUnique({
      where: {
        id: requestId
      },
      include: {
        clan: true
      }
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found"
      });
    }

    const isCaptain =
      request.clan.captainId === currentUserId;

    const clanMember = await prisma.clanMember.findFirst({
      where: {
        clanId: request.clanId,
        userId: currentUserId,
        role: "LEADER"
      }
    });

    if (!isCaptain && !clanMember) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized"
      });
    }

    await prisma.$transaction(async (tx) => {

      await tx.clanMember.create({
        data: {
          clanId: request.clanId,
          userId: request.userId,
          role: "RUNNER"
        }
      });

      await tx.clanJoinRequest.update({
        where: {
          id: requestId
        },
        data: {
          status: "ACCEPTED"
        }
      });

    });

    return res.status(200).json({
      success: true,
      message: "Join request accepted"
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to accept request"
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | REJECT JOIN REQUEST
 * |--------------------------------------------------------------------------
 */

export const rejectClanJoinRequest = async (req, res) => {
  try {

    const currentUserId = req.user.id;

    const { requestId } = req.params;

    const request = await prisma.clanJoinRequest.findUnique({
      where: {
        id: requestId
      },
      include: {
        clan: true
      }
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found"
      });
    }

    const isCaptain =
      request.clan.captainId === currentUserId;

    const clanLeader = await prisma.clanMember.findFirst({
      where: {
        clanId: request.clanId,
        userId: currentUserId,
        role: "LEADER"
      }
    });

    if (!isCaptain && !clanLeader) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized"
      });
    }

    await prisma.clanJoinRequest.update({
      where: {
        id: requestId
      },
      data: {
        status: "REJECTED"
      }
    });

    return res.status(200).json({
      success: true,
      message: "Join request rejected"
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to reject request"
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | ACCEPT CLAN INVITE
 * |--------------------------------------------------------------------------
 */

export const acceptClanInvite = async (req, res) => {
  try {

    const userId = req.user.id;

    const { inviteId } = req.params;

    const invite = await prisma.clanInvite.findUnique({
      where: {
        id: inviteId
      }
    });

    if (!invite) {
      return res.status(404).json({
        success: false,
        message: "Invite not found"
      });
    }

    if (invite.invitedUserId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized"
      });
    }

    await prisma.$transaction(async (tx) => {

      await tx.clanMember.create({
        data: {
          clanId: invite.clanId,
          userId,
          role: "RUNNER"
        }
      });

      await tx.clanInvite.update({
        where: {
          id: inviteId
        },
        data: {
          status: "ACCEPTED"
        }
      });

    });

    return res.status(200).json({
      success: true,
      message: "Clan invite accepted"
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to accept invite"
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | REJECT CLAN INVITE
 * |--------------------------------------------------------------------------
 */

export const rejectClanInvite = async (req, res) => {
  try {

    const userId = req.user.id;

    const { inviteId } = req.params;

    const invite = await prisma.clanInvite.findUnique({
      where: {
        id: inviteId
      }
    });

    if (!invite) {
      return res.status(404).json({
        success: false,
        message: "Invite not found"
      });
    }

    if (invite.invitedUserId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized"
      });
    }

    await prisma.clanInvite.update({
      where: {
        id: inviteId
      },
      data: {
        status: "REJECTED"
      }
    });

    return res.status(200).json({
      success: true,
      message: "Clan invite rejected"
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to reject invite"
    });
  }
};



/**
 * |--------------------------------------------------------------------------
 * | GET MY JOINED CLANS
 * |--------------------------------------------------------------------------
 */

export const getMyJoinedClans = async (req, res) => {
  try {

    const userId = req.user.id;

    const joinedClans = await prisma.clanMember.findMany({
      where: {
        userId
      },
      include: {
        clan: {
          include: {
            captain: {
              select: {
                id: true,
                username: true,
                fullName: true,
                // profilePicture: true,
              }
            },
            _count: {
              select: {
                members: true
              }
            }
          }
        }
      },
      orderBy: {
        joinedAt: "desc"
      }
    });

    return res.status(200).json({
      success: true,
      count: joinedClans.length,
      data: joinedClans.map(member => ({
        role: member.role,
        joinedAt: member.joinedAt,
        clan: member.clan
      }))
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch joined clans"
    });
  }
};