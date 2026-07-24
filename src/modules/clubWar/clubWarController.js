// controllers/clubWarController.js
import prisma from "../../config/prisma.js";
import { DateTime } from "luxon";

const TARGET_DISTANCE_KM = 20;

const getUserClan = async (userId) => {
  return prisma.clanMember.findFirst({
    where: { userId },
    include: { clan: true },
  });
};

const calculateParticipantStats = async ({ warId, clanId, startsAt, endsAt }) => {
  const members = await prisma.clanMember.findMany({
    where: { clanId },
    select: { userId: true },
  });

  const memberIds = members.map((m) => m.userId);
  const memberCount = memberIds.length;

  if (memberCount === 0) {
    return {
      memberCount: 0,
      activeMembers: 0,
      totalDistanceKm: 0,
      avgDistanceKm: 0,
      activeScore: 0,
      distanceScore: 0,
      finalScore: 0,
    };
  }

  const activities = await prisma.activity.findMany({
    where: {
      userId: { in: memberIds },
      includeInClan: true,
      distanceKm: { gte: 1 },
      startedAt: {
        gte: startsAt,
        lte: endsAt,
      },
      mode: {
        in: ["WALK", "RUN", "CYCLE"],
      },
    },
    select: {
      userId: true,
      distanceKm: true,
    },
  });

  const activeUserIds = new Set(activities.map((a) => a.userId));
  const activeMembers = activeUserIds.size;

  const totalDistanceKm = activities.reduce(
    (sum, activity) => sum + Number(activity.distanceKm || 0),
    0
  );

  const avgDistanceKm =
    activeMembers > 0 ? totalDistanceKm / activeMembers : 0;

  const activeScore =
    memberCount > 0 ? (activeMembers / memberCount) * 100 : 0;

  const distanceScore = Math.min(
    (avgDistanceKm / TARGET_DISTANCE_KM) * 100,
    100
  );

  const finalScore = activeScore * 0.4 + distanceScore * 0.6;

  return {
    memberCount,
    activeMembers,
    totalDistanceKm,
    avgDistanceKm,
    activeScore,
    distanceScore,
    finalScore,
  };
};

export const createManualClubWar = async (req, res) => {
  try {
    const userId = req.user.id;
    const { opponentClanId, startsAt, endsAt } = req.body;

    if (!opponentClanId || !startsAt || !endsAt) {
      return res.status(400).json({
        success: false,
        message: "opponentClanId, startsAt and endsAt are required",
      });
    }

    const requestedStartsAt = new Date(startsAt);
    const requestedEndsAt = new Date(endsAt);

    if (
      Number.isNaN(requestedStartsAt.getTime()) ||
      Number.isNaN(requestedEndsAt.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid startsAt or endsAt date",
      });
    }

    if (requestedStartsAt >= requestedEndsAt) {
      return res.status(400).json({
        success: false,
        message: "War start time must be before end time",
      });
    }

    // Find the authenticated user's clan membership
    const myClanMember = await prisma.clanMember.findFirst({
      where: {
        userId,
      },
      select: {
        clanId: true,
        role: true,
      },
    });

    if (!myClanMember) {
      return res.status(404).json({
        success: false,
        message: "You are not in a clan",
      });
    }

    // Only the clan leader can challenge another clan
    if (myClanMember.role?.toUpperCase() !== "LEADER") {
      return res.status(403).json({
        success: false,
        message: "Only the clan leader can challenge another clan",
      });
    }

    const challengerClanId = myClanMember.clanId;

    if (challengerClanId === opponentClanId) {
      return res.status(400).json({
        success: false,
        message: "You cannot challenge your own clan",
      });
    }

    const opponentClan = await prisma.clan.findUnique({
      where: {
        id: opponentClanId,
      },
      select: {
        id: true,
      },
    });

    if (!opponentClan) {
      return res.status(404).json({
        success: false,
        message: "Opponent clan not found",
      });
    }

    const overlappingWar = await prisma.clubWar.findFirst({
      where: {
        status: {
          in: ["PENDING", "ACTIVE"],
        },
        startsAt: {
          lt: requestedEndsAt,
        },
        endsAt: {
          gt: requestedStartsAt,
        },
        participants: {
          some: {
            clanId: {
              in: [challengerClanId, opponentClanId],
            },
          },
        },
      },
      include: {
        challengerClan: true,
        opponentClan: true,
        participants: true,
      },
    });

    if (overlappingWar) {
      return res.status(400).json({
        success: false,
        message:
          "One of these clans already has a pending or active war during this time period",
        overlappingWar,
      });
    }

    const war = await prisma.clubWar.create({
      data: {
        type: "MANUAL",
        status: "PENDING",
        challengerClanId,
        opponentClanId,
        createdByUserId: userId,
        startsAt: requestedStartsAt,
        endsAt: requestedEndsAt,
        participants: {
          create: [
            {
              clanId: challengerClanId,
            },
            {
              clanId: opponentClanId,
            },
          ],
        },
      },
      include: {
        participants: true,
        challengerClan: true,
        opponentClan: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Club war challenge sent",
      war,
    });
  } catch (error) {
    console.error("CREATE_MANUAL_CLUB_WAR_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create club war",
    });
  }
};

export const acceptClubWar = async (req, res) => {
  try {
    const userId = req.user.id;
    const { warId } = req.params;

    const myClanMember = await getUserClan(userId);

    if (!myClanMember) {
      return res.status(404).json({
        success: false,
        message: "You are not in a clan",
      });
    }

    const war = await prisma.clubWar.findUnique({
      where: { id: warId },
    });

    if (!war) {
      return res.status(404).json({
        success: false,
        message: "War not found",
      });
    }

    if (war.opponentClanId !== myClanMember.clanId) {
      return res.status(403).json({
        success: false,
        message: "Only the challenged clan can accept this war",
      });
    }

    const updatedWar = await prisma.clubWar.update({
      where: { id: warId },
      data: {
        status: "ACTIVE",
        acceptedAt: new Date(),
      },
      include: {
        participants: true,
      },
    });

    return res.json({
      success: true,
      message: "Club war accepted",
      war: updatedWar,
    });
  } catch (error) {
    console.error("Accept club war error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to accept club war",
    });
  }
};

export const declineClubWar = async (req, res) => {
  try {
    const userId = req.user.id;
    const { warId } = req.params;

    const myClanMember = await getUserClan(userId);

    if (!myClanMember) {
      return res.status(404).json({
        success: false,
        message: "You are not in a clan",
      });
    }

    const war = await prisma.clubWar.findUnique({
      where: { id: warId },
    });

    if (!war) {
      return res.status(404).json({
        success: false,
        message: "War not found",
      });
    }

    if (war.opponentClanId !== myClanMember.clanId) {
      return res.status(403).json({
        success: false,
        message: "Only the challenged clan can decline this war",
      });
    }

    const updatedWar = await prisma.clubWar.update({
      where: { id: warId },
      data: {
        status: "DECLINED",
        declinedAt: new Date(),
      },
    });

    return res.json({
      success: true,
      message: "Club war declined",
      war: updatedWar,
    });
  } catch (error) {
    console.error("Decline club war error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to decline club war",
    });
  }
};


export const recalculateClubWar = async (req, res) => {
  try {
    const { warId } = req.params;

    const war = await prisma.clubWar.findUnique({
      where: { id: warId },
      include: {
        participants: true,
      },
    });

    if (!war) {
      return res.status(404).json({
        success: false,
        message: "War not found",
      });
    }

    const updatedParticipants = [];

    for (const participant of war.participants) {
      const stats = await calculateParticipantStats({
        warId,
        clanId: participant.clanId,
        startsAt: war.startsAt,
        endsAt: war.endsAt,
      });

      const updated = await prisma.clubWarParticipant.update({
        where: {
          warId_clanId: {
            warId,
            clanId: participant.clanId,
          },
        },
        data: stats,
      });

      updatedParticipants.push(updated);
    }

    return res.json({
      success: true,
      message: "War score recalculated",
      participants: updatedParticipants,
    });
  } catch (error) {
    console.error("Recalculate club war error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to recalculate war score",
    });
  }
};

export const getActiveClubWar = async (req, res) => {
  try {
    const userId = req.user.id;

    const myClanMember = await getUserClan(userId);

    if (!myClanMember) {
      return res.status(404).json({
        success: false,
        message: "You are not in a clan",
      });
    }

    const war = await prisma.clubWar.findFirst({
      where: {
        status: "ACTIVE",
        participants: {
          some: {
            clanId: myClanMember.clanId,
          },
        },
      },
      include: {
        challengerClan: true,
        opponentClan: true,
        participants: {
          include: {
            clan: true,
          },
          orderBy: {
            finalScore: "desc",
          },
        },
      },
    });

    return res.json({
      success: true,
      war,
    });
  } catch (error) {
    console.error("Get active club war error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get active club war",
    });
  }
};

export const getMyClanWars = async (req, res) => {
  try {
    const userId = req.user.id;

    const myClanMember = await getUserClan(userId);

    if (!myClanMember) {
      return res.status(404).json({
        success: false,
        message: "You are not in a clan",
      });
    }

    const wars = await prisma.clubWar.findMany({
      where: {
        participants: {
          some: {
            clanId: myClanMember.clanId,
          },
        },
      },
      include: {
        challengerClan: true,
        opponentClan: true,
        participants: {
          include: {
            clan: true,
          },
          orderBy: {
            finalScore: "desc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({
      success: true,
      wars,
    });
  } catch (error) {
    console.error("Get my clan wars error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get clan wars",
    });
  }
};

export const runAutomaticMatchmaking = async (req, res) => {
  try {
    const kathmanduNow = DateTime.now().setZone("Asia/Kathmandu");

    const startsAtKathmandu = kathmanduNow
      .plus({ days: 1 })
      .set({
        hour: 7,
        minute: 0,
        second: 0,
        millisecond: 0,
      });

    const endsAtKathmandu = kathmanduNow
      .plus({ days: 1 })
      .set({
        hour: 10,
        minute: 0,
        second: 0,
        millisecond: 0,
      });

    const startsAt = startsAtKathmandu.toUTC().toJSDate();
    const endsAt = endsAtKathmandu.toUTC().toJSDate();

    const seasonName = `Saturday War ${startsAtKathmandu.toFormat(
      "yyyy-MM-dd"
    )}`;

    const clans = await prisma.clan.findMany({
      include: {
        members: true,
        warStats: {
          orderBy: { finalScore: "desc" },
          take: 3,
        },
      },
    });

    const eligibleClans = clans
      .filter((clan) => clan.members.length >= 2)
      .map((clan) => {
        const averagePreviousScore =
          clan.warStats.length > 0
            ? clan.warStats.reduce(
                (sum, stat) => sum + Number(stat.finalScore || 0),
                0
              ) / clan.warStats.length
            : 0;

        return {
          ...clan,
          memberCount: clan.members.length,
          averagePreviousScore,
        };
      })
      .sort((a, b) => {
        if (a.memberCount !== b.memberCount) {
          return a.memberCount - b.memberCount;
        }

        return b.averagePreviousScore - a.averagePreviousScore;
      });

    const createdWars = [];

    for (let i = 0; i < eligibleClans.length - 1; i += 2) {
      const clanA = eligibleClans[i];
      const clanB = eligibleClans[i + 1];

      const alreadyHasScheduledOrActiveWar = await prisma.clubWar.findFirst({
        where: {
          status: {
            in: ["PENDING", "ACTIVE"],
          },
          OR: [
            {
              participants: {
                some: {
                  clanId: clanA.id,
                },
              },
            },
            {
              participants: {
                some: {
                  clanId: clanB.id,
                },
              },
            },
          ],
        },
      });

      if (alreadyHasScheduledOrActiveWar) continue;

      const war = await prisma.clubWar.create({
        data: {
          type: "AUTOMATIC",
          status: "PENDING",
          seasonName,
          challengerClanId: clanA.id,
          opponentClanId: clanB.id,
          startsAt,
          endsAt,

          participants: {
            create: [{ clanId: clanA.id }, { clanId: clanB.id }],
          },
        },
        include: {
          participants: true,
          challengerClan: true,
          opponentClan: true,
        },
      });

      createdWars.push(war);
    }

    return res.json({
      success: true,
      message: "Saturday automatic club wars scheduled",
      schedule: {
        createdAtKathmandu: kathmanduNow.toISO(),
        startsAtKathmandu: startsAtKathmandu.toISO(),
        endsAtKathmandu: endsAtKathmandu.toISO(),
        startsAtUTC: startsAt,
        endsAtUTC: endsAt,
      },
      createdWars,
    });
  } catch (error) {
    console.error("Automatic matchmaking error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to run automatic matchmaking",
    });
  }
};

export const completeExpiredClubWars = async (req, res) => {
  try {
    const now = new Date();

    const wars = await prisma.clubWar.findMany({
      where: {
        status: "ACTIVE",
        endsAt: {
          lt: now,
        },
      },
      include: {
        participants: true,
      },
    });

    const completedWars = [];

    for (const war of wars) {
      const updatedParticipants = [];

      for (const participant of war.participants) {
        const stats = await calculateParticipantStats({
          warId: war.id,
          clanId: participant.clanId,
          startsAt: war.startsAt,
          endsAt: war.endsAt,
        });

        const updated = await prisma.clubWarParticipant.update({
          where: {
            warId_clanId: {
              warId: war.id,
              clanId: participant.clanId,
            },
          },
          data: stats,
        });

        updatedParticipants.push(updated);
      }

      const sorted = updatedParticipants.sort(
        (a, b) => b.finalScore - a.finalScore
      );

      let winnerClanId = null;

      if (sorted.length >= 2 && sorted[0].finalScore !== sorted[1].finalScore) {
        winnerClanId = sorted[0].clanId;
      }

      for (const participant of updatedParticipants) {
        let result = "DRAW";

        if (winnerClanId) {
          result = participant.clanId === winnerClanId ? "WIN" : "LOSE";
        }

        await prisma.clubWarParticipant.update({
          where: {
            warId_clanId: {
              warId: war.id,
              clanId: participant.clanId,
            },
          },
          data: {
            result,
          },
        });
      }

      const completedWar = await prisma.clubWar.update({
        where: { id: war.id },
        data: {
          status: "COMPLETED",
          winnerClanId,
        },
        include: {
          participants: true,
          winnerClan: true,
        },
      });

      completedWars.push(completedWar);
    }

    return res.json({
      success: true,
      message: "Expired wars completed",
      completedWars,
    });
  } catch (error) {
    console.error("Complete expired wars error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to complete expired wars",
    });
  }
};

export const activateScheduledClubWars = async (req, res) => {
  try {
    const now = new Date();

    const result = await prisma.clubWar.updateMany({
      where: {
        status: "PENDING",
        startsAt: {
          lte: now,
        },
      },
      data: {
        status: "ACTIVE",
        acceptedAt: now,
      },
    });

    return res.json({
      success: true,
      message: "Scheduled club wars activated",
      activatedCount: result.count,
    });
  } catch (error) {
    console.error("Activate scheduled wars error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to activate scheduled club wars",
    });
  }
};

