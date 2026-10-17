import prisma from "../../config/prisma.js";

import { sendClanEventInvitations } from "./clanEventEmail.service.js";

import { sendFCMToUser } from "../../config/fcm.service.js";
import { createNotification } from "../notification/notification.controller.js";

/**
 * |--------------------------------------------------------------------------
 * | GET CURRENT USER'S CLAN MEMBERSHIP
 * |--------------------------------------------------------------------------
 */

function formatPace(secPerKm) {
  if (secPerKm == null) return null;

  const totalSeconds = Math.round(Number(secPerKm));

  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return null;
  }

  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}

const getUserClanMembership = async (userId) => {
  return prisma.clanMember.findFirst({
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
          logo: true,
          banner: true,
          imageUrl: true,
          captainId: true,
        },
      },
    },
  });
};

const checkEventManagementAccess = async ({ event, userId }) => {
  // ============================================================
  // PUBLIC / STANDALONE EVENT
  // ============================================================

  if (!event.clanId) {
    const allowed =
      event.createdById === userId || event.runLeaderId === userId;

    return {
      allowed,
      status: allowed ? 200 : 403,
      message: allowed ? null : "Only the event creator can manage this event",
    };
  }

  // ============================================================
  // CLUB EVENT
  // ============================================================

  const access = await checkClanLeaderAccess(userId);

  if (!access.allowed) {
    return access;
  }

  if (access.membership.clanId !== event.clanId) {
    return {
      allowed: false,
      status: 403,
      message: "This event does not belong to your club",
    };
  }

  return access;
};

/**
 * |--------------------------------------------------------------------------
 * | GENERAL CLAN EVENT MANAGEMENT ACCESS
 * |--------------------------------------------------------------------------
 *
 * This keeps your existing behavior.
 *
 * LEADER and CAPTAIN can manage ordinary event administration.
 *
 * IMPORTANT:
 * This helper is NOT used to decide who can establish the official
 * Club Event activity cutoff.
 */

const checkClanLeaderAccess = async (userId) => {
  const membership = await getUserClanMembership(userId);

  if (!membership) {
    return {
      allowed: false,
      membership: null,
      clan: null,
      status: 404,
      message: "You are not a member of any clan",
    };
  }

  const isCaptain = membership.clan.captainId === userId;

  const isLeader =
    membership.role === "LEADER" || membership.role === "CAPTAIN";

  return {
    allowed: isCaptain || isLeader,

    membership,

    clan: membership.clan,

    status: isCaptain || isLeader ? 200 : 403,

    message:
      isCaptain || isLeader
        ? null
        : "Only the clan leader can perform this action",
  };
};

/**
 * |--------------------------------------------------------------------------
 * | RESOLVE STRICT CLUB EVENT RUN LEADER
 * |--------------------------------------------------------------------------
 *
 * This is different from normal event administration.
 *
 * CAPTAIN:
 * - can manage ordinary event details according to your existing system
 * - can participate in the event
 * - CANNOT stop the entire event
 *
 * LEADER:
 * - controls the official event cutoff
 */

const resolveClanRunLeaderId = async (clanId) => {
  /**
   * First prefer the actual LEADER membership.
   */
  const leaderMembership = await prisma.clanMember.findFirst({
    where: {
      clanId,
      role: "LEADER",
    },

    select: {
      userId: true,
    },
  });

  if (leaderMembership?.userId) {
    return leaderMembership.userId;
  }

  /**
   * Fallback for older clan records.
   */
  const clan = await prisma.clan.findUnique({
    where: {
      id: clanId,
    },

    select: {
      captainId: true,
    },
  });

  return clan?.captainId ?? null;
};

/**
 * |--------------------------------------------------------------------------
 * | CHECK STRICT RUN LEADER
 * |--------------------------------------------------------------------------
 */

// const isStrictClanRunLeader = ({ membership, userId, runLeaderId }) => {
//   // Once the event has an official leader,
//   // simply compare against that user ID.
//   if (runLeaderId) {
//     return runLeaderId === userId;
//   }

//   // An outside participant cannot become the run leader.
//   if (!membership) {
//     return false;
//   }

//   return membership.role === "LEADER" || membership.clan?.captainId === userId;
// };

/**
 * |--------------------------------------------------------------------------
 * | GET CLUB EVENT RUN CONTEXT
 * |--------------------------------------------------------------------------
 */

const getEventRunContext = async ({ eventId, userId }) => {
  const event = await prisma.clanEvent.findUnique({
    where: {
      id: eventId,
    },

    include: {
      clan: {
        select: {
          id: true,
          name: true,
          captainId: true,
        },
      },

      runLeader: {
        select: {
          id: true,
          username: true,
          fullName: true,
        },
      },
    },
  });

  if (!event) {
    return {
      event: null,
      membership: null,
      participant: null,
    };
  }

  const membershipPromise = event.clanId
    ? prisma.clanMember.findUnique({
        where: {
          clanId_userId: {
            clanId: event.clanId,
            userId,
          },
        },

        select: {
          id: true,
          clanId: true,
          userId: true,
          role: true,
          joinedAt: true,

          clan: {
            select: {
              id: true,
              captainId: true,
            },
          },
        },
      })
    : Promise.resolve(null);

  const participantPromise = prisma.clanEventParticipant.findUnique({
    where: {
      eventId_userId: {
        eventId,
        userId,
      },
    },
  });

  const [membership, participant] = await Promise.all([
    membershipPromise,
    participantPromise,
  ]);

  return {
    event,
    membership,
    participant,
  };
};

/**
 * |--------------------------------------------------------------------------
 * | PARSE EVENT STATS
 * |--------------------------------------------------------------------------
 */
const parseEventStats = (body, { partial = false } = {}) => {
  const floatFields = [
    "distanceKm",
    "calories",
    "elevationGain",
    "avgPace",
    "avgSpeed",
    "topSpeed",
  ];

  const integerFields = ["elapsedTime", "movingTime"];

  const data = {};

  for (const field of floatFields) {
    const raw = body?.[field];

    if (raw === undefined || raw === null || raw === "") {
      if (
        !partial &&
        ["distanceKm", "calories", "elevationGain"].includes(field)
      ) {
        data[field] = 0;
      }

      continue;
    }

    const value = Number(raw);

    if (!Number.isFinite(value) || value < 0) {
      const error = new Error(`${field} must be a non-negative number`);
      error.code = "INVALID_EVENT_STATS";
      throw error;
    }

    data[field] = value;
  }

  for (const field of integerFields) {
    const raw = body?.[field];

    if (raw === undefined || raw === null || raw === "") {
      if (!partial) {
        data[field] = 0;
      }

      continue;
    }

    const value = Number(raw);

    if (!Number.isFinite(value) || value < 0) {
      const error = new Error(`${field} must be a non-negative number`);
      error.code = "INVALID_EVENT_STATS";
      throw error;
    }

    data[field] = Math.round(value);
  }

  // ============================================================
  // KM SPLITS
  // Same structure used by normal Activity
  // ============================================================

  if (body?.kmSplits !== undefined) {
    if (!Array.isArray(body.kmSplits)) {
      const error = new Error("kmSplits must be an array");
      error.code = "INVALID_EVENT_STATS";
      throw error;
    }

    data.kmSplits = body.kmSplits;
  } else if (!partial) {
    data.kmSplits = [];
  }

  return data;
};

const EVENT_AUTO_END_GRACE_MS = 4 * 60 * 1000;
const INDEPENDENT_EVENT_REMINDER_MINUTES = 25;

export const sendIndependentEventStartReminders = async () => {
  const now = new Date();

  // Scheduler runs every minute.
  //
  // Find events starting roughly 25 minutes from now.
  // This one-minute window prevents missed reminders caused by
  // small scheduler timing differences.
  const reminderWindowStart = new Date(
    now.getTime() + (INDEPENDENT_EVENT_REMINDER_MINUTES - 1) * 60 * 1000,
  );

  const reminderWindowEnd = new Date(
    now.getTime() + INDEPENDENT_EVENT_REMINDER_MINUTES * 60 * 1000,
  );

  try {
    const events = await prisma.clanEvent.findMany({
      where: {
        // INDEPENDENT / PUBLIC EVENTS ONLY
        clanId: null,

        status: "UPCOMING",

        runStartedAt: null,

        startReminderSentAt: null,

        startsAt: {
          gte: reminderWindowStart,
          lte: reminderWindowEnd,
        },
      },

      select: {
        id: true,
        title: true,
        location: true,
        startsAt: true,

        participants: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (events.length === 0) {
      return;
    }

    for (const event of events) {
      /**
       * Claim the reminder atomically.
       *
       * This protects against:
       * - two cron executions overlapping
       * - multiple Render instances
       * - accidental duplicate scheduler calls
       */
      const claim = await prisma.clanEvent.updateMany({
        where: {
          id: event.id,
          startReminderSentAt: null,
          status: "UPCOMING",
          clanId: null,
        },

        data: {
          startReminderSentAt: now,
        },
      });

      if (claim.count === 0) {
        continue;
      }

      const uniqueParticipantIds = [
        ...new Set(
          event.participants
            .map((participant) => participant.userId)
            .filter(Boolean),
        ),
      ];

      if (uniqueParticipantIds.length === 0) {
        continue;
      }

      const participantUsers = await prisma.user.findMany({
        where: {
          id: {
            in: uniqueParticipantIds,
          },
        },

        select: {
          id: true,
          fcmToken: true,
        },
      });

      const seenTokens = new Set();

      const usersWithUniqueTokens = [];

      for (const user of participantUsers) {
        const token = user.fcmToken?.trim();

        if (!token) {
          continue;
        }

        if (seenTokens.has(token)) {
          continue;
        }

        seenTokens.add(token);

        usersWithUniqueTokens.push(user);
      }

      // if (usersWithUniqueTokens.length === 0) {
      //   continue;
      // }

      const title = "Your event starts in 25 minutes";

      const message = event.location
        ? `${event.title} starts soon at ${event.location}. Get ready and open DURO before the start.`
        : `${event.title} starts soon. Get ready and open DURO before the start.`;

      // ============================================================
      // SAVE IN-APP NOTIFICATION FOR EVERY PARTICIPANT
      // ============================================================

      const savedNotifications = await Promise.all(
        uniqueParticipantIds.map((userId) =>
          createNotification({
            userId,

            title,

            message,

            type: "SYSTEM",

            // Save event ID directly in Notification table
            eventId: event.id,

            data: {
              type: "INDEPENDENT_EVENT_START_REMINDER",
              eventId: event.id,
              eventType: "PUBLIC",
              title: event.title,
              startsAt: event.startsAt.toISOString(),
            },
          }),
        ),
      );

      // Map notification ID by user
      const notificationIdByUser = new Map();

      uniqueParticipantIds.forEach((userId, index) => {
        notificationIdByUser.set(userId, savedNotifications[index]?.id ?? "");
      });

      // ============================================================
      // SEND ONLY ONE PUSH PER UNIQUE DEVICE
      // ============================================================

      const results = await Promise.allSettled(
        usersWithUniqueTokens.map((user) =>
          sendFCMToUser({
            userId: user.id,

            title,

            message,

            data: {
              type: "INDEPENDENT_EVENT_START_REMINDER",
              eventId: event.id,
              eventType: "PUBLIC",
              title: event.title,
              startsAt: event.startsAt.toISOString(),

              notificationId: notificationIdByUser.get(user.id) ?? "",
            },
          }),
        ),
      );

      const sent = results.filter(
        (result) => result.status === "fulfilled" && Boolean(result.value),
      ).length;

      const failed = usersWithUniqueTokens.length - sent;

      // console.log("INDEPENDENT_EVENT_START_REMINDER:", {
      //   eventId: event.id,
      //   title: event.title,
      //   participants: uniqueParticipantIds.length,
      //   uniqueDevices: usersWithUniqueTokens.length,
      //   sent,
      //   failed,
      //   startsAt: event.startsAt,
      // });
    }
  } catch (error) {
    console.error("INDEPENDENT_EVENT_REMINDER_ERROR:", error);
  }
};

/**
 * Automatically ends a Club Event if:
 *
 * - the event run was actually started
 * - the leader has NOT ended it
 * - it is not already completed/cancelled
 * - scheduled endsAt + 30 minutes has passed
 *
 * The automatic global cutoff is:
 *
 * endsAt + 30 minutes
 *
 * NOT the time this function happens to run.
 */
const autoEndExpiredClanEvent = async (eventId) => {
  const event = await prisma.clanEvent.findUnique({
    where: {
      id: eventId,
    },

    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      runStartedAt: true,
      leaderStoppedAt: true,
      completedAt: true,
    },
  });

  if (!event) {
    return {
      ended: false,
      event: null,
    };
  }

  // Already finished or cancelled.
  if (
    event.status === "COMPLETED" ||
    event.status === "CANCELLED" ||
    event.leaderStoppedAt
  ) {
    return {
      ended: false,
      event,
    };
  }

  // Do not auto-complete an event that never actually started.
  if (!event.runStartedAt) {
    return {
      ended: false,
      event,
    };
  }

  if (!event.endsAt) {
    return {
      ended: false,
      event,
    };
  }

  const scheduledEndMs = new Date(event.endsAt).getTime();

  if (!Number.isFinite(scheduledEndMs)) {
    return {
      ended: false,
      event,
    };
  }

  const automaticCutoffAt = new Date(scheduledEndMs + EVENT_AUTO_END_GRACE_MS);

  // Still inside the 30-minute grace period.
  if (Date.now() < automaticCutoffAt.getTime()) {
    return {
      ended: false,
      event,
    };
  }

  /**
   * Use updateMany for duplicate/race protection.
   *
   * If two requests arrive at the same moment,
   * only one should perform the automatic close.
   */
  const eventUpdate = await prisma.clanEvent.updateMany({
    where: {
      id: eventId,

      status: {
        notIn: ["COMPLETED", "CANCELLED"],
      },

      leaderStoppedAt: null,

      runStartedAt: {
        not: null,
      },
    },

    data: {
      status: "COMPLETED",

      // This is now the authoritative automatic event cutoff.
      leaderStoppedAt: automaticCutoffAt,
    },
  });

  if (eventUpdate.count === 0) {
    const latestEvent = await prisma.clanEvent.findUnique({
      where: {
        id: eventId,
      },
    });

    return {
      ended: false,
      event: latestEvent,
    };
  }

  /**
   * Everybody still running is cut off at the
   * same automatic event cutoff.
   *
   * People who stopped earlier are NOT touched.
   */
  await prisma.clanEventParticipant.updateMany({
    where: {
      eventId,

      status: "RUNNING",
    },

    data: {
      status: "CUTOFF_PENDING",

      eventCutoffAt: automaticCutoffAt,
    },
  });

  /**
   * Save latest provisional totals/ranks.
   */
  const snapshot = await persistEventResultsSnapshot(eventId);

  /**
   * If everybody had already finalized,
   * results are immediately completely final.
   */
  if (snapshot.pendingFinalizations === 0) {
    await prisma.clanEvent.update({
      where: {
        id: eventId,
      },

      data: {
        completedAt: automaticCutoffAt,
      },
    });
  }

  const latestEvent = await prisma.clanEvent.findUnique({
    where: {
      id: eventId,
    },
  });

  return {
    ended: true,
    event: latestEvent,
    cutoffAt: automaticCutoffAt,
    snapshot,
  };
};

const EVENT_FINALIZATION_GRACE_MS = 20 * 60 * 1000;

const recoverExpiredEventParticipants = async (eventId) => {
  const event = await prisma.clanEvent.findUnique({
    where: {
      id: eventId,
    },

    select: {
      id: true,
      status: true,
      leaderStoppedAt: true,
      completedAt: true,
    },
  });

  if (!event) {
    return {
      recovered: 0,
    };
  }

  /**
   * Only recover results after the whole event
   * has actually ended.
   */
  if (event.status !== "COMPLETED" || !event.leaderStoppedAt) {
    return {
      recovered: 0,
    };
  }

  const eventEndedAt = event.leaderStoppedAt ?? event.completedAt;

  if (!eventEndedAt) {
    return {
      recovered: 0,
    };
  }

  const graceDeadline =
    new Date(eventEndedAt).getTime() + EVENT_FINALIZATION_GRACE_MS;

  /**
   * Give devices a few minutes to submit their
   * exact cutoff result.
   */
  if (Date.now() < graceDeadline) {
    return {
      recovered: 0,
    };
  }

  const pendingParticipants = await prisma.clanEventParticipant.findMany({
    where: {
      eventId,

      startedAt: {
        not: null,
      },

      status: {
        in: ["STOPPED", "CUTOFF_PENDING", "RUNNING"],
      },
    },
  });

  if (pendingParticipants.length === 0) {
    return {
      recovered: 0,
    };
  }

  let recovered = 0;

  for (const participant of pendingParticipants) {
    /**
     * Determine the official cutoff for this person.
     *
     * If they personally stopped earlier, keep that.
     * Otherwise use the global event cutoff.
     */
    const cutoffCandidates = [
      participant.eventCutoffAt,
      participant.stoppedAt,
      event.leaderStoppedAt,
    ]
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()));

    const effectiveCutoff =
      cutoffCandidates.length > 0
        ? new Date(Math.min(...cutoffCandidates.map((date) => date.getTime())))
        : event.leaderStoppedAt;

    if (!effectiveCutoff) {
      continue;
    }

    /**
     * Try to link the normal activity if it
     * has already been saved.
     */
    let linkedActivityId = participant.activityId;

    if (!linkedActivityId && participant.clientActivityId) {
      const activity = await prisma.activity.findFirst({
        where: {
          userId: participant.userId,
          clientActivityId: participant.clientActivityId,
        },

        select: {
          id: true,
        },
      });

      linkedActivityId = activity?.id ?? null;
    }

    /**
     * IMPORTANT:
     *
     * We keep the latest stats already stored in
     * ClanEventParticipant.
     *
     * We are NOT inventing new stats here.
     */
    const result = await prisma.clanEventParticipant.updateMany({
      where: {
        id: participant.id,

        status: {
          not: "FINALIZED",
        },
      },

      data: {
        status: "FINALIZED",

        finalizedAt: new Date(),

        eventCutoffAt: effectiveCutoff,

        activityId: linkedActivityId,

        lastProgressAt: participant.lastProgressAt ?? new Date(),
      },
    });

    recovered += result.count;
  }

  return {
    recovered,
  };
};

/**
 * |--------------------------------------------------------------------------
 * | BUILD EVENT RESULTS / RANKING
 * |--------------------------------------------------------------------------
 */

const buildEventResultsSnapshot = async (eventId) => {
  const participants = await prisma.clanEventParticipant.findMany({
    where: {
      eventId,

      startedAt: {
        not: null,
      },
    },

    include: {
      user: {
        select: {
          id: true,
          username: true,
          fullName: true,
        },
      },
    },
  });

  /**
   * Ranking:
   *
   * 1. Greater distance
   * 2. Faster avg pace
   * 3. Lower moving time
   * 4. Earlier start as final deterministic tie-break
   */

  const ranked = [...participants].sort((a, b) => {
    const distanceDifference =
      Number(b.distanceKm ?? 0) - Number(a.distanceKm ?? 0);

    if (Math.abs(distanceDifference) > 1e-9) {
      return distanceDifference;
    }

    const aPace = Number(a.avgPace);

    const bPace = Number(b.avgPace);

    const safeAPace =
      Number.isFinite(aPace) && aPace > 0 ? aPace : Number.POSITIVE_INFINITY;

    const safeBPace =
      Number.isFinite(bPace) && bPace > 0 ? bPace : Number.POSITIVE_INFINITY;

    if (safeAPace !== safeBPace) {
      return safeAPace - safeBPace;
    }

    const movingDifference =
      Number(a.movingTime ?? 0) - Number(b.movingTime ?? 0);

    if (movingDifference !== 0) {
      return movingDifference;
    }

    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  });

  const results = ranked.map((participant, index) => ({
    rank: index + 1,

    participantId: participant.id,

    userId: participant.userId,

    user: participant.user,

    role: participant.roleSnapshot,

    status: participant.status,

    startedAt: participant.startedAt,

    stoppedAt: participant.stoppedAt,

    eventCutoffAt: participant.eventCutoffAt,

    finalizedAt: participant.finalizedAt,

    distanceKm: Number(participant.distanceKm ?? 0),

    elapsedTime: Number(participant.elapsedTime ?? 0),

    movingTime: Number(participant.movingTime ?? 0),

    calories: Number(participant.calories ?? 0),

    elevationGain: Number(participant.elevationGain ?? 0),

    avgPace: participant.avgPace,

    avgSpeed: participant.avgSpeed,

    topSpeed: participant.topSpeed,

    kmSplits: Array.isArray(participant.kmSplits) ? participant.kmSplits : [],

    activityId: participant.activityId ?? null,

    clientActivityId: participant.clientActivityId ?? null,

    isFinalized: participant.status === "FINALIZED",
  }));

  // ============================================================
  // PUT YOUR BEST SPLIT CODE HERE
  // ============================================================

  let bestSplit = null;
  let bestSplitParticipant = null;

  for (const item of results) {
    const kmSplits = Array.isArray(item.kmSplits) ? item.kmSplits : [];

    const participantDistanceKm = Number(item.distanceKm ?? 0);

    if (!Number.isFinite(participantDistanceKm) || participantDistanceKm < 1) {
      continue;
    }

    const completedKm = Math.floor(participantDistanceKm + 0.000001);

    for (const split of kmSplits) {
      if (!split || typeof split !== "object") {
        continue;
      }

      const km = Number(split.km);

      const timeSec = Number(split.timeSec ?? split.pace);

      if (!Number.isFinite(km) || !Number.isInteger(km) || km < 1) {
        continue;
      }

      if (km > completedKm) {
        continue;
      }

      if (!Number.isFinite(timeSec) || timeSec <= 0) {
        continue;
      }

      const splitDistanceKm =
        split.distanceKm != null
          ? Number(split.distanceKm)
          : split.splitDistanceKm != null
            ? Number(split.splitDistanceKm)
            : split.distanceMeters != null
              ? Number(split.distanceMeters) / 1000
              : split.distanceM != null
                ? Number(split.distanceM) / 1000
                : split.meters != null
                  ? Number(split.meters) / 1000
                  : null;

      if (splitDistanceKm !== null) {
        if (
          !Number.isFinite(splitDistanceKm) ||
          splitDistanceKm < 0.95 ||
          splitDistanceKm > 1.05
        ) {
          continue;
        }
      }

      if (bestSplit === null || timeSec < bestSplit.timeSec) {
        bestSplit = {
          km,
          timeSec,
          pace: timeSec,

          paceFormatted: split.paceFormatted ?? formatPace(timeSec),
        };

        bestSplitParticipant = {
          userId: item.userId,
          participantId: item.participantId,
          user: item.user,
        };
      }
    }
  }

  /**
   * Combined event totals.
   */

  const totals = results.reduce(
    (acc, item) => {
      acc.distanceKm += item.distanceKm;

      acc.calories += item.calories;

      acc.movingTimeSec += item.movingTime;

      acc.elevationGain += item.elevationGain;

      return acc;
    },

    {
      distanceKm: 0,
      calories: 0,
      movingTimeSec: 0,
      elevationGain: 0,
    },
  );

  /**
   * Do not average user paces.
   *
   * Combined pace:
   *
   * total moving minutes
   * --------------------
   * total distance
   */

  const avgPace =
    totals.distanceKm > 0 ? totals.movingTimeSec / 60 / totals.distanceKm : 0;

  return {
    results,

    totals: {
      ...totals,
      avgPace,
    },

    bestSplit,

    bestSplitPace: bestSplit !== null ? bestSplit.timeSec / 60 : 0,

    bestSplitPaceSec: bestSplit?.timeSec ?? null,

    bestSplitParticipant,

    startedParticipants: results.length,

    finalizedParticipants: results.filter((item) => item.isFinalized).length,

    pendingFinalizations: results.filter((item) => !item.isFinalized).length,
  };
};

/**
 * |--------------------------------------------------------------------------
 * | SAVE RANKS + EVENT TOTALS
 * |--------------------------------------------------------------------------
 */

const persistEventResultsSnapshot = async (eventId) => {
  const snapshot = await buildEventResultsSnapshot(eventId);

  const operations = snapshot.results.map((item) =>
    prisma.clanEventParticipant.update({
      where: {
        id: item.participantId,
      },

      data: {
        rank: item.rank,
      },
    }),
  );

  operations.push(
    prisma.clanEvent.update({
      where: {
        id: eventId,
      },

      data: {
        totalDistanceKm: snapshot.totals.distanceKm,

        totalCalories: snapshot.totals.calories,

        totalMovingTimeSec: snapshot.totals.movingTimeSec,

        totalElevationGain: snapshot.totals.elevationGain,
      },
    }),
  );

  if (operations.length > 0) {
    await prisma.$transaction(operations);
  }

  return snapshot;
};

/**
 * |--------------------------------------------------------------------------
 * | CREATE EVENT
 * |--------------------------------------------------------------------------
 * | POST /api/clan-events
 * |--------------------------------------------------------------------------
 */

export const createClanEvent = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      title,
      description,
      location,
      startsAt,
      endsAt,
      maxParticipants,
      targetDistanceKm,
      standalone = false,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Event title is required",
      });
    }

    if (!startsAt || !endsAt) {
      return res.status(400).json({
        success: false,
        message: "Event start time and end time are required",
      });
    }

    let parsedTargetDistanceKm = null;

    if (
      targetDistanceKm !== undefined &&
      targetDistanceKm !== null &&
      targetDistanceKm !== ""
    ) {
      parsedTargetDistanceKm = Number(targetDistanceKm);

      if (
        !Number.isFinite(parsedTargetDistanceKm) ||
        parsedTargetDistanceKm <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Target distance must be greater than 0 km",
        });
      }
    }

    const startDate = new Date(startsAt);

    const endDate = new Date(endsAt);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid event date and time.",
      });
    }

    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: "Event end time must be after the start time",
      });
    }

    if (startDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "Event start time must be in the future",
      });
    }

    let parsedMaxParticipants = null;

    if (
      maxParticipants !== undefined &&
      maxParticipants !== null &&
      maxParticipants !== ""
    ) {
      parsedMaxParticipants = Number(maxParticipants);

      if (
        !Number.isInteger(parsedMaxParticipants) ||
        parsedMaxParticipants < 1
      ) {
        return res.status(400).json({
          success: false,

          message: "Maximum participants must be at least 1",
        });
      }
    }

    const membership = await getUserClanMembership(userId);

    let clanId = null;
    let runLeaderId = userId;

    // ============================================================
    // STANDALONE / PUBLIC EVENT
    //
    // Created through Social > Events.
    //
    // IMPORTANT:
    // Even if the creator belongs to a club,
    // this event does NOT belong to that club.
    // ============================================================

    if (standalone === true) {
      clanId = null;
      runLeaderId = userId;
    }

    // ============================================================
    // USER IS NOT IN A CLUB
    //
    // Normal creation also becomes standalone.
    // ============================================================
    else if (!membership) {
      clanId = null;
      runLeaderId = userId;
    }

    // ============================================================
    // CLUB EVENT
    //
    // Requests coming from the Clubs tab do not send
    // standalone=true.
    //
    // Only leader/captain can create a Club Event.
    // ============================================================
    else {
      const isCaptain = membership.clan.captainId === userId;

      const isLeader =
        membership.role === "LEADER" || membership.role === "CAPTAIN";

      if (!isCaptain && !isLeader) {
        return res.status(403).json({
          success: false,
          message: "Only the club leader or captain can create a club event",
        });
      }

      clanId = membership.clanId;

      runLeaderId = await resolveClanRunLeaderId(clanId);

      if (!runLeaderId) {
        return res.status(409).json({
          success: false,
          message: "This club does not currently have a valid event leader",
        });
      }
    }

    const event = await prisma.clanEvent.create({
      data: {
        clanId,

        createdById: userId,

        // IMPORTANT
        runLeaderId,

        title: title.trim(),

        description: description?.trim() || null,

        location: location?.trim() || null,

        startsAt: startDate,

        endsAt: endDate,

        maxParticipants: parsedMaxParticipants,

        targetDistanceKm: parsedTargetDistanceKm,
      },

      include: {
        clan: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            banner: true,
            imageUrl: true,
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
    });

    /**
     * Automatically add the real clan leader as an event participant.
     *
     * Leader does not need to press Join Event.
     */
    await prisma.clanEventParticipant.upsert({
      where: {
        eventId_userId: {
          eventId: event.id,
          userId: runLeaderId,
        },
      },

      create: {
        eventId: event.id,
        userId: runLeaderId,
      },

      update: {},
    });

    /**
     * Fetch all clan members.
     */

    let clanMembers = [];

    if (clanId) {
      clanMembers = await prisma.clanMember.findMany({
        where: {
          clanId,
        },

        select: {
          id: true,
          userId: true,
          role: true,

          user: {
            select: {
              id: true,
              email: true,
              username: true,
              fullName: true,
            },
          },
        },
      });
    }

    /**
     * EMAIL INVITATIONS
     */

    let emailResult = {
      attempted: 0,
      sent: 0,
      failed: 0,
      successful: [],
      failures: [],
    };

    if (event.clan && clanMembers.length > 0) {
      try {
        emailResult = await sendClanEventInvitations({
          event,
          clan: event.clan,
          creator: event.createdBy,
          members: clanMembers,
        });
      } catch (emailError) {
        console.error("CLAN_EVENT_INVITATION_EMAIL_ERROR:", emailError);
      }
    }

    /**
     * PUSH NOTIFICATIONS
     */

    const membersToNotify = clanMembers.filter(
      (member) => member.userId !== userId,
    );

    let notificationResult = {
      attempted: membersToNotify.length,

      sent: 0,

      failed: 0,
    };

    try {
      const pushResults = await Promise.all(
        membersToNotify.map(async (member) => {
          const result = await sendFCMToUser({
            userId: member.userId,

            title: event.clan
              ? `New Event in ${event.clan.name}`
              : "New Event on DURO",

            message: event.location
              ? `${event.title} • ${event.location}`
              : event.title,

            data: {
              type: "CLAN_EVENT_CREATED",

              eventId: event.id,

              clanId: event.clan?.id ?? "",

              title: event.title,
            },
          });

          return {
            userId: member.userId,

            success: Boolean(result),
          };
        }),
      );

      for (const result of pushResults) {
        if (result.success) {
          notificationResult.sent++;
        } else {
          notificationResult.failed++;
        }
      }

      console.log(
        `Clan event notifications: ${notificationResult.sent} sent, ${notificationResult.failed} failed`,
      );
    } catch (notificationError) {
      console.error("CLAN_EVENT_NOTIFICATION_ERROR:", notificationError);
    }

    /**
     * Retrieve the real participant count after leader auto-enrolment.
     */

    const participantCount = await prisma.clanEventParticipant.count({
      where: {
        eventId: event.id,
      },
    });

    return res.status(201).json({
      success: true,

      message: "Club event created successfully",

      invitationMessage:
        emailResult.sent > 0
          ? `Invitations sent to ${emailResult.sent} clan members`
          : "Event created successfully, but no email invitations were sent",

      notificationMessage:
        notificationResult.sent > 0
          ? `Notifications sent to ${notificationResult.sent} club members`
          : "No push notifications were sent",

      data: {
        ...event,
        eventType: event.clanId ? "CLUB" : "PUBLIC",
        participantsCount: participantCount,
      },

      emailInvitations: {
        totalClanMembers: clanMembers.length,

        attempted: emailResult.attempted,

        sent: emailResult.sent,

        failed: emailResult.failed,
      },

      pushNotifications: {
        eligibleMembers: membersToNotify.length,

        attempted: notificationResult.attempted,

        sent: notificationResult.sent,

        failed: notificationResult.failed,
      },
    });
  } catch (error) {
    console.error("CREATE_CLAN_EVENT_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to create club event",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | JOIN EVENT
 * |--------------------------------------------------------------------------
 */

export const joinClanEvent = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;

    const event = await prisma.clanEvent.findUnique({
      where: {
        id: eventId,
      },

      include: {
        _count: {
          select: {
            participants: true,
          },
        },
      },
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (event.status === "CANCELLED") {
      return res.status(400).json({
        success: false,

        message: "This event has been cancelled",
      });
    }

    if (event.status === "COMPLETED") {
      return res.status(400).json({
        success: false,

        message: "This event has already been completed",
      });
    }

    /**
     * Do not let a new participant join after the actual event run begins.
     */

    if (event.status === "ACTIVE" || event.runStartedAt) {
      return res.status(400).json({
        success: false,

        message: "This Club Event has already started. You can no longer join.",
      });
    }

    if (new Date() >= event.endsAt) {
      return res.status(400).json({
        success: false,

        message: "This event has already ended",
      });
    }

    const existingParticipant = await prisma.clanEventParticipant.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    if (existingParticipant) {
      return res.status(400).json({
        success: false,

        message: "You have already joined this event",
      });
    }

    if (
      event.maxParticipants !== null &&
      event._count.participants >= event.maxParticipants
    ) {
      return res.status(400).json({
        success: false,

        message: "This event is full",
      });
    }

    const participant = await prisma.clanEventParticipant.create({
      data: {
        eventId,
        userId,
      },

      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
    });

    return res.status(201).json({
      success: true,

      message: "Event joined successfully",

      data: participant,
    });
  } catch (error) {
    console.error("JOIN_CLAN_EVENT_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to join clan event",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | LEAVE EVENT
 * |--------------------------------------------------------------------------
 */

export const leaveClanEvent = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;

    const participant = await prisma.clanEventParticipant.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    if (!participant) {
      return res.status(404).json({
        success: false,

        message: "You are not participating in this event",
      });
    }

    const event = await prisma.clanEvent.findUnique({
      where: {
        id: eventId,
      },

      select: {
        startsAt: true,

        status: true,

        runStartedAt: true,

        runLeaderId: true,
      },
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    /**
     * Leader is auto-enrolled and should not leave the event.
     */

    if (event.runLeaderId === userId) {
      return res.status(400).json({
        success: false,

        message: "You’re leading this Club Event, so you can’t leave it.",
      });
    }

    if (event.status === "ACTIVE" || event.runStartedAt) {
      return res.status(400).json({
        success: false,

        message: "You cannot leave after the Club Event run has started",
      });
    }

    await prisma.clanEventParticipant.delete({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    return res.status(200).json({
      success: true,

      message: "You left the event successfully",
    });
  } catch (error) {
    console.error("LEAVE_CLAN_EVENT_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to leave clan event",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const autoEndAllExpiredClanEvents = async () => {
  const now = new Date();

  const candidates = await prisma.clanEvent.findMany({
    where: {
      runStartedAt: {
        not: null,
      },

      leaderStoppedAt: null,

      status: {
        notIn: ["COMPLETED", "CANCELLED"],
      },

      // First narrow down events whose scheduled end has passed.
      endsAt: {
        lt: now,
      },
    },

    select: {
      id: true,
      endsAt: true,
    },
  });

  for (const event of candidates) {
    const automaticCutoffAt = new Date(
      new Date(event.endsAt).getTime() + EVENT_AUTO_END_GRACE_MS,
    );

    if (now >= automaticCutoffAt) {
      await autoEndExpiredClanEvent(event.id);
    }
  }
};

/**
 * |--------------------------------------------------------------------------
 * | GET CURRENT USER'S CLAN EVENTS
 * |--------------------------------------------------------------------------
 */

export const getMyClanEvents = async (req, res) => {
  try {
    const userId = req.user.id;

    await autoEndAllExpiredClanEvents();

    const membership = await getUserClanMembership(userId);

    /**
     * Get:
     *
     * 1. Events belonging to user's own clan
     * 2. Events from other clans that the user joined
     */
    const eventConditions = [
      {
        participants: {
          some: {
            userId,
          },
        },
      },
    ];

    if (membership) {
      eventConditions.push({
        clanId: membership.clanId,
      });
    }

    const events = await prisma.clanEvent.findMany({
      where: {
        OR: eventConditions,
      },

      include: {
        clan: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            banner: true,
            imageUrl: true,
          },
        },

        createdBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },

        participants: {
          select: {
            id: true,
            userId: true,
            joinedAt: true,

            roleSnapshot: true,

            status: true,

            startedAt: true,

            stoppedAt: true,

            eventCutoffAt: true,

            finalizedAt: true,

            distanceKm: true,

            rank: true,

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
            participants: true,
          },
        },
      },

      orderBy: {
        startsAt: "asc",
      },
    });

    const data = events.map((event) => ({
      id: event.id,

      eventType: event.clanId ? "CLUB" : "PUBLIC",

      clanId: event.clanId,

      title: event.title,

      description: event.description,

      location: event.location,

      targetDistanceKm: event.targetDistanceKm,
      startsAt: event.startsAt,

      endsAt: event.endsAt,

      maxParticipants: event.maxParticipants,

      status: event.status,

      createdAt: event.createdAt,

      updatedAt: event.updatedAt,

      runLeaderId: event.runLeaderId,

      runStartedAt: event.runStartedAt,

      leaderStoppedAt: event.leaderStoppedAt,

      completedAt: event.completedAt,

      totalDistanceKm: event.totalDistanceKm,

      totalCalories: event.totalCalories,

      totalMovingTimeSec: event.totalMovingTimeSec,

      totalElevationGain: event.totalElevationGain,

      clan: event.clan,

      createdBy: event.createdBy,

      participants: event.participants,

      participantsCount: event._count.participants,

      myParticipant:
        event.participants.find(
          (participant) => participant.userId === userId,
        ) ?? null,

      /**
       * New events auto-enroll leader.
       *
       * Strict leader fallback keeps older events compatible.
       */
      isParticipating: event.participants.some(
        (participant) => participant.userId === userId,
      ),

      isRunLeader: event.runLeaderId === userId,

      availableSpots:
        event.maxParticipants === null
          ? null
          : Math.max(event.maxParticipants - event._count.participants, 0),
    }));

    const ownClan = membership
      ? {
          id: membership.clan.id,
          name: membership.clan.name,
          slug: membership.clan.slug,
          logo: membership.clan.logo,
          banner: membership.clan.banner,
          imageUrl: membership.clan.imageUrl,
        }
      : null;

    return res.status(200).json({
      success: true,

      /**
       * New clearer field.
       */
      ownClan,

      /**
       * Keep old field temporarily
       * so existing Flutter code does not break.
       */
      clan: ownClan,

      currentUser: {
        role: membership?.role ?? null,

        isClanMember: Boolean(membership),

        clanId: membership?.clanId ?? null,

        isLeader: membership
          ? membership.role === "LEADER" ||
            membership.role === "CAPTAIN" ||
            membership.clan.captainId === userId
          : false,
      },

      count: data.length,

      events: data,
    });
  } catch (error) {
    console.error("GET_MY_CLAN_EVENTS_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch clan events",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | GET EVENT DETAIL
 * |--------------------------------------------------------------------------
 */

export const getClanEventDetail = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;

    // Automatically close forgotten live events after
    // scheduled end + 30 minutes.
    await autoEndExpiredClanEvent(eventId);

    const event = await prisma.clanEvent.findUnique({
      where: {
        id: eventId,
      },

      include: {
        clan: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            banner: true,
            imageUrl: true,
            captainId: true,
          },
        },

        createdBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
            skinIndex: true,

            avatars: {
              where: {
                isEquipped: true,
                status: "UNLOCKED",
              },

              include: {
                avatar: true,
              },
            },
          },
        },

        runLeader: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },

        participants: {
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
              rank: "asc",
            },
            {
              joinedAt: "asc",
            },
          ],
        },
      },
    });

    if (!event) {
      return res.status(404).json({
        success: false,

        message: "Event not found",
      });
    }

    const membership = event.clanId
      ? await prisma.clanMember.findUnique({
          where: {
            clanId_userId: {
              clanId: event.clanId,
              userId,
            },
          },
        })
      : null;

    // if (!membership) {
    //   return res.status(403).json({
    //     success: false,

    //     message: "Only clan members can view this event",
    //   });
    // }

    const participant = event.participants.find(
      (item) => item.userId === userId,
    );

    // ============================================================
    // FORMAT EVENT CREATOR AVATAR
    // ============================================================

    const creatorAvatar = {};

    for (const item of event.createdBy?.avatars ?? []) {
      if (!item.avatar) continue;

      creatorAvatar[item.avatar.type] = {
        id: item.avatar.id,
        file: item.avatar.file,
        type: item.avatar.type,
      };
    }

    const createdBy = event.createdBy
      ? {
          id: event.createdBy.id,
          username: event.createdBy.username,
          fullName: event.createdBy.fullName,
          skinIndex: event.createdBy.skinIndex ?? 2,
          avatar: creatorAvatar,
        }
      : null;

    // ============================================================
    // RESPONSE
    // ============================================================

    return res.status(200).json({
      success: true,

      data: {
        ...event,

        // Replace raw Prisma createdBy with formatted creator
        createdBy,

        eventType: event.clanId ? "CLUB" : "PUBLIC",

        participantsCount: event.participants.length,

        isParticipating: Boolean(participant),

        currentUserRole: membership?.role ?? null,

        isClanMember: Boolean(membership),

        isRunLeader: event.runLeaderId === userId,
      },
    });
  } catch (error) {
    console.error("GET_CLAN_EVENT_DETAIL_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch event detail",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | START CLUB EVENT RUN
 * |--------------------------------------------------------------------------
 * | POST /api/clan-events/:eventId/run/start
 * |--------------------------------------------------------------------------
 *
 * Request:
 *
 * {
 *   "clientActivityId": "flutter-generated-activity-id"
 * }
 *
 * IMPORTANT:
 * This does NOT create the normal Activity.
 *
 * Flutter still saves the normal activity through /api/activities/finish.
 */

export const startClanEventRun = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;

    const clientActivityId = req.body?.clientActivityId?.toString().trim();

    if (!clientActivityId) {
      return res.status(400).json({
        success: false,

        message: "clientActivityId is required",
      });
    }

    const context = await getEventRunContext({
      eventId,
      userId,
    });

    const { event, membership } = context;

    let { participant } = context;

    if (!event) {
      return res.status(404).json({
        success: false,

        message: "Event not found",
      });
    }

    if (event.status === "CANCELLED") {
      return res.status(400).json({
        success: false,

        message: "This event has been cancelled",
      });
    }

    if (event.leaderStoppedAt || event.status === "COMPLETED") {
      return res.status(409).json({
        success: false,

        message: "This Club Event has already ended",

        leaderStoppedAt: event.leaderStoppedAt,
      });
    }

    const now = new Date();

    /**
     * Only start during scheduled event duration.
     */

    if (now < event.startsAt || now > event.endsAt) {
      return res.status(400).json({
        success: false,

        message:
          "Club Event activity can only be started during the scheduled event time",

        startsAt: event.startsAt,

        endsAt: event.endsAt,
      });
    }

    const resolvedRunLeaderId =
      event.runLeaderId ??
      (event.clanId
        ? await resolveClanRunLeaderId(event.clanId)
        : event.createdById);

    if (!resolvedRunLeaderId) {
      return res.status(409).json({
        success: false,
        message: "This clan does not currently have a valid event run leader",
      });
    }

    const currentUserIsRunLeader = resolvedRunLeaderId === userId;

    // ============================================================
    // EVENT MUST BE STARTED BY THE OFFICIAL RUN LEADER FIRST
    // ============================================================

    // if (!event.runStartedAt && !currentUserIsRunLeader) {
    //   return res.status(409).json({
    //     success: false,
    //     message: "The event leader has not started this event yet",
    //     waitingForLeader: true,
    //   });
    // }

    // const isStandaloneEvent = event.clanId == null;

    // if (!event.runStartedAt && !currentUserIsRunLeader && !isStandaloneEvent) {
    //   return res.status(409).json({
    //     success: false,
    //     message: "The event leader has not started this event yet",
    //     waitingForLeader: true,
    //   });
    // }

    /**
     * Backwards compatibility:
     * older events may not have leader in participant table.
     */

    if (!participant && currentUserIsRunLeader) {
      participant = await prisma.clanEventParticipant.create({
        data: {
          eventId,
          userId,
        },
      });
    }

    if (!participant) {
      return res.status(403).json({
        success: false,

        message: "Join this event before starting the Club Event activity",
      });
    }

    if (participant.status === "RUNNING") {
      return res.status(200).json({
        success: true,

        duplicate: true,

        message: "Club Event activity is already running",

        data: participant,

        runLeaderId: event.runLeaderId ?? resolvedRunLeaderId,

        isRunLeader: currentUserIsRunLeader,
      });
    }

    /**
     * Prevent the same user from having
     * two Club Event activities running at once.
     *
     * The user may JOIN multiple overlapping events,
     * but can only START one of them.
     */
    const anotherRunningEvent = await prisma.clanEventParticipant.findFirst({
      where: {
        userId,

        eventId: {
          not: eventId,
        },

        status: "RUNNING",
      },

      include: {
        event: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            status: true,
          },
        },
      },
    });

    if (anotherRunningEvent) {
      return res.status(409).json({
        success: false,

        message:
          "You already have another Club Event activity running. Stop that event activity before starting this one.",

        conflictingEvent: anotherRunningEvent.event,
      });
    }

    if (
      ["STOPPED", "CUTOFF_PENDING", "FINALIZED"].includes(participant.status)
    ) {
      return res.status(409).json({
        success: false,

        message:
          "This Club Event activity has already ended and cannot be restarted.",
      });
    }

    /**
     * Prevent one clientActivityId from being used by multiple event runs.
     */

    const conflictingActivity = await prisma.clanEventParticipant.findFirst({
      where: {
        userId,

        clientActivityId,

        eventId: {
          not: eventId,
        },
      },

      select: {
        id: true,
        eventId: true,
      },
    });

    if (conflictingActivity) {
      return res.status(409).json({
        success: false,

        message: "This client activity is already linked to another Club Event",
      });
    }

    /**
     * First participant starts event:
     *
     * UPCOMING -> ACTIVE
     */

    let updatedEvent = event;

    let updatedParticipant;

    /// ============================================================
    // FIRST JOINED PARTICIPANT STARTS THE EVENT
    //
    // Applies to BOTH:
    // - Club Event
    // - Independent / Standalone Event
    //
    // Once scheduled startsAt has arrived, the first joined
    // participant who presses Start Run activates the whole event.
    //
    // IMPORTANT:
    // This does NOT change the official runLeaderId.
    // ============================================================

    if (!event.runStartedAt) {
      [updatedEvent, updatedParticipant] = await prisma.$transaction([
        prisma.clanEvent.update({
          where: {
            id: eventId,
          },

          data: {
            status: "ACTIVE",
            runStartedAt: now,

            // Keep the original official leader.
            runLeaderId: resolvedRunLeaderId,
          },
        }),

        prisma.clanEventParticipant.update({
          where: {
            eventId_userId: {
              eventId,
              userId,
            },
          },

          data: {
            roleSnapshot: currentUserIsRunLeader
              ? "LEADER"
              : (membership?.role ?? null),

            status: "RUNNING",

            clientActivityId,

            startedAt: participant.startedAt ?? now,

            lastProgressAt: now,
          },
        }),
      ]);
    }

    // ============================================================
    // EVENT ALREADY ACTIVE
    // PARTICIPANT STARTS ONLY THEIR OWN RUN
    // ============================================================
    else {
      updatedParticipant = await prisma.clanEventParticipant.update({
        where: {
          eventId_userId: {
            eventId,
            userId,
          },
        },

        data: {
          roleSnapshot: currentUserIsRunLeader
            ? "LEADER"
            : (membership?.role ?? null),

          status: "RUNNING",

          clientActivityId,

          startedAt: participant.startedAt ?? now,

          lastProgressAt: now,
        },
      });
    }

    return res.status(200).json({
      success: true,

      message: "Club Event activity started",

      event: {
        id: updatedEvent.id,

        status: updatedEvent.status,

        runLeaderId: updatedEvent.runLeaderId,

        runStartedAt: updatedEvent.runStartedAt,
      },

      participant: updatedParticipant,

      isRunLeader: currentUserIsRunLeader,
    });
  } catch (error) {
    console.error("START_CLAN_EVENT_RUN_ERROR:", error);

    if (error?.code === "P2002") {
      return res.status(409).json({
        success: false,

        message: "This client activity is already linked to an event run",
      });
    }

    return res.status(500).json({
      success: false,

      message: "Failed to start Club Event activity",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | UPDATE LIVE CLUB EVENT PROGRESS
 * |--------------------------------------------------------------------------
 * | PATCH /api/clan-events/:eventId/run/progress
 * |--------------------------------------------------------------------------
 *
 * Flutter can send:
 *
 * {
 *   "distanceKm": 3.25,
 *   "elapsedTime": 1200,
 *   "movingTime": 1175,
 *   "calories": 220,
 *   "elevationGain": 40,
 *   "avgPace": 5.8,
 *   "avgSpeed": 10.4,
 *   "topSpeed": 15.2
 * }
 */

export const updateClanEventRunProgress = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;

    await autoEndExpiredClanEvent(eventId);

    const { event, membership, participant } = await getEventRunContext({
      eventId,
      userId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (!participant) {
      return res.status(404).json({
        success: false,

        message: "You are not participating in this event",
      });
    }

    /**
     * Leader already ended event.
     */

    if (event.leaderStoppedAt || event.status === "COMPLETED") {
      return res.status(409).json({
        success: false,

        eventEnded: true,

        message: "The leader has ended the Club Event",

        leaderStoppedAt: event.leaderStoppedAt,

        eventCutoffAt: participant.eventCutoffAt ?? event.leaderStoppedAt,
      });
    }

    if (participant.status !== "RUNNING") {
      return res.status(409).json({
        success: false,

        message: "Club Event activity is not currently running for this user",

        participantStatus: participant.status,
      });
    }

    const stats = parseEventStats(req.body, {
      partial: true,
    });

    const now = new Date();

    const updated = await prisma.clanEventParticipant.update({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },

      data: {
        ...stats,

        lastProgressAt: now,
      },
    });

    return res.status(200).json({
      success: true,

      data: updated,
    });
  } catch (error) {
    console.error("UPDATE_CLAN_EVENT_PROGRESS_ERROR:", error);

    if (error?.code === "INVALID_EVENT_STATS") {
      return res.status(400).json({
        success: false,

        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,

      message: "Failed to update Club Event progress",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | STOP CLUB EVENT ACTIVITY
 * |--------------------------------------------------------------------------
 * | POST /api/clan-events/:eventId/run/stop
 * |--------------------------------------------------------------------------
 *
 * RUNNER/CAPTAIN:
 *
 * Stops only their own event result.
 *
 * LEADER:
 *
 * Creates the authoritative leaderStoppedAt timestamp.
 * Everyone still running receives the exact same maximum event cutoff.
 *
 * Their normal personal activity is NOT stopped.
 */

export const stopClanEventRun = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;
    await autoEndExpiredClanEvent(eventId);

    const { event, membership, participant } = await getEventRunContext({
      eventId,
      userId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,

        message: "Event not found",
      });
    }

    // if (!membership) {
    //   return res.status(403).json({
    //     success: false,

    //     message: "You are not a member of this clan",
    //   });
    // }

    if (!participant || !participant.startedAt) {
      return res.status(404).json({
        success: false,

        message: "No started Club Event activity was found for this user",
      });
    }

    const resolvedRunLeaderId =
      event.runLeaderId ??
      (event.clanId
        ? await resolveClanRunLeaderId(event.clanId)
        : event.createdById);

    if (!resolvedRunLeaderId) {
      return res.status(409).json({
        success: false,
        message: "This clan does not currently have a valid event run leader",
      });
    }

    const currentUserIsRunLeader = resolvedRunLeaderId === userId;

    /**
     * Leader already ended it.
     *
     * Never overwrite the authoritative cutoff with a later device stop.
     */

    if (event.leaderStoppedAt) {
      return res.status(200).json({
        success: true,

        duplicate: true,

        eventEnded: true,

        message: "Club Event has already been ended by the leader",

        leaderStoppedAt: event.leaderStoppedAt,

        eventCutoffAt: participant.eventCutoffAt ?? event.leaderStoppedAt,

        participant,
      });
    }

    const now = new Date();

    /**
     * ============================================================
     * STOP ONLY THIS USER'S CLUB EVENT CONTRIBUTION
     * ============================================================
     *
     * IMPORTANT:
     *
     * Even when this user is the official Event Run Leader,
     * pressing the normal activity STOP button must NOT end
     * the whole Club Event.
     *
     * It stops only this user's own contribution.
     *
     * The leader ends the whole event separately through
     * POST /:eventId/run/end.
     */

    if (["STOPPED", "FINALIZED"].includes(participant.status)) {
      return res.status(200).json({
        success: true,

        duplicate: true,

        eventEnded: false,

        isRunLeader: currentUserIsRunLeader,

        message: currentUserIsRunLeader
          ? "Your activity has already been stopped. The Club Event is still live."
          : "Your Club Event activity has already been stopped",

        participant,
      });
    }

    const updatedParticipant = await prisma.clanEventParticipant.update({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },

      data: {
        status: "STOPPED",

        stoppedAt: now,

        /**
         * This participant personally stopped here.
         *
         * Their own Club Event contribution must not
         * increase after this timestamp.
         */
        eventCutoffAt: now,
      },
    });

    const snapshot = await persistEventResultsSnapshot(eventId);

    return res.status(200).json({
      success: true,

      /**
       * Normal STOP never globally ends the event anymore.
       */
      eventEnded: false,

      isRunLeader: currentUserIsRunLeader,

      message: currentUserIsRunLeader
        ? "Your activity has stopped. The Club Event remains live until you end it."
        : "Your Club Event result has been stopped. The event remains live until the leader ends it.",

      participant: updatedParticipant,

      provisionalRank:
        snapshot.results.find((item) => item.userId === userId)?.rank ?? null,

      totals: snapshot.totals,

      leaderboard: snapshot.results,

      pendingFinalizations: snapshot.pendingFinalizations,
    });
  } catch (error) {
    console.error("STOP_CLAN_EVENT_RUN_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to stop Club Event activity",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | END WHOLE CLUB EVENT
 * |--------------------------------------------------------------------------
 * | POST /api/clan-event/:eventId/run/end
 * |--------------------------------------------------------------------------
 *
 * ONLY the official run leader can call this.
 *
 * The leader's personal activity may already be stopped.
 *
 * This endpoint creates the authoritative global event cutoff.
 */

export const endClanEventRun = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;
    await autoEndExpiredClanEvent(eventId);

    const { event, participant } = await getEventRunContext({
      eventId,
      userId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const resolvedRunLeaderId =
      event.runLeaderId ??
      (event.clanId
        ? await resolveClanRunLeaderId(event.clanId)
        : event.createdById);

    if (!resolvedRunLeaderId) {
      return res.status(409).json({
        success: false,
        message: "This clan does not currently have a valid event run leader",
      });
    }

    /**
     * STRICT:
     * Captain / runner / outsider cannot end
     * the whole event.
     */
    if (resolvedRunLeaderId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Only the Club Event run leader can end this event",
      });
    }

    /**
     * Idempotent duplicate protection.
     */
    if (event.leaderStoppedAt || event.status === "COMPLETED") {
      const snapshot = await buildEventResultsSnapshot(eventId);

      return res.status(200).json({
        success: true,

        duplicate: true,

        eventEnded: true,

        message: "Club Event has already ended",

        leaderStoppedAt: event.leaderStoppedAt,

        totals: snapshot.totals,

        leaderboard: snapshot.results,

        pendingFinalizations: snapshot.pendingFinalizations,

        resultsFinal: snapshot.pendingFinalizations === 0,
      });
    }

    if (!event.runStartedAt) {
      return res.status(409).json({
        success: false,
        message: "The Club Event run has not started yet",
      });
    }

    /**
     * Leader must first stop their own activity.
     *
     * This guarantees the expected workflow:
     *
     * STOP ACTIVITY
     *      ↓
     * SUMMARY
     *      ↓
     * END EVENT
     */
    if (
      !participant ||
      !participant.startedAt ||
      !["STOPPED", "FINALIZED"].includes(participant.status)
    ) {
      return res.status(409).json({
        success: false,
        message: "Stop your activity before ending the Club Event",
      });
    }

    const now = new Date();

    await prisma.$transaction([
      /**
       * This is the moment the Club Event
       * actually ends globally.
       */
      prisma.clanEvent.update({
        where: {
          id: eventId,
        },

        data: {
          status: "COMPLETED",

          runLeaderId: resolvedRunLeaderId,

          /**
           * Keep using this existing field
           * as the authoritative EVENT cutoff.
           *
           * It is no longer the leader's personal
           * activity stop time.
           */
          leaderStoppedAt: now,
        },
      }),

      /**
       * Cut off everybody who is STILL running.
       *
       * Participants who already stopped keep
       * their earlier personal cutoff.
       */
      prisma.clanEventParticipant.updateMany({
        where: {
          eventId,

          status: "RUNNING",
        },

        data: {
          status: "CUTOFF_PENDING",

          eventCutoffAt: now,
        },
      }),
    ]);

    /**
     * Calculate the latest provisional
     * event totals and ranking.
     */
    const snapshot = await persistEventResultsSnapshot(eventId);

    /**
     * It is possible everybody had already
     * finalized before the leader pressed
     * END EVENT.
     */
    if (snapshot.pendingFinalizations === 0) {
      await prisma.clanEvent.update({
        where: {
          id: eventId,
        },

        data: {
          completedAt: now,
        },
      });
    }

    return res.status(200).json({
      success: true,

      eventEnded: true,

      isRunLeader: true,

      message: "Club Event ended successfully",

      leaderStoppedAt: now,

      totals: snapshot.totals,

      leaderboard: snapshot.results,

      pendingFinalizations: snapshot.pendingFinalizations,

      resultsFinal: snapshot.pendingFinalizations === 0,
    });
  } catch (error) {
    console.error("END_CLAN_EVENT_RUN_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to end Club Event",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | FINALIZE EXACT CLUB EVENT STATS
 * |--------------------------------------------------------------------------
 * | POST /api/clan-events/:eventId/run/finalize
 * |--------------------------------------------------------------------------
 *
 * Flutter calculates exact event-only values from timestamped samples
 * at or before eventCutoffAt.
 *
 * Example:
 *
 * Personal activity:
 * 6:00 -> 7:15
 *
 * Leader stopped:
 * 7:00
 *
 * Event result:
 * 6:00 -> 7:00
 */

export const finalizeClanEventRun = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;
    await autoEndExpiredClanEvent(eventId);

    const { event, membership, participant } = await getEventRunContext({
      eventId,
      userId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,

        message: "Event not found",
      });
    }

    // if (!membership) {
    //   return res.status(403).json({
    //     success: false,

    //     message: "You are not a member of this clan",
    //   });
    // }

    if (!participant || !participant.startedAt) {
      return res.status(404).json({
        success: false,

        message: "No started Club Event activity was found for this user",
      });
    }

    /**
     * Already finalized.
     *
     * Never allow another finalize request to overwrite
     * the participant's final Club Event result.
     */
    if (participant.status === "FINALIZED") {
      return res.status(200).json({
        success: true,

        duplicate: true,

        message: "Club Event result is already finalized",

        participant,
      });
    }

    /**
     * Determine effective event cutoff.
     *
     * Runner stops first:
     * participant.eventCutoffAt
     *
     * Leader stops first:
     * event.leaderStoppedAt
     */

    const cutoffCandidates = [
      participant.eventCutoffAt,
      participant.stoppedAt,
      event.leaderStoppedAt,
    ]
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()));

    const effectiveCutoff =
      cutoffCandidates.length > 0
        ? new Date(Math.min(...cutoffCandidates.map((date) => date.getTime())))
        : null;

    if (!effectiveCutoff) {
      return res.status(409).json({
        success: false,

        message:
          "Stop your Club Event activity before finalizing the event result",
      });
    }

    console.log("FINALIZE CLUB EVENT BODY:", JSON.stringify(req.body, null, 2));

    const stats = parseEventStats(req.body, {
      partial: false,
    });

    console.log("PARSED FINALIZE STATS:", JSON.stringify(stats, null, 2));

    /**
     * Try to connect normal Activity.
     *
     * It may not exist yet if the user is continuing their personal run.
     */

    let linkedActivityId = participant.activityId;

    if (!linkedActivityId && participant.clientActivityId) {
      const activity = await prisma.activity.findFirst({
        where: {
          userId,

          clientActivityId: participant.clientActivityId,
        },

        select: {
          id: true,
        },
      });

      linkedActivityId = activity?.id ?? null;
    }

    /**
     * Atomic duplicate-finalize protection.
     *
     * Only update this participant if it has NOT already
     * been finalized by another request/device.
     */
    const finalizeWrite = await prisma.clanEventParticipant.updateMany({
      where: {
        id: participant.id,

        status: {
          not: "FINALIZED",
        },
      },

      data: {
        ...stats,

        activityId: linkedActivityId,

        eventCutoffAt: effectiveCutoff,

        status: "FINALIZED",

        finalizedAt: new Date(),

        lastProgressAt: new Date(),
      },
    });

    /**
     * Another finalize request won the race.
     *
     * Do not overwrite the final stats.
     */
    if (finalizeWrite.count === 0) {
      const alreadyFinalizedParticipant =
        await prisma.clanEventParticipant.findUnique({
          where: {
            eventId_userId: {
              eventId,
              userId,
            },
          },
        });

      return res.status(200).json({
        success: true,

        duplicate: true,

        message: "Club Event result is already finalized",

        participant: alreadyFinalizedParticipant ?? participant,
      });
    }

    /**
     * Retrieve the participant after successful
     * conditional finalization.
     */
    const updatedParticipant = await prisma.clanEventParticipant.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    /**
     * Recalculate:
     *
     * ranks
     * combined event totals
     */

    const snapshot = await persistEventResultsSnapshot(eventId);

    /**
     * Once:
     *
     * leader stopped
     * +
     * all started participants finalized
     *
     * event results become completely final.
     */

    if (event.leaderStoppedAt && snapshot.pendingFinalizations === 0) {
      await prisma.clanEvent.update({
        where: {
          id: eventId,
        },

        data: {
          completedAt: new Date(),
        },
      });
    }

    const myResult =
      snapshot.results.find((item) => item.userId === userId) ?? null;

    return res.status(200).json({
      success: true,

      message: "Club Event result finalized",

      participant: updatedParticipant,

      result: myResult,

      totals: snapshot.totals,

      leaderboard: snapshot.results,

      pendingFinalizations: snapshot.pendingFinalizations,
      bestSplit: snapshot.bestSplit,

      bestSplitPace: snapshot.bestSplitPace,

      bestSplitPaceSec: snapshot.bestSplitPaceSec,

      bestSplitParticipant: snapshot.bestSplitParticipant,

      resultsFinal:
        Boolean(event.leaderStoppedAt) && snapshot.pendingFinalizations === 0,
    });
  } catch (error) {
    console.error("FINALIZE_CLAN_EVENT_RUN_ERROR:", error);

    if (error?.code === "INVALID_EVENT_STATS") {
      return res.status(400).json({
        success: false,

        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,

      message: "Failed to finalize Club Event result",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | GET CLUB EVENT RUN STATUS
 * |--------------------------------------------------------------------------
 * | GET /api/clan-events/:eventId/run/status
 * |--------------------------------------------------------------------------
 *
 * Flutter can poll this endpoint while the event activity is running.
 */

export const getClanEventRunStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;

    await autoEndExpiredClanEvent(eventId);

    const { event, membership, participant } = await getEventRunContext({
      eventId,
      userId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,

        message: "Event not found",
      });
    }

    if (!participant && !membership) {
      return res.status(403).json({
        success: false,
        message: "Join this event before accessing its activity status",
      });
    }

    const runLeaderId =
      event.runLeaderId ??
      (event.clanId
        ? await resolveClanRunLeaderId(event.clanId)
        : event.createdById);

    const currentUserIsRunLeader = runLeaderId === userId;

    return res.status(200).json({
      success: true,

      serverNow: new Date(),

      event: {
        id: event.id,

        title: event.title,

        targetDistanceKm: event.targetDistanceKm,

        status: event.status,

        startsAt: event.startsAt,

        endsAt: event.endsAt,

        runLeaderId,

        runStartedAt: event.runStartedAt,

        leaderStoppedAt: event.leaderStoppedAt,

        completedAt: event.completedAt,
      },

      participant,

      isRunLeader: currentUserIsRunLeader,

      eventEnded: Boolean(
        event.leaderStoppedAt || event.status === "COMPLETED",
      ),

      eventCutoffAt:
        participant?.eventCutoffAt ?? event.leaderStoppedAt ?? null,

      /**
       * Flutter can use this flag to know it should calculate
       * exact stats up to eventCutoffAt and call /run/finalize.
       */
      shouldFinalizeEventResult:
        Boolean(participant?.startedAt) &&
        participant?.status !== "FINALIZED" &&
        Boolean(participant?.eventCutoffAt ?? event.leaderStoppedAt),
    });
  } catch (error) {
    console.error("GET_CLAN_EVENT_RUN_STATUS_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch Club Event run status",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | GET CLUB EVENT RESULTS
 * |--------------------------------------------------------------------------
 * | GET /api/clan-events/:eventId/run/results
 * |--------------------------------------------------------------------------
 */

export const getClanEventRunResults = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;

    await autoEndExpiredClanEvent(eventId);

    const event = await prisma.clanEvent.findUnique({
      where: {
        id: eventId,
      },

      include: {
        clan: {
          select: {
            id: true,
            name: true,
            captainId: true,
          },
        },

        runLeader: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },

        _count: {
          select: {
            participants: true,
          },
        },
      },
    });

    if (!event) {
      return res.status(404).json({
        success: false,

        message: "Event not found",
      });
    }

    const recovery = await recoverExpiredEventParticipants(eventId);

    const snapshot =
      recovery.recovered > 0
        ? await persistEventResultsSnapshot(eventId)
        : await buildEventResultsSnapshot(eventId);

    let resolvedCompletedAt = event.completedAt;

    if (
      event.status === "COMPLETED" &&
      event.leaderStoppedAt &&
      snapshot.pendingFinalizations === 0 &&
      !event.completedAt
    ) {
      const completedEvent = await prisma.clanEvent.update({
        where: {
          id: eventId,
        },

        data: {
          completedAt: new Date(),
        },

        select: {
          completedAt: true,
        },
      });

      resolvedCompletedAt = completedEvent.completedAt;
    }
    // ============================================================
    // ATTACH EQUIPPED DURO AVATARS TO EVENT RESULTS
    // ============================================================

    const resultUserIds = [
      ...new Set(snapshot.results.map((item) => item.userId).filter(Boolean)),
    ];

    const resultUsers =
      resultUserIds.length > 0
        ? await prisma.user.findMany({
            where: {
              id: {
                in: resultUserIds,
              },
            },

            select: {
              id: true,
              username: true,
              fullName: true,
              skinIndex: true,

              avatars: {
                where: {
                  isEquipped: true,
                  status: "UNLOCKED",
                },

                include: {
                  avatar: true,
                },
              },
            },
          })
        : [];

    const userDataMap = new Map();

    for (const user of resultUsers) {
      const avatar = {};

      for (const item of user.avatars ?? []) {
        if (!item.avatar) continue;

        avatar[item.avatar.type] = {
          id: item.avatar.id,
          file: item.avatar.file,
          type: item.avatar.type,
        };
      }

      userDataMap.set(user.id, {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        skinIndex: user.skinIndex ?? 2,
        avatar,
      });
    }

    // Add user + avatar information to every leaderboard result.
    const leaderboard = snapshot.results.map((result) => {
      const user = userDataMap.get(result.userId);

      return {
        ...result,

        user: user ?? {
          id: result.userId,
          username: null,
          fullName: null,
          skinIndex: 2,
          avatar: {},
        },
      };
    });

    const myResult =
      snapshot.results.find((item) => item.userId === userId) ?? null;

    const isRunLeader = event.runLeaderId === userId;

    // ============================================================
    // EVENT ROUTE
    //
    // 1. If official leader participated -> use leader route.
    //
    // 2. If official leader did NOT participate ->
    //    use the route of the participant with the longest distance.
    //
    // Applies to both:
    // - Club Event
    // - Independent / Public Event
    // ============================================================

    const leaderResult = event.runLeaderId
      ? (snapshot.results.find((item) => item.userId === event.runLeaderId) ??
        null)
      : null;

    const leaderParticipated = Boolean(leaderResult);

    let eventRouteResult = null;
    let eventRouteActivity = null;
    let eventRouteSource = null;

    const findActivityForEventResult = async (result) => {
      if (!result) {
        return null;
      }

      if (result.activityId) {
        const activity = await prisma.activity.findFirst({
          where: {
            id: result.activityId,
            userId: result.userId,
          },

          select: {
            id: true,
            userId: true,
            routeEncoded: true,
            startedAt: true,
            endedAt: true,
            distanceKm: true,
          },
        });

        if (activity?.routeEncoded && activity.routeEncoded.trim().length > 0) {
          return activity;
        }
      }

      if (result.clientActivityId) {
        const activity = await prisma.activity.findFirst({
          where: {
            userId: result.userId,
            clientActivityId: result.clientActivityId,
          },

          orderBy: {
            startedAt: "desc",
          },

          select: {
            id: true,
            userId: true,
            routeEncoded: true,
            startedAt: true,
            endedAt: true,
            distanceKm: true,
          },
        });

        if (activity?.routeEncoded && activity.routeEncoded.trim().length > 0) {
          return activity;
        }
      }

      return null;
    };

    if (leaderParticipated) {
      const activity = await findActivityForEventResult(leaderResult);

      if (activity) {
        eventRouteResult = leaderResult;
        eventRouteActivity = activity;
        eventRouteSource = "LEADER";
      }
    } else {
      for (const result of snapshot.results) {
        if (result.userId === event.runLeaderId) {
          continue;
        }

        const activity = await findActivityForEventResult(result);

        if (!activity) {
          continue;
        }

        eventRouteResult = result;
        eventRouteActivity = activity;
        eventRouteSource = "LONGEST_DISTANCE";

        break;
      }
    }

    const eventRouteUser = eventRouteResult
      ? (userDataMap.get(eventRouteResult.userId) ??
        eventRouteResult.user ??
        null)
      : null;

    return res.status(200).json({
      success: true,

      event: {
        id: event.id,

        title: event.title,

        targetDistanceKm: event.targetDistanceKm,

        status: event.status,

        startsAt: event.startsAt,

        endsAt: event.endsAt,

        runStartedAt: event.runStartedAt,

        leaderStoppedAt: event.leaderStoppedAt,

        completedAt: resolvedCompletedAt,

        runLeader: event.runLeader,

        bestSplit: snapshot.bestSplit,

        bestSplitPace: snapshot.bestSplitPace,

        bestSplitPaceSec: snapshot.bestSplitPaceSec,

        bestSplitParticipant: snapshot.bestSplitParticipant,

        joinedParticipants: event._count.participants,
      },

      isRunLeader,
      eventRouteActivity,

      eventRouteEncoded: eventRouteActivity?.routeEncoded ?? null,

      eventRouteUser,

      eventRouteSource,

      eventRouteDistanceKm: eventRouteResult
        ? Number(eventRouteResult.distanceKm ?? 0)
        : 0,

      leaderActivity: eventRouteSource === "LEADER" ? eventRouteActivity : null,

      leaderRouteEncoded:
        eventRouteSource === "LEADER"
          ? (eventRouteActivity?.routeEncoded ?? null)
          : null,

      /**
       * Used for leader's combined Event Summary.
       */
      totals: snapshot.totals,

      startedParticipants: snapshot.startedParticipants,

      finalizedParticipants: snapshot.finalizedParticipants,

      pendingFinalizations: snapshot.pendingFinalizations,

      bestSplitPace: snapshot.bestSplitPace,

      bestSplitParticipant: snapshot.bestSplitParticipant,

      resultsFinal:
        Boolean(event.leaderStoppedAt) && snapshot.pendingFinalizations === 0,

      /**
       * Used for runner/captain personal event summary.
       */
      myResult,

      /**
       * Full event leaderboard.
       */
      leaderboard,
    });
  } catch (error) {
    console.error("GET_CLAN_EVENT_RUN_RESULTS_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch Club Event results",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | CANCEL CLAN EVENT
 * |--------------------------------------------------------------------------
 */

export const cancelClanEvent = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;

    // =========================================================
    // FIND EVENT
    // =========================================================

    const event = await prisma.clanEvent.findUnique({
      where: {
        id: eventId,
      },
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    // =========================================================
    // CHECK LEADER ACCESS
    // =========================================================

    const access = await checkEventManagementAccess({
      event,
      userId,
    });

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    // =========================================================
    // ALREADY CANCELLED
    // =========================================================

    if (event.status === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "This Club Event has already been cancelled.",
      });
    }

    // =========================================================
    // COMPLETED EVENT CANNOT BE CANCELLED
    // =========================================================

    if (event.status === "COMPLETED" || event.leaderStoppedAt) {
      return res.status(400).json({
        success: false,
        message: "A completed event cannot be cancelled",
      });
    }

    // =========================================================
    // CHECK IF EVENT HAS ALREADY STARTED
    // =========================================================

    const cancellingActiveRun =
      event.status === "ACTIVE" || Boolean(event.runStartedAt);

    const cancelledAt = new Date();

    // =========================================================
    // BUILD DATABASE OPERATIONS
    // =========================================================

    const operations = [
      prisma.clanEvent.update({
        where: {
          id: eventId,
        },

        data: {
          status: "CANCELLED",

          /*
           * If this event was already LIVE,
           * use cancellation time as the official
           * Club Event cutoff.
           */
          ...(cancellingActiveRun
            ? {
                leaderStoppedAt: cancelledAt,
              }
            : {}),
        },
      }),
    ];

    // =========================================================
    // IF LIVE EVENT IS CANCELLED
    // STOP CLUB-EVENT TRACKING FOR RUNNING PARTICIPANTS
    // =========================================================

    if (cancellingActiveRun) {
      operations.push(
        prisma.clanEventParticipant.updateMany({
          where: {
            eventId,
            status: "RUNNING",
          },

          data: {
            /*
             * Their personal DURO activity can continue,
             * but their Club Event result is capped here.
             */
            status: "CUTOFF_PENDING",

            eventCutoffAt: cancelledAt,
          },
        }),
      );
    }

    // =========================================================
    // EXECUTE EVERYTHING ATOMICALLY
    // =========================================================

    const [updatedEvent] = await prisma.$transaction(operations);

    // =========================================================
    // RESPONSE
    // =========================================================

    return res.status(200).json({
      success: true,

      message: cancellingActiveRun
        ? "Active Club Event cancelled successfully"
        : "Clan event cancelled successfully",

      data: updatedEvent,

      ...(cancellingActiveRun
        ? {
            eventEnded: true,
            eventCutoffAt: cancelledAt,
          }
        : {}),
    });
  } catch (error) {
    console.error("CANCEL_CLAN_EVENT_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to cancel clan event",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | UPDATE CLAN EVENT DETAILS
 * |--------------------------------------------------------------------------
 * | PATCH /api/clan-event/:eventId
 * |--------------------------------------------------------------------------
 *
 * LEADER and CAPTAIN may edit an UPCOMING event.
 *
 * Once the official Club Event run starts, the event becomes immutable so
 * schedule/result history cannot be rewritten.
 */

export const updateClanEvent = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;

    // =========================================================
    // FIND EVENT
    // =========================================================

    const event = await prisma.clanEvent.findUnique({
      where: {
        id: eventId,
      },

      include: {
        _count: {
          select: {
            participants: true,
          },
        },
      },
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    // =========================================================
    // CHECK LEADER / CAPTAIN ACCESS
    // =========================================================

    const access = await checkEventManagementAccess({
      event,
      userId,
    });

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    // =========================================================
    // ONLY UPCOMING EVENTS CAN BE EDITED
    // =========================================================

    if (
      event.status !== "UPCOMING" ||
      event.runStartedAt ||
      event.leaderStoppedAt
    ) {
      return res.status(409).json({
        success: false,
        message: "Only an upcoming Club Event can be edited",
      });
    }

    // =========================================================
    // GET UPDATED DATA
    // =========================================================

    const {
      title,
      description,
      location,
      startsAt,
      endsAt,
      maxParticipants,
      targetDistanceKm,
    } = req.body;

    // =========================================================
    // VALIDATION
    // =========================================================

    if (!title?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Event title is required",
      });
    }

    if (!description?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Event description is required",
      });
    }

    if (!location?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Event location is required",
      });
    }

    if (!startsAt || !endsAt) {
      return res.status(400).json({
        success: false,
        message: "Event start time and end time are required",
      });
    }

    // =========================================================
    // DATE VALIDATION
    // =========================================================

    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid event date and time.",
      });
    }

    // Edited event still has to start in the future
    if (startDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "Event start time must be in the future",
      });
    }

    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: "Event end time must be after the start time",
      });
    }

    // =========================================================
    // MAX PARTICIPANTS VALIDATION
    // =========================================================

    const parsedMaxParticipants = Number(maxParticipants);

    if (!Number.isInteger(parsedMaxParticipants) || parsedMaxParticipants < 1) {
      return res.status(400).json({
        success: false,
        message: "Maximum participants must be at least 1",
      });
    }

    if (parsedMaxParticipants > 10000) {
      return res.status(400).json({
        success: false,
        message: "Maximum participants cannot be more than 10,000",
      });
    }

    // Example:
    // already 12 participants joined
    // leader cannot change maximum participants to 5
    if (parsedMaxParticipants < event._count.participants) {
      return res.status(400).json({
        success: false,
        message: `Maximum participants cannot be lower than the current participant count (${event._count.participants})`,
      });
    }

    // =========================================================
    // TARGET DISTANCE VALIDATION
    // =========================================================

    let parsedTargetDistanceKm = null;

    if (
      targetDistanceKm !== undefined &&
      targetDistanceKm !== null &&
      targetDistanceKm !== ""
    ) {
      parsedTargetDistanceKm = Number(targetDistanceKm);

      if (
        !Number.isFinite(parsedTargetDistanceKm) ||
        parsedTargetDistanceKm <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Target distance must be greater than 0 km",
        });
      }
    }

    // =========================================================
    // UPDATE EVENT
    // =========================================================

    const updatedEvent = await prisma.clanEvent.update({
      where: {
        id: eventId,
      },

      data: {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        startsAt: startDate,
        endsAt: endDate,
        maxParticipants: parsedMaxParticipants,
        targetDistanceKm: parsedTargetDistanceKm,
      },

      include: {
        clan: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            banner: true,
            imageUrl: true,
          },
        },

        createdBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },

        _count: {
          select: {
            participants: true,
          },
        },
      },
    });

    // =========================================================
    // RESPONSE
    // =========================================================

    return res.status(200).json({
      success: true,
      message: "Club event updated successfully",

      data: {
        ...updatedEvent,

        participantsCount: updatedEvent._count.participants,

        availableSpots:
          updatedEvent.maxParticipants === null
            ? null
            : Math.max(
                updatedEvent.maxParticipants - updatedEvent._count.participants,
                0,
              ),
      },
    });
  } catch (error) {
    console.error("UPDATE_CLAN_EVENT_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update clan event",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | DELETE CLAN EVENT
 * |--------------------------------------------------------------------------
 */

export const deleteClanEvent = async (req, res) => {
  try {
    const userId = req.user.id;

    const { eventId } = req.params;

    if (!eventId) {
      return res.status(400).json({
        success: false,

        message: "Event ID is required",
      });
    }

    const event = await prisma.clanEvent.findUnique({
      where: {
        id: eventId,
      },

      select: {
        id: true,
        clanId: true,
        createdById: true,
        runLeaderId: true,
        title: true,
        status: true,
        runStartedAt: true,
        leaderStoppedAt: true,
      },
    });

    if (!event) {
      return res.status(404).json({
        success: false,

        message: "Event not found",
      });
    }

    const access = await checkEventManagementAccess({
      event,
      userId,
    });

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    /**
     * Do not delete event-history/results after a Club Event has started.
     */
    if (
      event.runStartedAt ||
      event.leaderStoppedAt ||
      event.status === "ACTIVE" ||
      event.status === "COMPLETED"
    ) {
      return res.status(409).json({
        success: false,

        message: "A Club Event that has started or completed cannot be deleted",
      });
    }

    await prisma.$transaction([
      prisma.clanEventParticipant.deleteMany({
        where: {
          eventId,
        },
      }),

      prisma.clanEvent.delete({
        where: {
          id: eventId,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,

      message: "Club event deleted successfully",

      data: {
        eventId: event.id,

        title: event.title,
      },
    });
  } catch (error) {
    console.error("DELETE_CLAN_EVENT_ERROR:", error);

    if (error?.code === "P2025") {
      return res.status(404).json({
        success: false,

        message: "Event not found or already deleted",
      });
    }

    if (error?.code === "P2003") {
      return res.status(409).json({
        success: false,

        message: "The event has related records that prevent deletion",
      });
    }

    return res.status(500).json({
      success: false,

      message: "Failed to delete clan event",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const discoverClanEvents = async (req, res) => {
  try {
    const userId = req.user.id;
    await autoEndAllExpiredClanEvents();
    const now = new Date();

    const membership = await getUserClanMembership(userId);

    const events = await prisma.clanEvent.findMany({
      where: {
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
            imageUrl: true,
          },
        },

        createdBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },

        /**
         * We only need the logged-in user's participant row here.
         * The total participant count comes from _count below.
         */
        participants: {
          where: {
            userId,
          },

          select: {
            id: true,
            userId: true,
            joinedAt: true,
            roleSnapshot: true,
            status: true,
            startedAt: true,
            stoppedAt: true,
            eventCutoffAt: true,
            finalizedAt: true,
            distanceKm: true,
            rank: true,
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

    const data = events.map((event) => {
      const myParticipant = event.participants[0] ?? null;
      const participantsCount = event._count.participants;

      const isFull =
        event.maxParticipants !== null &&
        participantsCount >= event.maxParticipants;

      const isParticipating = myParticipant !== null;

      const isRunLeader = event.runLeaderId === userId;

      const canJoin =
        !isParticipating &&
        !isRunLeader &&
        !isFull &&
        !event.runStartedAt &&
        event.status !== "ACTIVE" &&
        event.endsAt > now;

      return {
        id: event.id,

        eventType: event.clanId ? "CLUB" : "PUBLIC",

        clanId: event.clanId,

        title: event.title,

        description: event.description,

        location: event.location,

        targetDistanceKm: event.targetDistanceKm,

        startsAt: event.startsAt,

        endsAt: event.endsAt,

        maxParticipants: event.maxParticipants,

        status: event.status,

        createdAt: event.createdAt,

        updatedAt: event.updatedAt,

        runLeaderId: event.runLeaderId,

        runStartedAt: event.runStartedAt,

        leaderStoppedAt: event.leaderStoppedAt,

        completedAt: event.completedAt,

        totalDistanceKm: event.totalDistanceKm,

        totalCalories: event.totalCalories,

        totalMovingTimeSec: event.totalMovingTimeSec,

        totalElevationGain: event.totalElevationGain,

        clan: event.clan,

        createdBy: event.createdBy,

        participantsCount,

        myParticipant,

        isParticipating,

        isOwnClanEvent: membership?.clanId === event.clanId,

        isRunLeader,

        isFull,

        canJoin,

        availableSpots:
          event.maxParticipants === null
            ? null
            : Math.max(event.maxParticipants - participantsCount, 0),
      };
    });

    return res.status(200).json({
      success: true,

      currentUser: {
        clanId: membership?.clanId ?? null,

        isClanMember: Boolean(membership),
      },

      count: data.length,

      events: data,
    });
  } catch (error) {
    console.error("DISCOVER_CLAN_EVENTS_ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to discover clan events",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
