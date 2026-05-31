
import { Prisma } from "@prisma/client";
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
            // profilePicture: true,
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


/**
 * |--------------------------------------------------------------------------
 * | GET CLAN TERRITORIES WITH FULL TERRITORY DATA
 * |--------------------------------------------------------------------------
 */

export const getClanTerritories = async (req, res) => {
  try {
    const { clanId } = req.params;

    const clan = await prisma.clan.findUnique({
      where: { id: clanId },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        banner: true,
        territoryCount: true,
        totalAreaKm2: true,
      },
    });

    if (!clan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    const territories = await prisma.$queryRaw`
      SELECT
        t.id AS "territoryId",
        t."userId",
        t."activityId",
        t."landmassId",
        t.name,
        t."areaKm2",
        t."capturedAt",
        t."createdAt",
        t."updatedAt",
        t."routeEncoded",
        t."routeSegmentsEncoded",

        ST_AsGeoJSON(t.boundary)::json AS boundary,
        ST_AsGeoJSON(t.center)::json AS center,

        u.id AS "ownerId",
        u.username AS "ownerUsername",
        u."full_name" AS "ownerFullName",

        cm.role AS "clanRole",
        cm."joinedAt" AS "memberJoinedAt",

        a.mode,
        a."distanceKm",
        a."durationSec",
        a."avgPace",
        a."avgSpeed",
        a.calories,
        a."startedAt",
        a."endedAt"

      FROM clan_members cm

      JOIN territories t
        ON t."userId" = cm."userId"

      JOIN users u
        ON u.id = t."userId"

      LEFT JOIN activities a
        ON a.id = t."activityId"

      WHERE cm."clanId" = ${clanId}
        AND t.boundary IS NOT NULL
        AND NOT ST_IsEmpty(t.boundary)
        AND a."include_in_clan" = true

      ORDER BY t."capturedAt" DESC;
    `;

    const features = territories.map((territory) => ({
      type: "Feature",
      id: territory.territoryId,
      geometry: territory.boundary,

      properties: {
        territoryId: territory.territoryId,
        userId: territory.userId,
        activityId: territory.activityId,
        landmassId: territory.landmassId,

        name: territory.name,
        areaKm2: Number(territory.areaKm2),

        capturedAt: territory.capturedAt,
        createdAt: territory.createdAt,
        updatedAt: territory.updatedAt,

        center: territory.center,
        routeEncoded: territory.routeEncoded,
        routeSegmentsEncoded: territory.routeSegmentsEncoded ?? [],

        owner: {
          id: territory.ownerId,
          username: territory.ownerUsername,
          fullName: territory.ownerFullName,
        },

        clanMember: {
          role: territory.clanRole,
          joinedAt: territory.memberJoinedAt,
        },

        activity: territory.activityId
          ? {
            id: territory.activityId,
            mode: territory.mode,
            distanceKm: territory.distanceKm,
            durationSec: territory.durationSec,
            avgPace: territory.avgPace,
            avgSpeed: territory.avgSpeed,
            calories: territory.calories,
            startedAt: territory.startedAt,
            endedAt: territory.endedAt,
          }
          : null,
      },
    }));

    return res.status(200).json({
      success: true,
      clan,
      count: features.length,
      geojson: {
        type: "FeatureCollection",
        features,
      },
    });
  } catch (error) {
    console.log("GET_CLAN_TERRITORIES_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch clan territories",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};



/**
 * |--------------------------------------------------------------------------
 * | GET ALL CLAN TERRITORIES
 * |--------------------------------------------------------------------------
 */

export const getAllClanTerritories = async (req, res) => {
  try {
    const territories = await prisma.$queryRaw`
      SELECT
        c.id AS "clanId",
        c.name AS "clanName",
        c.slug AS "clanSlug",
        c.logo AS "clanLogo",
        c.banner AS "clanBanner",

        t.id AS "territoryId",
        t."userId",
        t."activityId",
        t."landmassId",
        t.name,
        t."areaKm2",
        t."capturedAt",
        t."createdAt",
        t."updatedAt",
        t."routeEncoded",
        t."routeSegmentsEncoded",

        ST_AsGeoJSON(t.boundary)::json AS boundary,
        ST_AsGeoJSON(t.center)::json AS center,

        u.id AS "ownerId",
        u.username AS "ownerUsername",
        u."full_name" AS "ownerFullName",

        cm.role AS "clanRole",
        cm."joinedAt" AS "memberJoinedAt",

        a.mode,
        a."distanceKm",
        a."durationSec",
        a."avgPace",
        a."avgSpeed",
        a.calories,
        a."startedAt",
        a."endedAt",
        a."include_in_clan" AS "includeInClan"

      FROM clan_members cm

      JOIN clans c
        ON c.id = cm."clanId"

      JOIN territories t
        ON t."userId" = cm."userId"

      JOIN users u
        ON u.id = t."userId"

      JOIN activities a
        ON a.id = t."activityId"

      WHERE t.boundary IS NOT NULL
        AND NOT ST_IsEmpty(t.boundary)
        AND a."include_in_clan" = true

      ORDER BY c.name ASC, t."capturedAt" DESC;
    `;

    const features = territories.map((territory) => ({
      type: "Feature",
      id: territory.territoryId,
      geometry: territory.boundary,

      properties: {
        clan: {
          id: territory.clanId,
          name: territory.clanName,
          slug: territory.clanSlug,
          logo: territory.clanLogo,
          banner: territory.clanBanner,
        },

        territoryId: territory.territoryId,
        userId: territory.userId,
        activityId: territory.activityId,
        landmassId: territory.landmassId,

        name: territory.name,
        areaKm2: Number(territory.areaKm2),

        capturedAt: territory.capturedAt,
        createdAt: territory.createdAt,
        updatedAt: territory.updatedAt,

        center: territory.center,
        routeEncoded: territory.routeEncoded,
        routeSegmentsEncoded: territory.routeSegmentsEncoded ?? [],

        owner: {
          id: territory.ownerId,
          username: territory.ownerUsername,
          fullName: territory.ownerFullName,
        },

        clanMember: {
          role: territory.clanRole,
          joinedAt: territory.memberJoinedAt,
        },

        activity: {
          id: territory.activityId,
          mode: territory.mode,
          distanceKm: territory.distanceKm,
          durationSec: territory.durationSec,
          avgPace: territory.avgPace,
          avgSpeed: territory.avgSpeed,
          calories: territory.calories,
          startedAt: territory.startedAt,
          endedAt: territory.endedAt,
          includeInClan: territory.includeInClan,
        },
      },
    }));

    return res.status(200).json({
      success: true,
      count: features.length,
      geojson: {
        type: "FeatureCollection",
        features,
      },
    });
  } catch (error) {
    console.log("GET_ALL_CLAN_TERRITORIES_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch all clan territories",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


export const getMyClanStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const member = await prisma.clanMember.findFirst({
      where: {
        userId,
      },
      select: {
        clanId: true,
        role: true,
        clan: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            banner: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      isInClan: !!member,
      clanId: member?.clanId ?? null,
      role: member?.role ?? null,

      clan: member
        ? {
          id: member.clan.id,
          name: member.clan.name,
          slug: member.clan.slug,
          logo: member.clan.logo,
          banner: member.clan.banner,
        }
        : null,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch clan status",
    });
  }
};



/**
 * |--------------------------------------------------------------------------
 * | JOIN CLAN DIRECTLY
 * |--------------------------------------------------------------------------
 */

export const joinClanDirectly = async (req, res) => {
  try {
    const userId = req.user.id;
    const { clanId } = req.params;

    const clan = await prisma.clan.findUnique({
      where: {
        id: clanId,
      },
    });

    if (!clan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    // Check if already in any clan
    const existingMembership = await prisma.clanMember.findFirst({
      where: {
        userId,
      },
    });

    if (existingMembership) {
      return res.status(400).json({
        success: false,
        message: "User is already in a clan",
      });
    }

    const member = await prisma.clanMember.create({
      data: {
        clanId,
        userId,
        role: "RUNNER",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Joined clan successfully",
      data: member,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Failed to join clan",
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | GET CLAN DETAILS
 * |--------------------------------------------------------------------------
 */

export const getClanDetails = async (req, res) => {
  try {
    const { clanId } = req.params;
    const currentUserId = req.user.id;

    const clan = await prisma.clan.findUnique({
      where: {
        id: clanId,
      },
      include: {
        captain: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
              },
            },
          },
          orderBy: {
            joinedAt: "asc",
          },
        },
        _count: {
          select: {
            members: true,
            joinRequests: true,
            invites: true,
          },
        },
      },
    });

    if (!clan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    const memberUserIds = clan.members.map((member) => member.userId);

    const currentUserMembership = clan.members.find(
      (member) => member.userId === currentUserId
    );

    let territoryStats = {
      totalAreaKm2: 0,
      territoryCount: 0,
      totalDistanceKm: 0,
      totalActivities: 0,
    };

    if (memberUserIds.length > 0) {
      const statsResult = await prisma.$queryRaw`
        SELECT
          COALESCE(SUM(t."areaKm2"), 0) AS "totalAreaKm2",
          COUNT(t.id) AS "territoryCount",
          COALESCE(SUM(a."distanceKm"), 0) AS "totalDistanceKm",
          COUNT(DISTINCT a.id) AS "totalActivities"
        FROM territories t
        LEFT JOIN activities a
          ON a.id = t."activityId"
        WHERE t."userId" IN (${Prisma.join(memberUserIds)})
          AND t.boundary IS NOT NULL
          AND NOT ST_IsEmpty(t.boundary)
          AND (
            a.id IS NULL
            OR a."include_in_clan" = true
          );
      `;

      if (statsResult.length > 0) {
        territoryStats = {
          totalAreaKm2: Number(statsResult[0].totalAreaKm2 || 0),
          territoryCount: Number(statsResult[0].territoryCount || 0),
          totalDistanceKm: Number(statsResult[0].totalDistanceKm || 0),
          totalActivities: Number(statsResult[0].totalActivities || 0),
        };
      }
    }

    const recentTerritories =
      memberUserIds.length > 0
        ? await prisma.$queryRaw`
            SELECT
              t.id,
              t."userId",
              t.name,
              t."areaKm2",
              t."capturedAt",
              u.username,
              u."full_name" AS "fullName",
              a.mode,
              a."distanceKm",
              a."include_in_clan" AS "includeInClan"
            FROM territories t
            JOIN users u
              ON u.id = t."userId"
            LEFT JOIN activities a
              ON a.id = t."activityId"
            WHERE t."userId" IN (${Prisma.join(memberUserIds)})
              AND t.boundary IS NOT NULL
              AND NOT ST_IsEmpty(t.boundary)
              AND (
                a.id IS NULL
                OR a."include_in_clan" = true
              )
            ORDER BY t."capturedAt" DESC
            LIMIT 10;
          `
        : [];

    const pendingJoinRequests = await prisma.clanJoinRequest.count({
      where: {
        clanId,
        status: "PENDING",
      },
    });

    const pendingInvites = await prisma.clanInvite.count({
      where: {
        clanId,
        status: "PENDING",
      },
    });

    const members = clan.members.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      user: member.user,
    }));

    return res.status(200).json({
      success: true,
      data: {
        clan: {
          id: clan.id,
          name: clan.name,
          slug: clan.slug,
          description: clan.description,
          logo: clan.logo,
          banner: clan.banner,
          isPrivate: clan.isPrivate,
          captainId: clan.captainId,
          captain: clan.captain,
          totalXp: clan.totalXp,
          territoryCount: clan.territoryCount,
          totalAreaKm2: clan.totalAreaKm2,
          createdAt: clan.createdAt,
          updatedAt: clan.updatedAt,
        },

        stats: {
          totalMembers: clan._count.members,
          totalAreaKm2: territoryStats.totalAreaKm2,
          totalAreaM2: territoryStats.totalAreaKm2 * 1000000,
          territoryCount: territoryStats.territoryCount,
          totalDistanceKm: territoryStats.totalDistanceKm,
          totalActivities: territoryStats.totalActivities,
          pendingJoinRequests,
          pendingInvites,
        },

        currentUser: {
          isMember: !!currentUserMembership,
          role: currentUserMembership?.role ?? null,
          joinedAt: currentUserMembership?.joinedAt ?? null,
          isCaptain: clan.captainId === currentUserId,
        },

        members,

        recentTerritories: recentTerritories.map((territory) => ({
          id: territory.id,
          userId: territory.userId,
          name: territory.name,
          areaKm2: Number(territory.areaKm2 || 0),
          capturedAt: territory.capturedAt,
          owner: {
            username: territory.username,
            fullName: territory.fullName,
          },
          activity: {
            mode: territory.mode,
            distanceKm: territory.distanceKm,
            includeInClan: territory.includeInClan,
          },
        })),
      },
    });
  } catch (error) {
    console.log("GET_CLAN_DETAILS_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch clan details",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


/**
 * |--------------------------------------------------------------------------
 * | LEAVE CLAN
 * |--------------------------------------------------------------------------
 */

// export const leaveClan = async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const membership = await prisma.clanMember.findFirst({
//       where: {
//         userId,
//       },
//       include: {
//         clan: true,
//       },
//     });

//     if (!membership) {
//       return res.status(404).json({
//         success: false,
//         message: "You are not in any clan",
//       });
//     }

//     // Prevent captain from leaving
//     if (membership.clan.captainId === userId) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Clan captain cannot leave the clan. Transfer ownership or delete the clan first.",
//       });
//     }

//     await prisma.clanMember.delete({
//       where: {
//         id: membership.id,
//       },
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Successfully left the clan",
//     });
//   } catch (error) {
//     console.log("LEAVE_CLAN_ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to leave clan",
//     });
//   }
// };




export const leaveClan = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const membership = await tx.clanMember.findFirst({
        where: {
          userId,
        },
        include: {
          clan: true,
        },
      });

      if (!membership) {
        return {
          status: 404,
          body: {
            success: false,
            message: "You are not in any clan",
          },
        };
      }

      const clanId = membership.clanId;
      const isLeader = membership.clan.captainId === userId;

      if (isLeader) {
        const newLeader = await tx.clanMember.findFirst({
          where: {
            clanId,
            userId: {
              not: userId,
            },
          },
          orderBy: {
            joinedAt: "asc",
          },
        });

        if (!newLeader) {
          return {
            status: 400,
            body: {
              success: false,
              message:
                "You are the only member in this clan. Delete the clan instead of leaving.",
            },
          };
        }

        await tx.clan.update({
          where: {
            id: clanId,
          },
          data: {
            captainId: newLeader.userId,
          },
        });

        await tx.clanMember.update({
          where: {
            id: newLeader.id,
          },
          data: {
            role: "LEADER",
          },
        });
      }

      await tx.clanMember.delete({
        where: {
          id: membership.id,
        },
      });

      return {
        status: 200,
        body: {
          success: true,
          message: isLeader
            ? "You left the clan. A new leader has been promoted."
            : "Successfully left the clan",
        },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    console.log("LEAVE_CLAN_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to leave clan",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | GET CLAN MEMBERS
 * |--------------------------------------------------------------------------
 */

export const getClanMembers = async (req, res) => {
  try {
    const { clanId } = req.params;

    const clan = await prisma.clan.findUnique({
      where: {
        id: clanId,
      },
    });

    if (!clan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    const members = await prisma.clanMember.findMany({
      where: {
        clanId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            email: true,
            // profilePicture: true,
          },
        },
      },
      orderBy: [
        {
          role: "asc",
        },
        {
          joinedAt: "asc",
        },
      ],
    });

    return res.status(200).json({
      success: true,
      clanId,
      totalMembers: members.length,
      members: members.map((member) => ({
        memberId: member.id,
        role: member.role,
        joinedAt: member.joinedAt,

        user: {
          id: member.user.id,
          username: member.user.username,
          fullName: member.user.fullName,
          email: member.user.email,
          profilePicture: member.user.profilePicture,
        },
      })),
    });
  } catch (error) {
    console.log("GET_CLAN_MEMBERS_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch clan members",
    });
  }
};


/**
 * |--------------------------------------------------------------------------
 * | GET CLAN MEMBERS WITH ACTIVITIES AND TERRITORIES
 * |--------------------------------------------------------------------------
 */

export const getClanMembersFull = async (req, res) => {
  try {
    const { clanId } = req.params;
    const currentUserId = req.user.id;

    const clan = await prisma.clan.findUnique({
      where: {
        id: clanId,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        banner: true,
      },
    });

    if (!clan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    const currentMember = await prisma.clanMember.findFirst({
      where: {
        clanId,
        userId: currentUserId,
      },
    });

    if (!currentMember) {
      return res.status(403).json({
        success: false,
        message: "Only clan members can view this data",
      });
    }

    const members = await prisma.clanMember.findMany({
      where: {
        clanId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: {
        joinedAt: "asc",
      },
    });

    const memberUserIds = members.map((member) => member.userId);

    if (memberUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        clan,
        totalMembers: 0,
        members: [],
      });
    }

    const activities = await prisma.activity.findMany({
      where: {
        userId: {
          in: memberUserIds,
        },
        includeInClan: true,
      },
      select: {
        id: true,
        userId: true,
        mode: true,
        distanceKm: true,
        durationSec: true,
        stopTime: true,
        elapsedTime: true,
        movingTime: true,
        avgPace: true,
        topPace: true,
        avgSpeed: true,
        topSpeed: true,
        calories: true,
        elevationGain: true,
        startedAt: true,
        endedAt: true,
        routeEncoded: true,
        kmSplits: true,
        includeInClan: true,
        notes: true,
        createdAt: true,
      },
      orderBy: {
        startedAt: "desc",
      },
    });

    const territories = await prisma.$queryRaw`
      SELECT
        t.id,
        t."userId",
        t."activityId",
        t."landmassId",
        t.name,
        t."areaKm2",
        t."capturedAt",
        t."createdAt",
        t."updatedAt",
        t."routeEncoded",
        t."routeSegmentsEncoded",
        ST_AsGeoJSON(t.boundary)::json AS boundary,
        ST_AsGeoJSON(t.center)::json AS center
      FROM territories t
      LEFT JOIN activities a
        ON a.id = t."activityId"
      WHERE t."userId" IN (${Prisma.join(memberUserIds)})
        AND t.boundary IS NOT NULL
        AND NOT ST_IsEmpty(t.boundary)
        AND (
          a.id IS NULL
          OR a."include_in_clan" = true
        )
      ORDER BY t."capturedAt" DESC;
    `;

    const activitiesByUserId = {};
    const territoriesByUserId = {};

    for (const activity of activities) {
      if (!activitiesByUserId[activity.userId]) {
        activitiesByUserId[activity.userId] = [];
      }

      activitiesByUserId[activity.userId].push(activity);
    }

    for (const territory of territories) {
      if (!territoriesByUserId[territory.userId]) {
        territoriesByUserId[territory.userId] = [];
      }

      territoriesByUserId[territory.userId].push({
        id: territory.id,
        userId: territory.userId,
        activityId: territory.activityId,
        landmassId: territory.landmassId,
        name: territory.name,
        areaKm2: Number(territory.areaKm2 || 0),
        capturedAt: territory.capturedAt,
        createdAt: territory.createdAt,
        updatedAt: territory.updatedAt,
        routeEncoded: territory.routeEncoded,
        routeSegmentsEncoded: territory.routeSegmentsEncoded ?? [],
        boundary: territory.boundary,
        center: territory.center,
      });
    }

    const formattedMembers = members.map((member) => {
      const userActivities = activitiesByUserId[member.userId] || [];
      const userTerritories = territoriesByUserId[member.userId] || [];

      const totalDistanceKm = userActivities.reduce(
        (sum, activity) => sum + Number(activity.distanceKm || 0),
        0
      );

      const totalAreaKm2 = userTerritories.reduce(
        (sum, territory) => sum + Number(territory.areaKm2 || 0),
        0
      );

      return {
        memberId: member.id,
        role: member.role,
        joinedAt: member.joinedAt,

        user: {
          id: member.user.id,
          username: member.user.username,
          fullName: member.user.fullName,
          email: member.user.email,
        },

        stats: {
          totalActivities: userActivities.length,
          totalTerritories: userTerritories.length,
          totalDistanceKm,
          totalAreaKm2,
        },

        activities: userActivities,
        territories: userTerritories,
      };
    });

    return res.status(200).json({
      success: true,
      clan,
      totalMembers: formattedMembers.length,
      members: formattedMembers,
    });
  } catch (error) {
    console.log("GET_CLAN_MEMBERS_FULL_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch clan members full data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};