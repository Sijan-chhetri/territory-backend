
import { Prisma } from "@prisma/client";
import prisma from "../../config/prisma.js";
import { sendClanEventInvitations } from "../clanEvent/clanEventEmail.service.js";



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






// controllers/clan.controller.js

/**
 * Safely execute optional dashboard queries.
 *
 * A secondary dashboard section should not make the entire
 * clan-details request fail.
 */
const safeQuery = async (label, query, fallback) => {
  try {
    return await query();
  } catch (error) {
    console.error(`${label}_ERROR:`, error);
    return fallback;
  }
};

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// promote demote, kick 

/**
 * Get the acting member and target member.
 */
const getClanMemberships = async ({
  clanId,
  actingUserId,
  targetUserId,
  client = prisma,
}) => {
  const memberships = await client.clanMember.findMany({
    where: {
      clanId,
      userId: {
        in: [actingUserId, targetUserId],
      },
    },
  });

  const actingMember = memberships.find(
    (member) => member.userId === actingUserId
  );

  const targetMember = memberships.find(
    (member) => member.userId === targetUserId
  );

  return {
    actingMember,
    targetMember,
  };
};

/**
 * PATCH /clans/:clanId/members/:targetUserId/promote
 *
 * Body:
 * {
 *   "role": "CAPTAIN"
 * }
 *
 * or
 *
 * {
 *   "role": "LEADER"
 * }
 */
export const promoteClanMember = async (req, res) => {
  try {
    const actingUserId = req.user.id;
    const { clanId, targetUserId } = req.params;

    const requestedRole = String(req.body.role || "")
      .trim()
      .toUpperCase();

    if (!clanId || !targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Clan ID and target user ID are required",
      });
    }

    if (!["CAPTAIN", "LEADER"].includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        message: "Promotion role must be CAPTAIN or LEADER",
      });
    }

    if (actingUserId === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot promote yourself",
      });
    }

    const clan = await prisma.clan.findUnique({
      where: {
        id: clanId,
      },
      select: {
        id: true,
        name: true,
        captainId: true,
      },
    });

    if (!clan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    const { actingMember, targetMember } = await getClanMemberships({
      clanId,
      actingUserId,
      targetUserId,
    });

    if (!actingMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this clan",
      });
    }

    if (!targetMember) {
      return res.status(404).json({
        success: false,
        message: "The selected user is not a member of this clan",
      });
    }

    if (actingMember.role === "RUNNER") {
      return res.status(403).json({
        success: false,
        message: "Runners cannot promote clan members",
      });
    }

    /*
     * Captain permissions:
     * - Can promote RUNNER to CAPTAIN.
     * - Cannot promote anyone to LEADER.
     * - Cannot promote another CAPTAIN.
     */
    if (actingMember.role === "CAPTAIN") {
      if (requestedRole === "LEADER") {
        return res.status(403).json({
          success: false,
          message: "Captains cannot promote members to leader",
        });
      }

      if (targetMember.role === "LEADER") {
        return res.status(403).json({
          success: false,
          message: "Captains cannot change the leader's role",
        });
      }

      if (targetMember.role === "CAPTAIN") {
        return res.status(400).json({
          success: false,
          message: "This member is already a captain",
        });
      }

      const updatedMember = await prisma.clanMember.update({
        where: {
          id: targetMember.id,
        },
        data: {
          role: "CAPTAIN",
        },
      });

      return res.status(200).json({
        success: true,
        message: "Runner promoted to captain successfully",
        data: updatedMember,
      });
    }

    /*
     * Leader permissions.
     */
    if (actingMember.role === "LEADER") {
      /*
       * Promote to CAPTAIN.
       */
      if (requestedRole === "CAPTAIN") {
        if (targetMember.role === "LEADER") {
          return res.status(400).json({
            success: false,
            message: "The selected member is already the clan leader",
          });
        }

        if (targetMember.role === "CAPTAIN") {
          return res.status(400).json({
            success: false,
            message: "This member is already a captain",
          });
        }

        const updatedMember = await prisma.clanMember.update({
          where: {
            id: targetMember.id,
          },
          data: {
            role: "CAPTAIN",
          },
        });

        return res.status(200).json({
          success: true,
          message: "Runner promoted to captain successfully",
          data: updatedMember,
        });
      }

      /*
       * Promote RUNNER or CAPTAIN to LEADER.
       *
       * The current leader becomes CAPTAIN.
       */
      if (requestedRole === "LEADER") {
        if (targetMember.role === "LEADER") {
          return res.status(400).json({
            success: false,
            message: "This member is already the clan leader",
          });
        }

        const result = await prisma.$transaction(async (tx) => {
          // Recheck the memberships inside the transaction.
          const currentActingMember = await tx.clanMember.findFirst({
            where: {
              id: actingMember.id,
              clanId,
              userId: actingUserId,
            },
          });

          const currentTargetMember = await tx.clanMember.findFirst({
            where: {
              id: targetMember.id,
              clanId,
              userId: targetUserId,
            },
          });

          if (!currentActingMember) {
            throw new Error("ACTING_MEMBER_NOT_FOUND");
          }

          if (!currentTargetMember) {
            throw new Error("TARGET_MEMBER_NOT_FOUND");
          }

          if (currentActingMember.role !== "LEADER") {
            throw new Error("ACTING_MEMBER_NOT_LEADER");
          }

          if (currentTargetMember.role === "LEADER") {
            throw new Error("TARGET_ALREADY_LEADER");
          }

          // Current leader becomes captain.
          const previousLeader = await tx.clanMember.update({
            where: {
              id: currentActingMember.id,
            },
            data: {
              role: "CAPTAIN",
            },
          });

          // Selected member becomes leader.
          const newLeader = await tx.clanMember.update({
            where: {
              id: currentTargetMember.id,
            },
            data: {
              role: "LEADER",
            },
          });

          // Keep Clan.captainId synchronized with the clan leader.
          await tx.clan.update({
            where: {
              id: clanId,
            },
            data: {
              captainId: targetUserId,
            },
          });

          return {
            previousLeader,
            newLeader,
          };
        });

        return res.status(200).json({
          success: true,
          message:
            "Member promoted to leader successfully. The previous leader is now a captain.",
          data: result,
        });
      }
    }

    return res.status(403).json({
      success: false,
      message: "You do not have permission to promote this member",
    });
  } catch (error) {
    console.log("PROMOTE_CLAN_MEMBER_ERROR:", error);

    if (error.message === "ACTING_MEMBER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Your clan membership was not found",
      });
    }

    if (error.message === "TARGET_MEMBER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "The selected clan member was not found",
      });
    }

    if (error.message === "ACTING_MEMBER_NOT_LEADER") {
      return res.status(403).json({
        success: false,
        message: "You are no longer the leader of this clan",
      });
    }

    if (error.message === "TARGET_ALREADY_LEADER") {
      return res.status(400).json({
        success: false,
        message: "The selected member is already the clan leader",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to promote clan member",
    });
  }
};

/**
 * PATCH /clans/:clanId/members/:targetUserId/demote
 *
 * Only a LEADER can demote a CAPTAIN to RUNNER.
 */
export const demoteClanMember = async (req, res) => {
  try {
    const actingUserId = req.user.id;
    const { clanId, targetUserId } = req.params;

    if (!clanId || !targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Clan ID and target user ID are required",
      });
    }

    if (actingUserId === targetUserId) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot demote yourself. Transfer leadership to another member instead.",
      });
    }

    const clan = await prisma.clan.findUnique({
      where: {
        id: clanId,
      },
      select: {
        id: true,
      },
    });

    if (!clan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    const { actingMember, targetMember } = await getClanMemberships({
      clanId,
      actingUserId,
      targetUserId,
    });

    if (!actingMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this clan",
      });
    }

    if (!targetMember) {
      return res.status(404).json({
        success: false,
        message: "The selected user is not a member of this clan",
      });
    }

    if (actingMember.role === "RUNNER") {
      return res.status(403).json({
        success: false,
        message: "Runners cannot demote clan members",
      });
    }

    if (actingMember.role === "CAPTAIN") {
      return res.status(403).json({
        success: false,
        message: "Captains cannot demote clan members",
      });
    }

    if (actingMember.role !== "LEADER") {
      return res.status(403).json({
        success: false,
        message: "Only the clan leader can demote members",
      });
    }

    if (targetMember.role === "LEADER") {
      return res.status(403).json({
        success: false,
        message: "The clan leader cannot be demoted using this action",
      });
    }

    if (targetMember.role === "RUNNER") {
      return res.status(400).json({
        success: false,
        message: "This member is already a runner",
      });
    }

    const updatedMember = await prisma.clanMember.update({
      where: {
        id: targetMember.id,
      },
      data: {
        role: "RUNNER",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Captain demoted to runner successfully",
      data: updatedMember,
    });
  } catch (error) {
    console.log("DEMOTE_CLAN_MEMBER_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to demote clan member",
    });
  }
};

/**
 * DELETE /clans/:clanId/members/:targetUserId/kick
 *
 * Leader:
 * - Can kick RUNNER.
 * - Can kick CAPTAIN.
 *
 * Captain:
 * - Can kick RUNNER only.
 * - Cannot kick CAPTAIN.
 * - Cannot kick LEADER.
 */
export const kickClanMember = async (req, res) => {
  try {
    const actingUserId = req.user.id;
    const { clanId, targetUserId } = req.params;

    if (!clanId || !targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Clan ID and target user ID are required",
      });
    }

    if (actingUserId === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot kick yourself from the clan",
      });
    }

    const clan = await prisma.clan.findUnique({
      where: {
        id: clanId,
      },
      select: {
        id: true,
      },
    });

    if (!clan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    const { actingMember, targetMember } = await getClanMemberships({
      clanId,
      actingUserId,
      targetUserId,
    });

    if (!actingMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this clan",
      });
    }

    if (!targetMember) {
      return res.status(404).json({
        success: false,
        message: "The selected user is not a member of this clan",
      });
    }

    if (actingMember.role === "RUNNER") {
      return res.status(403).json({
        success: false,
        message: "Runners cannot kick clan members",
      });
    }

    /*
     * Captain can only kick runners.
     */
    if (actingMember.role === "CAPTAIN") {
      if (targetMember.role === "LEADER") {
        return res.status(403).json({
          success: false,
          message: "Captains cannot kick the clan leader",
        });
      }

      if (targetMember.role === "CAPTAIN") {
        return res.status(403).json({
          success: false,
          message: "Captains cannot kick other captains",
        });
      }

      await prisma.clanMember.delete({
        where: {
          id: targetMember.id,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Runner kicked from the clan successfully",
        data: {
          userId: targetUserId,
          previousRole: targetMember.role,
        },
      });
    }

    /*
     * Leader can kick captains and runners.
     */
    if (actingMember.role === "LEADER") {
      if (targetMember.role === "LEADER") {
        return res.status(403).json({
          success: false,
          message: "The clan leader cannot be kicked",
        });
      }

      await prisma.clanMember.delete({
        where: {
          id: targetMember.id,
        },
      });

      return res.status(200).json({
        success: true,
        message: `${
          targetMember.role === "CAPTAIN" ? "Captain" : "Runner"
        } kicked from the clan successfully`,
        data: {
          userId: targetUserId,
          previousRole: targetMember.role,
        },
      });
    }

    return res.status(403).json({
      success: false,
      message: "You do not have permission to kick this member",
    });
  } catch (error) {
    console.log("KICK_CLAN_MEMBER_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to kick clan member",
    });
  }
};



/**
 * GET /api/clans/:clanId/details
 *
 * Public clan-dashboard endpoint.
 *
 * Authentication is optional:
 * - Logged-out user can see public clan information.
 * - Logged-in user also receives membership and permission information.
 * - Leaders receive management counts.
 */
export const getClanDetailsbyId = async (req, res) => {
  try {
    const { clanId } = req.params;
    const currentUserId = req.user?.id ?? null;

    if (!clanId || !String(clanId).trim()) {
      return res.status(400).json({
        success: false,
        message: "Clan ID is required",
      });
    }

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
          orderBy: [
            {
              role: "asc",
            },
            {
              joinedAt: "asc",
            },
          ],
        },

        _count: {
          select: {
            members: true,
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

    const memberUserIds = clan.members
      .map((member) => member.userId)
      .filter(Boolean);

    const currentUserMembership = currentUserId
      ? clan.members.find(
          (member) => String(member.userId) === String(currentUserId)
        )
      : null;

    const isCaptain =
      currentUserId !== null &&
      String(clan.captainId) === String(currentUserId);

    const isLeader =
      isCaptain ||
      String(currentUserMembership?.role ?? "").toUpperCase() === "LEADER";

    const isMember = Boolean(currentUserMembership);

    /*
     * Territory contribution grouped by member.
     */
    const territoryRows =
      memberUserIds.length === 0
        ? []
        : await safeQuery(
            "GET_CLAN_MEMBER_TERRITORY_STATS",
            () =>
              prisma.$queryRaw`
                SELECT
                  t."userId",
                  COALESCE(SUM(t."areaKm2"), 0) AS "totalAreaKm2",
                  COUNT(t.id) AS "territoryCount"
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
                GROUP BY t."userId";
              `,
            []
          );

    /*
     * Activity contribution grouped by member.
     *
     * This is queried separately from territories so an activity's
     * distance is not counted multiple times when it has multiple territories.
     */
    const activityRows =
      memberUserIds.length === 0
        ? []
        : await safeQuery(
            "GET_CLAN_MEMBER_ACTIVITY_STATS",
            () =>
              prisma.$queryRaw`
                SELECT
                  a."userId",
                  COALESCE(SUM(a."distanceKm"), 0) AS "totalDistanceKm",
                  COUNT(a.id) AS "totalActivities"
                FROM activities a
                WHERE a."userId" IN (${Prisma.join(memberUserIds)})
                  AND a."include_in_clan" = true
                GROUP BY a."userId";
              `,
            []
          );

    const territoryStatsByUser = new Map(
      territoryRows.map((row) => [
        String(row.userId),
        {
          totalAreaKm2: toNumber(row.totalAreaKm2),
          territoryCount: toNumber(row.territoryCount),
        },
      ])
    );

    const activityStatsByUser = new Map(
      activityRows.map((row) => [
        String(row.userId),
        {
          totalDistanceKm: toNumber(row.totalDistanceKm),
          totalActivities: toNumber(row.totalActivities),
        },
      ])
    );

    /*
     * Build member leaderboard.
     */
    const members = clan.members
      .map((member) => {
        const territoryStats =
          territoryStatsByUser.get(String(member.userId)) ?? {};

        const activityStats =
          activityStatsByUser.get(String(member.userId)) ?? {};

        return {
          membershipId: member.id,
          userId: member.userId,
          role: member.role,
          joinedAt: member.joinedAt,

          user: {
            id: member.user.id,
            username: member.user.username,
            fullName: member.user.fullName,
          },

          contribution: {
            territoryCount: toNumber(territoryStats.territoryCount),
            totalAreaKm2: toNumber(territoryStats.totalAreaKm2),
            totalAreaM2:
              toNumber(territoryStats.totalAreaKm2) * 1_000_000,
            totalDistanceKm: toNumber(activityStats.totalDistanceKm),
            totalActivities: toNumber(activityStats.totalActivities),
          },
        };
      })
      .sort((a, b) => {
        const areaDifference =
          b.contribution.totalAreaKm2 - a.contribution.totalAreaKm2;

        if (areaDifference !== 0) {
          return areaDifference;
        }

        return (
          b.contribution.totalDistanceKm -
          a.contribution.totalDistanceKm
        );
      })
      .map((member, index) => ({
        rank: index + 1,
        ...member,
      }));

    /*
     * Calculate total dashboard statistics.
     */
    const dashboardStats = members.reduce(
      (totals, member) => {
        totals.territoryCount += member.contribution.territoryCount;
        totals.totalAreaKm2 += member.contribution.totalAreaKm2;
        totals.totalDistanceKm += member.contribution.totalDistanceKm;
        totals.totalActivities += member.contribution.totalActivities;

        return totals;
      },
      {
        territoryCount: 0,
        totalAreaKm2: 0,
        totalDistanceKm: 0,
        totalActivities: 0,
      }
    );

    /*
     * Recent captured territories.
     */
    const recentTerritories =
      memberUserIds.length === 0
        ? []
        : await safeQuery(
            "GET_CLAN_RECENT_TERRITORIES",
            () =>
              prisma.$queryRaw`
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
              `,
            []
          );

    /*
     * Upcoming and recently completed clan events.
     */
    const clanEvents = await safeQuery(
      "GET_CLAN_DASHBOARD_EVENTS",
      () =>
        prisma.clanEvent.findMany({
          where: {
            clanId,
          },
          include: {
            _count: {
              select: {
                participants: true,
              },
            },

            ...(currentUserId
              ? {
                  participants: {
                    where: {
                      userId: currentUserId,
                    },
                    select: {
                      userId: true,
                    },
                    take: 1,
                  },
                }
              : {}),
          },
          orderBy: {
            startsAt: "desc",
          },
          take: 12,
        }),
      []
    );

    const now = new Date();

    const formattedEvents = clanEvents.map((event) => {
      const startsAt = event.startsAt
        ? new Date(event.startsAt)
        : null;

      const endsAt = event.endsAt
        ? new Date(event.endsAt)
        : null;

      let displayStatus = event.status ?? "UPCOMING";

      if (
        String(event.status).toUpperCase() !== "CANCELLED" &&
        endsAt &&
        endsAt < now
      ) {
        displayStatus = "COMPLETED";
      } else if (
        String(event.status).toUpperCase() !== "CANCELLED" &&
        startsAt &&
        endsAt &&
        startsAt <= now &&
        endsAt >= now
      ) {
        displayStatus = "ONGOING";
      }

      return {
        id: event.id,
        title: event.title,
        description: event.description ?? "",
        location: event.location ?? "",
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        status: displayStatus,
        participantCount: event._count?.participants ?? 0,
        isCurrentUserJoined:
          Array.isArray(event.participants) &&
          event.participants.length > 0,
      };
    });

    const upcomingEvents = formattedEvents
      .filter(
        (event) =>
          event.status === "UPCOMING" ||
          event.status === "ONGOING"
      )
      .sort(
        (a, b) =>
          new Date(a.startsAt).getTime() -
          new Date(b.startsAt).getTime()
      )
      .slice(0, 5);

    const recentEvents = formattedEvents
      .filter(
        (event) =>
          event.status === "COMPLETED" ||
          event.status === "CANCELLED"
      )
      .slice(0, 5);

    /*
     * Current user's pending join request.
     */
    const currentUserJoinRequest =
      currentUserId && !isMember
        ? await safeQuery(
            "GET_CURRENT_USER_CLAN_JOIN_REQUEST",
            () =>
              prisma.clanJoinRequest.findFirst({
                where: {
                  clanId,
                  userId: currentUserId,
                  status: "PENDING",
                },
                select: {
                  id: true,
                  status: true,
                  createdAt: true,
                },
              }),
            null
          )
        : null;

    /*
     * Management information is visible only to the leader.
     */
    let management = null;

    if (isLeader) {
      const [pendingJoinRequests, pendingInvites] =
        await Promise.all([
          safeQuery(
            "COUNT_CLAN_JOIN_REQUESTS",
            () =>
              prisma.clanJoinRequest.count({
                where: {
                  clanId,
                  status: "PENDING",
                },
              }),
            0
          ),

          safeQuery(
            "COUNT_CLAN_INVITES",
            () =>
              prisma.clanInvite.count({
                where: {
                  clanId,
                  status: "PENDING",
                },
              }),
            0
          ),
        ]);

      management = {
        pendingJoinRequests,
        pendingInvites,
      };
    }

    return res.status(200).json({
      success: true,
      message: "Clan details fetched successfully",

      data: {
        clan: {
          id: clan.id,
          name: clan.name,
          slug: clan.slug,
          description: clan.description ?? "",
          country: clan.country ?? "",
          logo: clan.logo,
          banner: clan.banner,
          imageUrl: clan.imageUrl,
          isPrivate: clan.isPrivate,
          visibility: clan.isPrivate ? "PRIVATE" : "PUBLIC",
          joinMethod: clan.isPrivate ? "REQUEST" : "DIRECT",

          captainId: clan.captainId,
          captain: clan.captain,

          totalXp: toNumber(clan.totalXp),
          storedTerritoryCount: toNumber(clan.territoryCount),
          storedTotalAreaKm2: toNumber(clan.totalAreaKm2),

          createdAt: clan.createdAt,
          updatedAt: clan.updatedAt,
        },

        stats: {
          totalMembers: clan._count.members,
          territoryCount: dashboardStats.territoryCount,
          totalAreaKm2: dashboardStats.totalAreaKm2,
          totalAreaM2:
            dashboardStats.totalAreaKm2 * 1_000_000,
          totalDistanceKm: dashboardStats.totalDistanceKm,
          totalActivities: dashboardStats.totalActivities,
        },

        currentUser: {
          isAuthenticated: Boolean(currentUserId),
          isMember,
          role: currentUserMembership?.role ?? null,
          joinedAt: currentUserMembership?.joinedAt ?? null,
          isCaptain,
          isLeader,

          permissions: {
            canEditClan: isLeader,
            canManageMembers: isLeader,
            canManageRequests: isLeader,
            canCreateEvent: isLeader,
            canCreateWar: isLeader,
            canJoin:
              Boolean(currentUserId) &&
              !isMember &&
              !currentUserJoinRequest,
            canLeave: isMember && !isCaptain,
          },

          joinRequest: currentUserJoinRequest,
        },

        management,

        leaderboard: members,

        members,

        events: {
          upcoming: upcomingEvents,
          recent: recentEvents,
        },

        recentTerritories: recentTerritories.map(
          (territory) => ({
            id: territory.id,
            userId: territory.userId,
            name: territory.name,
            areaKm2: toNumber(territory.areaKm2),
            areaM2: toNumber(territory.areaKm2) * 1_000_000,
            capturedAt: territory.capturedAt,

            owner: {
              userId: territory.userId,
              username: territory.username,
              fullName: territory.fullName,
            },

            activity: {
              mode: territory.mode,
              distanceKm: toNumber(territory.distanceKm),
              includeInClan: territory.includeInClan,
            },
          })
        ),
      },
    });
  } catch (error) {
    console.error("GET_CLAN_DETAILS_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch clan details",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
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

    let {
      name,
      slug,
      description,
      logo,
      banner,
      country,
      imageUrl,
      isPrivate,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Clan name is required",
      });
    }


    if (!country || !country.trim()) {
      return res.status(400).json({
        success: false,
        message: "Country is required",
      });
    }

    // Generate slug automatically if not provided
    const generateSlug = (text) => {
      return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
    };

    let baseSlug = slug && slug.trim() ? generateSlug(slug) : generateSlug(name);
    let finalSlug = baseSlug;
    let counter = 1;

    // Make slug unique
    while (
      await prisma.clan.findUnique({
        where: { slug: finalSlug },
      })
    ) {
      finalSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    const existingClanByName = await prisma.clan.findFirst({
      where: {
        name: {
          equals: name.trim(),
          mode: "insensitive",
        },
      },
    });

    if (existingClanByName) {
      return res.status(400).json({
        success: false,
        message: "Clan name already exists",
      });
    }

    const clan = await prisma.$transaction(async (tx) => {
      const createdClan = await tx.clan.create({
        data: {
          name: name.trim(),
          slug: finalSlug,
          description: description?.trim() || "",
          logo: logo || null,
          banner: banner || null,
          country: country.trim(),
          imageUrl: imageUrl?.trim() || null,
          isPrivate: isPrivate ?? false,
          captainId: userId,
        },
      });

      await tx.clanMember.create({
        data: {
          clanId: createdClan.id,
          userId,
          role: "LEADER",
        },
      });

      return createdClan;
    });

    return res.status(201).json({
      success: true,
      message: "Clan created successfully",
      data: clan,
    });
  } catch (error) {
    console.log("CREATE_CLAN_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create clan",
    });
  }
};



export const editClan = async (req, res) => {
  try {
    const userId = req.user.id;
    const { clanId } = req.params;

    const {
      name,
      slug,
      description,
      logo,
      banner,
      country,
      imageUrl,
      isPrivate,
    } = req.body;

    if (!clanId) {
      return res.status(400).json({
        success: false,
        message: "Clan ID is required",
      });
    }

    const existingClan = await prisma.clan.findUnique({
      where: {
        id: clanId,
      },
      include: {
        members: {
          where: {
            userId,
          },
          select: {
            role: true,
          },
          take: 1,
        },
      },
    });

    if (!existingClan) {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    const currentMember = existingClan.members[0];

    const canEditClan =
      existingClan.captainId === userId ||
      currentMember?.role === "LEADER";

    if (!canEditClan) {
      return res.status(403).json({
        success: false,
        message: "Only the clan leader can edit this clan",
      });
    }

    const updateData = {};

    /*
     * Update clan name
     */
    if (name !== undefined) {
      const normalizedName = String(name).trim();

      if (!normalizedName) {
        return res.status(400).json({
          success: false,
          message: "Clan name cannot be empty",
        });
      }

      const duplicateClanName = await prisma.clan.findFirst({
        where: {
          id: {
            not: clanId,
          },
          name: {
            equals: normalizedName,
            mode: "insensitive",
          },
        },
        select: {
          id: true,
        },
      });

      if (duplicateClanName) {
        return res.status(409).json({
          success: false,
          message: "Clan name already exists",
        });
      }

      updateData.name = normalizedName;
    }

    /*
     * Update country
     */
    if (country !== undefined) {
      const normalizedCountry = String(country).trim();

      if (!normalizedCountry) {
        return res.status(400).json({
          success: false,
          message: "Country cannot be empty",
        });
      }

      updateData.country = normalizedCountry;
    }

    /*
     * Update slug only when it is included in the request.
     *
     * When slug is not provided, the existing slug remains unchanged,
     * even if the clan name changes.
     */
    if (slug !== undefined) {
      const requestedSlug = String(slug).trim();

      if (!requestedSlug) {
        return res.status(400).json({
          success: false,
          message: "Clan slug cannot be empty",
        });
      }

      updateData.slug = await generateUniqueClanSlug({
        prismaClient: prisma,
        value: requestedSlug,
        excludeClanId: clanId,
      });
    }

    /*
     * Fields that may be cleared.
     */
    if (description !== undefined) {
      updateData.description =
        description === null ? "" : String(description).trim();
    }

    if (logo !== undefined) {
      updateData.logo = normalizeOptionalImage(logo);
    }

    if (banner !== undefined) {
      updateData.banner = normalizeOptionalImage(banner);
    }

    if (imageUrl !== undefined) {
      updateData.imageUrl = normalizeOptionalImage(imageUrl);
    }

    if (isPrivate !== undefined) {
      if (typeof isPrivate !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "isPrivate must be true or false",
        });
      }

      updateData.isPrivate = isPrivate;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No clan changes were provided",
      });
    }

    const updatedClan = await prisma.clan.update({
      where: {
        id: clanId,
      },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      message: "Clan updated successfully",
      data: updatedClan,
    });
  } catch (error) {
    console.error("EDIT_CLAN_ERROR:", error);

    if (error?.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Clan not found",
      });
    }

    if (error?.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Clan name or slug already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update clan",
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


const sendCurrentClanEventsToNewMember = async ({
  clanId,
  member,
}) => {
  const now = new Date();

  const events = await prisma.clanEvent.findMany({
    where: {
      clanId,

      // Include upcoming and currently active events.
      endsAt: {
        gt: now,
      },

      // Do not send cancelled-event invitations.
      status: {
        not: "CANCELLED",
      },
    },

    include: {
      clan: {
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
          banner: true,
        },
      },

      createdBy: {
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
        },
      },

      _count: {
        select: {
          participants: true,
        },
      },
    },

    orderBy: {
      startsAt: "asc",
    },
  });

  const result = {
    eventsFound: events.length,
    attempted: 0,
    sent: 0,
    failed: 0,
    failures: [],
  };

  if (events.length === 0) {
    return result;
  }

  if (!member?.user?.email) {
    result.failed = events.length;
    result.failures.push({
      message: "The new member does not have an email address",
    });

    return result;
  }

  /*
   * sendClanEventInvitations expects a list of clan members.
   * We pass only the newly joined member, so existing members
   * do not receive duplicate event invitations.
   */
  const invitationMember = {
    id: member.id,
    userId: member.userId,
    role: member.role,
    user: {
      id: member.user.id,
      email: member.user.email,
      username: member.user.username,
      fullName: member.user.fullName,
    },
  };

  for (const event of events) {
    try {
      const emailResult = await sendClanEventInvitations({
        event,
        clan: event.clan,
        creator: event.createdBy,
        members: [invitationMember],
      });

      result.attempted += emailResult?.attempted ?? 1;
      result.sent += emailResult?.sent ?? 0;
      result.failed += emailResult?.failed ?? 0;

      if (Array.isArray(emailResult?.failures)) {
        result.failures.push(
          ...emailResult.failures.map((failure) => ({
            eventId: event.id,
            eventTitle: event.title,
            ...failure,
          })),
        );
      }
    } catch (error) {
      result.attempted += 1;
      result.failed += 1;

      result.failures.push({
        eventId: event.id,
        eventTitle: event.title,
        message: error.message,
      });

      console.error(
        `NEW_MEMBER_EVENT_EMAIL_ERROR [${event.id}]:`,
        error,
      );
    }
  }

  return result;
};



export const joinClanDirectly = async (req, res) => {
  try {
    const userId = req.user.id;
    const { clanId } = req.params;

    if (!clanId?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Clan ID is required",
      });
    }

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

    /*
     * A user can only belong to one clan.
     */
    const existingMembership = await prisma.clanMember.findFirst({
      where: {
        userId,
      },

      select: {
        id: true,
        clanId: true,
        role: true,
      },
    });

    if (existingMembership) {
      return res.status(400).json({
        success: false,
        message:
          existingMembership.clanId === clanId
            ? "You are already a member of this clan"
            : "You are already a member of another clan",
      });
    }

    /*
     * Include the user's email because it will be used to send
     * invitations for existing clan events.
     */
    const member = await prisma.clanMember.create({
      data: {
        clanId,
        userId,
        role: "RUNNER",
      },

      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            fullName: true,
          },
        },

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

    /*
     * Email failure must never cancel or undo the successful
     * clan membership creation.
     */
    let eventEmailResult = {
      eventsFound: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
      failures: [],
    };

    try {
      eventEmailResult =
        await sendCurrentClanEventsToNewMember({
          clanId,
          member,
        });
    } catch (emailError) {
      console.error(
        "JOIN_CLAN_EXISTING_EVENT_EMAIL_ERROR:",
        emailError,
      );
    }

    let eventInvitationMessage;

    if (eventEmailResult.eventsFound === 0) {
      eventInvitationMessage =
        "The clan currently has no upcoming events";
    } else if (eventEmailResult.sent > 0) {
      eventInvitationMessage =
        eventEmailResult.sent === 1
          ? "An existing club event invitation was sent to your email"
          : `${eventEmailResult.sent} existing club event invitations were sent to your email`;
    } else {
      eventInvitationMessage =
        "You joined successfully, but the existing event emails could not be sent";
    }

    return res.status(200).json({
      success: true,
      message: "Joined clan successfully",
      eventInvitationMessage,

      data: member,

      eventEmails: {
        eventsFound: eventEmailResult.eventsFound,
        attempted: eventEmailResult.attempted,
        sent: eventEmailResult.sent,
        failed: eventEmailResult.failed,
      },
    });
  } catch (error) {
    console.error("JOIN_CLAN_DIRECTLY_ERROR:", error);

    if (error?.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "You are already a member of a clan",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to join clan",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
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




// export const leaveClan = async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const result = await prisma.$transaction(async (tx) => {
//       const membership = await tx.clanMember.findFirst({
//         where: {
//           userId,
//         },
//         include: {
//           clan: true,
//         },
//       });

//       if (!membership) {
//         return {
//           status: 404,
//           body: {
//             success: false,
//             message: "You are not in any clan",
//           },
//         };
//       }

//       const clanId = membership.clanId;
//       const isLeader = membership.clan.captainId === userId;

//       if (isLeader) {
//         const newLeader = await tx.clanMember.findFirst({
//           where: {
//             clanId,
//             userId: {
//               not: userId,
//             },
//           },
//           orderBy: {
//             joinedAt: "asc",
//           },
//         });

//         if (!newLeader) {
//           return {
//             status: 400,
//             body: {
//               success: false,
//               message:
//                 "You are the only member in this clan. Delete the clan instead of leaving.",
//             },
//           };
//         }

//         await tx.clan.update({
//           where: {
//             id: clanId,
//           },
//           data: {
//             captainId: newLeader.userId,
//           },
//         });

//         await tx.clanMember.update({
//           where: {
//             id: newLeader.id,
//           },
//           data: {
//             role: "LEADER",
//           },
//         });
//       }

//       await tx.clanMember.delete({
//         where: {
//           id: membership.id,
//         },
//       });

//       return {
//         status: 200,
//         body: {
//           success: true,
//           message: isLeader
//             ? "You left the clan. A new leader has been promoted."
//             : "Successfully left the clan",
//         },
//       };
//     });

//     return res.status(result.status).json(result.body);
//   } catch (error) {
//     console.log("LEAVE_CLAN_ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to leave clan",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };



export const leaveClan = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const membership = await tx.clanMember.findFirst({
        where: { userId },
        include: { clan: true },
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
        const otherMember = await tx.clanMember.findFirst({
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

        // If leader is the only member, delete whole clan
        if (!otherMember) {
          await tx.clanMember.deleteMany({
            where: { clanId },
          });

          await tx.clan.delete({
            where: { id: clanId },
          });

          return {
            status: 200,
            body: {
              success: true,
              message: "You were the only member. Clan deleted successfully.",
            },
          };
        }

        // Promote oldest member as new leader
        await tx.clan.update({
          where: { id: clanId },
          data: {
            captainId: otherMember.userId,
          },
        });

        await tx.clanMember.update({
          where: { id: otherMember.id },
          data: {
            role: "LEADER",
          },
        });
      }

      await tx.clanMember.delete({
        where: { id: membership.id },
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


/**
 * ============================================================================
 * CANCEL SENT FRIEND REQUEST
 * ============================================================================
 */

export const cancelFriendRequest = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { requestId } = req.params;

    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Friend request not found",
      });
    }

    if (request.senderId !== senderId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized. You can only cancel your own sent request.",
      });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Only pending requests can be cancelled",
      });
    }

    await prisma.friendRequest.delete({
      where: { id: requestId },
    });

    return res.status(200).json({
      success: true,
      message: "Friend request cancelled successfully",
    });
  } catch (error) {
    console.error("CANCEL_FRIEND_REQUEST_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};


/**
 * |--------------------------------------------------------------------------
 * | CHECK IF CURRENT USER IS A CLAN LEADER
 * |--------------------------------------------------------------------------
 * | GET /api/clans/check-leader
 * |--------------------------------------------------------------------------
 */

export const checkIfClanLeader = async (req, res) => {
  try {
    const userId = req.user.id;

    const membership = await prisma.clanMember.findFirst({
      where: {
        userId,
      },
      select: {
        id: true,
        clanId: true,
        role: true,
        joinedAt: true,

        clan: {
          select: {
            id: true,
            name: true,
            slug: true,
            captainId: true,
            logo: true,
            banner: true,
          },
        },
      },
    });

    // User is not in any clan
    if (!membership) {
      return res.status(200).json({
        success: true,
        isInClan: false,
        isLeader: false,
        isCaptain: false,
        role: null,
        clan: null,
      });
    }

    const isCaptain = membership.clan.captainId === userId;

    const isLeader =
      isCaptain ||
      membership.role === "LEADER" ||
      membership.role === "CAPTAIN";

    return res.status(200).json({
      success: true,
      isInClan: true,
      isLeader,
      isCaptain,
      role: membership.role,

      clan: {
        id: membership.clan.id,
        name: membership.clan.name,
        slug: membership.clan.slug,
        logo: membership.clan.logo,
        banner: membership.clan.banner,
      },
    });
  } catch (error) {
    console.error("CHECK_IF_CLAN_LEADER_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to check clan leader status",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};