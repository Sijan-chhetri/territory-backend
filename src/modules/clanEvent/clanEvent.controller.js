// // modules/clan-event/clan-event.controller.js

// import prisma from "../../config/prisma.js";

// import { sendClanEventInvitations } from "./clanEventEmail.service.js";

// import { sendFCMToUser } from "../../config/fcm.service.js";

// const getUserClanMembership = async (userId) => {
//   return prisma.clanMember.findFirst({
//     where: {
//       userId,
//     },
//     select: {
//       id: true,
//       clanId: true,
//       role: true,
//       joinedAt: true,

//       clan: {
//         select: {
//           id: true,
//           name: true,
//           slug: true,
//           logo: true,
//           banner: true,
//           imageUrl: true,
//           captainId: true,
//         },
//       },
//     },
//   });
// };

// /**
//  * Check whether the user is allowed to manage a clan.
//  * Supports both captainId and LEADER/CAPTAIN membership roles.
//  */
// const checkClanLeaderAccess = async (userId) => {
//   const membership = await getUserClanMembership(userId);

//   if (!membership) {
//     return {
//       allowed: false,
//       membership: null,
//       clan: null,
//       status: 404,
//       message: "You are not a member of any clan",
//     };
//   }

//   const isCaptain = membership.clan.captainId === userId;

//   const isLeader =
//     membership.role === "LEADER" || membership.role === "CAPTAIN";

//   return {
//     allowed: isCaptain || isLeader,
//     membership,
//     clan: membership.clan,
//     status: isCaptain || isLeader ? 200 : 403,
//     message:
//       isCaptain || isLeader
//         ? null
//         : "Only the clan leader can perform this action",
//   };
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | RESOLVE STRICT CLUB EVENT RUN LEADER
//  * |--------------------------------------------------------------------------
//  *
//  * This is different from normal event administration.
//  *
//  * CAPTAIN:
//  * - can manage ordinary event details according to your existing system
//  * - can participate in the event
//  * - CANNOT stop the entire event
//  *
//  * LEADER:
//  * - controls the official event cutoff
//  */

// const resolveClanRunLeaderId = async (clanId) => {
//   /**
//    * First prefer the actual LEADER membership.
//    */
//   const leaderMembership =
//     await prisma.clanMember.findFirst({
//       where: {
//         clanId,
//         role: "LEADER",
//       },

//       select: {
//         userId: true,
//       },
//     });

//   if (leaderMembership?.userId) {
//     return leaderMembership.userId;
//   }

//   /**
//    * Fallback for older clan records.
//    */
//   const clan =
//     await prisma.clan.findUnique({
//       where: {
//         id: clanId,
//       },

//       select: {
//         captainId: true,
//       },
//     });

//   return clan?.captainId ?? null;
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | CHECK STRICT RUN LEADER
//  * |--------------------------------------------------------------------------
//  */

// const isStrictClanRunLeader = ({
//   membership,
//   userId,
//   runLeaderId,
// }) => {
//   if (!membership) {
//     return false;
//   }

//   /**
//    * Once a leader has been snapshotted onto the event,
//    * that exact user remains the run leader for that event.
//    */
//   if (runLeaderId) {
//     return runLeaderId === userId;
//   }

//   return (
//     membership.role === "LEADER" ||
//     membership.clan?.captainId === userId
//   );
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | GET CLUB EVENT RUN CONTEXT
//  * |--------------------------------------------------------------------------
//  */

// const getEventRunContext = async ({
//   eventId,
//   userId,
// }) => {
//   const event =
//     await prisma.clanEvent.findUnique({
//       where: {
//         id: eventId,
//       },

//       include: {
//         clan: {
//           select: {
//             id: true,
//             name: true,
//             captainId: true,
//           },
//         },

//         runLeader: {
//           select: {
//             id: true,
//             username: true,
//             fullName: true,
//           },
//         },
//       },
//     });

//   if (!event) {
//     return {
//       event: null,
//       membership: null,
//       participant: null,
//     };
//   }

//   const [membership, participant] =
//     await Promise.all([
//       prisma.clanMember.findUnique({
//         where: {
//           clanId_userId: {
//             clanId: event.clanId,
//             userId,
//           },
//         },

//         select: {
//           id: true,
//           clanId: true,
//           userId: true,
//           role: true,
//           joinedAt: true,

//           clan: {
//             select: {
//               id: true,
//               captainId: true,
//             },
//           },
//         },
//       }),

//       prisma.clanEventParticipant.findUnique({
//         where: {
//           eventId_userId: {
//             eventId,
//             userId,
//           },
//         },
//       }),
//     ]);

//   return {
//     event,
//     membership,
//     participant,
//   };
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | PARSE EVENT STATS
//  * |--------------------------------------------------------------------------
//  */

// const parseEventStats = (
//   body,
//   { partial = false } = {},
// ) => {
//   const floatFields = [
//     "distanceKm",
//     "calories",
//     "elevationGain",
//     "avgPace",
//     "avgSpeed",
//     "topSpeed",
//   ];

//   const integerFields = [
//     "elapsedTime",
//     "movingTime",
//   ];

//   const data = {};

//   for (const field of floatFields) {
//     const raw = body?.[field];

//     if (
//       raw === undefined ||
//       raw === null ||
//       raw === ""
//     ) {
//       if (
//         !partial &&
//         [
//           "distanceKm",
//           "calories",
//           "elevationGain",
//         ].includes(field)
//       ) {
//         data[field] = 0;
//       }

//       continue;
//     }

//     const value = Number(raw);

//     if (
//       !Number.isFinite(value) ||
//       value < 0
//     ) {
//       const error =
//         new Error(
//           `${field} must be a non-negative number`,
//         );

//       error.code =
//         "INVALID_EVENT_STATS";

//       throw error;
//     }

//     data[field] = value;
//   }

//   for (const field of integerFields) {
//     const raw = body?.[field];

//     if (
//       raw === undefined ||
//       raw === null ||
//       raw === ""
//     ) {
//       if (!partial) {
//         data[field] = 0;
//       }

//       continue;
//     }

//     const value = Number(raw);

//     if (
//       !Number.isFinite(value) ||
//       value < 0
//     ) {
//       const error =
//         new Error(
//           `${field} must be a non-negative number`,
//         );

//       error.code =
//         "INVALID_EVENT_STATS";

//       throw error;
//     }

//     data[field] =
//       Math.round(value);
//   }

//   return data;
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | BUILD EVENT RESULTS / RANKING
//  * |--------------------------------------------------------------------------
//  */

// const buildEventResultsSnapshot =
//   async (eventId) => {
//     const participants =
//       await prisma.clanEventParticipant.findMany({
//         where: {
//           eventId,

//           startedAt: {
//             not: null,
//           },
//         },

//         include: {
//           user: {
//             select: {
//               id: true,
//               username: true,
//               fullName: true,
//             },
//           },
//         },
//       });

//     /**
//      * Ranking:
//      *
//      * 1. Greater distance
//      * 2. Faster avg pace
//      * 3. Lower moving time
//      * 4. Earlier start as final deterministic tie-break
//      */

//     const ranked =
//       [...participants].sort(
//         (a, b) => {
//           const distanceDifference =
//             Number(
//               b.distanceKm ?? 0,
//             ) -
//             Number(
//               a.distanceKm ?? 0,
//             );

//           if (
//             Math.abs(
//               distanceDifference,
//             ) > 1e-9
//           ) {
//             return distanceDifference;
//           }

//           const aPace =
//             Number(a.avgPace);

//           const bPace =
//             Number(b.avgPace);

//           const safeAPace =
//             Number.isFinite(aPace) &&
//             aPace > 0
//               ? aPace
//               : Number.POSITIVE_INFINITY;

//           const safeBPace =
//             Number.isFinite(bPace) &&
//             bPace > 0
//               ? bPace
//               : Number.POSITIVE_INFINITY;

//           if (
//             safeAPace !==
//             safeBPace
//           ) {
//             return (
//               safeAPace -
//               safeBPace
//             );
//           }

//           const movingDifference =
//             Number(
//               a.movingTime ?? 0,
//             ) -
//             Number(
//               b.movingTime ?? 0,
//             );

//           if (
//             movingDifference !== 0
//           ) {
//             return movingDifference;
//           }

//           return (
//             new Date(
//               a.startedAt,
//             ).getTime() -
//             new Date(
//               b.startedAt,
//             ).getTime()
//           );
//         },
//       );

//     const results =
//       ranked.map(
//         (
//           participant,
//           index,
//         ) => ({
//           rank: index + 1,

//           participantId:
//             participant.id,

//           userId:
//             participant.userId,

//           user:
//             participant.user,

//           role:
//             participant.roleSnapshot,

//           status:
//             participant.status,

//           startedAt:
//             participant.startedAt,

//           stoppedAt:
//             participant.stoppedAt,

//           eventCutoffAt:
//             participant.eventCutoffAt,

//           finalizedAt:
//             participant.finalizedAt,

//           distanceKm:
//             Number(
//               participant.distanceKm ??
//                 0,
//             ),

//           elapsedTime:
//             Number(
//               participant.elapsedTime ??
//                 0,
//             ),

//           movingTime:
//             Number(
//               participant.movingTime ??
//                 0,
//             ),

//           calories:
//             Number(
//               participant.calories ??
//                 0,
//             ),

//           elevationGain:
//             Number(
//               participant.elevationGain ??
//                 0,
//             ),

//           avgPace:
//             participant.avgPace,

//           avgSpeed:
//             participant.avgSpeed,

//           topSpeed:
//             participant.topSpeed,

//           isFinalized:
//             participant.status ===
//             "FINALIZED",
//         }),
//       );

//     /**
//      * Combined event totals.
//      */

//     const totals =
//       results.reduce(
//         (acc, item) => {
//           acc.distanceKm +=
//             item.distanceKm;

//           acc.calories +=
//             item.calories;

//           acc.movingTimeSec +=
//             item.movingTime;

//           acc.elevationGain +=
//             item.elevationGain;

//           return acc;
//         },

//         {
//           distanceKm: 0,
//           calories: 0,
//           movingTimeSec: 0,
//           elevationGain: 0,
//         },
//       );

//     /**
//      * Do not average user paces.
//      *
//      * Combined pace:
//      *
//      * total moving minutes
//      * --------------------
//      * total distance
//      */

//     const avgPace =
//       totals.distanceKm > 0
//         ? (
//             totals.movingTimeSec /
//             60
//           ) /
//           totals.distanceKm
//         : 0;

//     return {
//       results,

//       totals: {
//         ...totals,
//         avgPace,
//       },

//       startedParticipants:
//         results.length,

//       finalizedParticipants:
//         results.filter(
//           (item) =>
//             item.isFinalized,
//         ).length,

//       pendingFinalizations:
//         results.filter(
//           (item) =>
//             !item.isFinalized,
//         ).length,
//     };
//   };

// /**
//  * |--------------------------------------------------------------------------
//  * | SAVE RANKS + EVENT TOTALS
//  * |--------------------------------------------------------------------------
//  */

// const persistEventResultsSnapshot =
//   async (eventId) => {
//     const snapshot =
//       await buildEventResultsSnapshot(
//         eventId,
//       );

//     const operations =
//       snapshot.results.map(
//         (item) =>
//           prisma.clanEventParticipant.update({
//             where: {
//               id: item.participantId,
//             },

//             data: {
//               rank: item.rank,
//             },
//           }),
//       );

//     operations.push(
//       prisma.clanEvent.update({
//         where: {
//           id: eventId,
//         },

//         data: {
//           totalDistanceKm:
//             snapshot.totals.distanceKm,

//           totalCalories:
//             snapshot.totals.calories,

//           totalMovingTimeSec:
//             snapshot.totals
//               .movingTimeSec,

//           totalElevationGain:
//             snapshot.totals
//               .elevationGain,
//         },
//       }),
//     );

//     if (operations.length > 0) {
//       await prisma.$transaction(
//         operations,
//       );
//     }

//     return snapshot;
//   };

// /**
//  * |--------------------------------------------------------------------------
//  * | CREATE EVENT FOR CURRENT USER'S CLAN
//  * |--------------------------------------------------------------------------
//  * | POST /api/clan-events
//  * |--------------------------------------------------------------------------
//  */
// export const createClanEvent = async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const { title, description, location, startsAt, endsAt, maxParticipants } =
//       req.body;

//     /**
//      * |--------------------------------------------------------------------------
//      * | VALIDATION
//      * |--------------------------------------------------------------------------
//      */

//     if (!title?.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: "Event title is required",
//       });
//     }

//     if (!startsAt || !endsAt) {
//       return res.status(400).json({
//         success: false,
//         message: "Event start time and end time are required",
//       });
//     }

//     const startDate = new Date(startsAt);
//     const endDate = new Date(endsAt);

//     if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid event date",
//       });
//     }

//     if (endDate <= startDate) {
//       return res.status(400).json({
//         success: false,
//         message: "Event end time must be after the start time",
//       });
//     }

//     if (startDate <= new Date()) {
//       return res.status(400).json({
//         success: false,
//         message: "Event start time must be in the future",
//       });
//     }

//     let parsedMaxParticipants = null;

//     if (
//       maxParticipants !== undefined &&
//       maxParticipants !== null &&
//       maxParticipants !== ""
//     ) {
//       parsedMaxParticipants = Number(maxParticipants);

//       if (
//         !Number.isInteger(parsedMaxParticipants) ||
//         parsedMaxParticipants < 1
//       ) {
//         return res.status(400).json({
//           success: false,
//           message: "Maximum participants must be at least 1",
//         });
//       }
//     }

//     /**
//      * |--------------------------------------------------------------------------
//      * | CHECK CLAN LEADER ACCESS
//      * |--------------------------------------------------------------------------
//      */

//     const access = await checkClanLeaderAccess(userId);

//     if (!access.allowed) {
//       return res.status(access.status).json({
//         success: false,
//         message: access.message,
//       });
//     }

//     const clanId = access.membership.clanId;

//     /**
//      * |--------------------------------------------------------------------------
//      * | CREATE EVENT
//      * |--------------------------------------------------------------------------
//      */

//     const event = await prisma.clanEvent.create({
//       data: {
//         clanId,
//         createdById: userId,
//         title: title.trim(),
//         description: description?.trim() || null,
//         location: location?.trim() || null,
//         startsAt: startDate,
//         endsAt: endDate,
//         maxParticipants: parsedMaxParticipants,
//       },

//       include: {
//         clan: {
//           select: {
//             id: true,
//             name: true,
//             slug: true,
//             logo: true,
//             banner: true,
//             imageUrl: true,
//           },
//         },

//         createdBy: {
//           select: {
//             id: true,
//             username: true,
//             fullName: true,
//             email: true,
//           },
//         },

//         _count: {
//           select: {
//             participants: true,
//           },
//         },
//       },
//     });

//     /**
//      * Automatically add the real clan leader as an event participant.
//      *
//      * This means the leader doesn't need to press Join Event.
//      */

//     const runLeaderId = await resolveClanRunLeaderId(clanId);

//     if (runLeaderId) {
//       await prisma.clanEventParticipant.upsert({
//         where: {
//           eventId_userId: {
//             eventId: event.id,

//             userId: runLeaderId,
//           },
//         },

//         create: {
//           eventId: event.id,

//           userId: runLeaderId,
//         },

//         update: {},
//       });
//     }

//     /**
//      * |--------------------------------------------------------------------------
//      * | FETCH ALL CLAN MEMBERS
//      * |--------------------------------------------------------------------------
//      */

//     const clanMembers = await prisma.clanMember.findMany({
//       where: {
//         clanId,
//       },

//       select: {
//         id: true,
//         userId: true,
//         role: true,

//         user: {
//           select: {
//             id: true,
//             email: true,
//             username: true,
//             fullName: true,
//           },
//         },
//       },
//     });

//     /**
//      * |--------------------------------------------------------------------------
//      * | SEND EMAIL INVITATIONS
//      * |--------------------------------------------------------------------------
//      *
//      * Email failure should not undo event creation.
//      */

//     let emailResult = {
//       attempted: 0,
//       sent: 0,
//       failed: 0,
//       successful: [],
//       failures: [],
//     };

//     try {
//       emailResult = await sendClanEventInvitations({
//         event,
//         clan: event.clan,
//         creator: event.createdBy,
//         members: clanMembers,
//       });
//     } catch (emailError) {
//       console.error("CLAN_EVENT_INVITATION_EMAIL_ERROR:", emailError);
//     }

//     /**
//      * |--------------------------------------------------------------------------
//      * | SEND PUSH NOTIFICATIONS TO CLAN MEMBERS ONLY
//      * |--------------------------------------------------------------------------
//      *
//      * Only members belonging to this clan are notified.
//      * The event creator is excluded.
//      * Notification failure does not undo event creation.
//      */

//     /**
//      * |--------------------------------------------------------------------------
//      * | SEND PUSH NOTIFICATIONS TO CLAN MEMBERS ONLY
//      * |--------------------------------------------------------------------------
//      */

//     const membersToNotify = clanMembers.filter(
//       (member) => member.userId !== userId,
//     );

//     let notificationResult = {
//       attempted: membersToNotify.length,
//       sent: 0,
//       failed: 0,
//     };

//     try {
//       const pushResults = await Promise.all(
//         membersToNotify.map(async (member) => {
//           const result = await sendFCMToUser({
//             userId: member.userId,

//             title: `New Event in ${event.clan.name}`,

//             message: event.location
//               ? `${event.title} • ${event.location}`
//               : event.title,

//             data: {
//               type: "CLAN_EVENT_CREATED",
//               eventId: event.id,
//               clanId: event.clan.id,
//               title: event.title,
//             },
//           });

//           return {
//             userId: member.userId,
//             success: Boolean(result),
//           };
//         }),
//       );

//       for (const result of pushResults) {
//         if (result.success) {
//           notificationResult.sent++;
//         } else {
//           notificationResult.failed++;
//         }
//       }

//       console.log(
//         `Clan event notifications: ${notificationResult.sent} sent, ${notificationResult.failed} failed`,
//       );
//     } catch (notificationError) {
//       console.error("CLAN_EVENT_NOTIFICATION_ERROR:", notificationError);
//     }

//     /**
//      * |--------------------------------------------------------------------------
//      * | RESPONSE
//      * |--------------------------------------------------------------------------
//      */

//     return res.status(201).json({
//       success: true,

//       message: "Clan event created successfully",

//       invitationMessage:
//         emailResult.sent > 0
//           ? `Invitations sent to ${emailResult.sent} clan members`
//           : "Event created successfully, but no email invitations were sent",

//       notificationMessage:
//         notificationResult.sent > 0
//           ? `Notifications sent to ${notificationResult.sent} clan members`
//           : "No push notifications were sent",

//       data: {
//         ...event,

//         participantsCount: event._count?.participants ?? 0,
//       },

//       emailInvitations: {
//         totalClanMembers: clanMembers.length,
//         attempted: emailResult.attempted,
//         sent: emailResult.sent,
//         failed: emailResult.failed,
//       },

//       pushNotifications: {
//         eligibleMembers: membersToNotify.length,
//         attempted: notificationResult.attempted,
//         sent: notificationResult.sent,
//         failed: notificationResult.failed,
//       },
//     });
//   } catch (error) {
//     console.error("CREATE_CLAN_EVENT_ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to create clan event",

//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | JOIN CLAN EVENT
//  * |--------------------------------------------------------------------------
//  * | POST /api/clan-events/:eventId/join
//  * |--------------------------------------------------------------------------
//  */
// export const joinClanEvent = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { eventId } = req.params;

//     const event = await prisma.clanEvent.findUnique({
//       where: {
//         id: eventId,
//       },
//       include: {
//         _count: {
//           select: {
//             participants: true,
//           },
//         },
//       },
//     });

//     if (!event) {
//       return res.status(404).json({
//         success: false,
//         message: "Event not found",
//       });
//     }

//     if (event.status === "CANCELLED") {
//       return res.status(400).json({
//         success: false,
//         message: "This event has been cancelled",
//       });
//     }

//     if (event.status === "COMPLETED") {
//       return res.status(400).json({
//         success: false,
//         message: "This event has already been completed",
//       });
//     }

//     if (new Date() >= event.endsAt) {
//       return res.status(400).json({
//         success: false,
//         message: "This event has already ended",
//       });
//     }

//     // Only a member of this specific clan can join
//     const membership = await prisma.clanMember.findUnique({
//       where: {
//         clanId_userId: {
//           clanId: event.clanId,
//           userId,
//         },
//       },
//     });

//     if (!membership) {
//       return res.status(403).json({
//         success: false,
//         message: "Only clan members can participate in this event",
//       });
//     }

//     const existingParticipant = await prisma.clanEventParticipant.findUnique({
//       where: {
//         eventId_userId: {
//           eventId,
//           userId,
//         },
//       },
//     });

//     if (existingParticipant) {
//       return res.status(400).json({
//         success: false,
//         message: "You have already joined this event",
//       });
//     }

//     if (
//       event.maxParticipants !== null &&
//       event._count.participants >= event.maxParticipants
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "This event is full",
//       });
//     }

//     const participant = await prisma.clanEventParticipant.create({
//       data: {
//         eventId,
//         userId,
//       },
//       include: {
//         user: {
//           select: {
//             id: true,
//             username: true,
//             fullName: true,
//           },
//         },
//       },
//     });

//     return res.status(201).json({
//       success: true,
//       message: "Event joined successfully",
//       data: participant,
//     });
//   } catch (error) {
//     console.error("JOIN_CLAN_EVENT_ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to join clan event",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | LEAVE CLAN EVENT
//  * |--------------------------------------------------------------------------
//  * | DELETE /api/clan-events/:eventId/leave
//  * |--------------------------------------------------------------------------
//  */
// export const leaveClanEvent = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { eventId } = req.params;

//     const participant = await prisma.clanEventParticipant.findUnique({
//       where: {
//         eventId_userId: {
//           eventId,
//           userId,
//         },
//       },
//     });

//     if (!participant) {
//       return res.status(404).json({
//         success: false,
//         message: "You are not participating in this event",
//       });
//     }

//     const event = await prisma.clanEvent.findUnique({
//       where: {
//         id: eventId,
//       },
//       select: {
//         startsAt: true,
//         status: true,
//       },
//     });

//     if (!event) {
//       return res.status(404).json({
//         success: false,
//         message: "Event not found",
//       });
//     }

//     /**
//      * Leader is auto-enrolled and should not leave the event.
//      */

//     if (event.runLeaderId === userId) {
//       return res.status(400).json({
//         success: false,

//         message: "The Club Event leader cannot leave this event",
//       });
//     }

//     if (
//         event.status ===
//           "ACTIVE" ||
//         event.runStartedAt
//       ) {
//         return res
//           .status(400)
//           .json({
//             success: false,

//             message:
//               "You cannot leave after the Club Event run has started",
//           });
//       }

//     await prisma.clanEventParticipant.delete({
//       where: {
//         eventId_userId: {
//           eventId,
//           userId,
//         },
//       },
//     });

//     return res.status(200).json({
//       success: true,
//       message: "You left the event successfully",
//     });
//   } catch (error) {
//     console.error("LEAVE_CLAN_EVENT_ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to leave clan event",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | GET CURRENT USER'S CLAN EVENTS
//  * |--------------------------------------------------------------------------
//  * | GET /api/clan-events
//  * |--------------------------------------------------------------------------
//  */
// export const getMyClanEvents = async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const membership = await getUserClanMembership(userId);

//     if (!membership) {
//       return res.status(404).json({
//         success: false,
//         message: "You are not a member of any clan",
//       });
//     }

//     const clanId = membership.clanId;

//     const events = await prisma.clanEvent.findMany({
//       where: {
//         clanId,
//       },
//       include: {
//         clan: {
//           select: {
//             id: true,
//             name: true,
//             slug: true,
//             logo: true,
//             banner: true,
//             imageUrl: true,
//           },
//         },

//         createdBy: {
//           select: {
//             id: true,
//             username: true,
//             fullName: true,
//           },
//         },

//         participants: {
//           select: {
//             id: true,
//             userId: true,
//             joinedAt: true,

//             user: {
//               select: {
//                 id: true,
//                 username: true,
//                 fullName: true,
//               },
//             },
//           },
//           orderBy: {
//             joinedAt: "asc",
//           },
//         },

//         _count: {
//           select: {
//             participants: true,
//           },
//         },
//       },
//       orderBy: {
//         startsAt: "asc",
//       },
//     });

//     const data = events.map((event) => ({
//       id: event.id,
//       clanId: event.clanId,
//       title: event.title,
//       description: event.description,
//       location: event.location,
//       startsAt: event.startsAt,
//       endsAt: event.endsAt,
//       maxParticipants: event.maxParticipants,
//       status: event.status,
//       createdAt: event.createdAt,
//       updatedAt: event.updatedAt,

//       clan: event.clan,
//       createdBy: event.createdBy,
//       participants: event.participants,

//       participantsCount: event._count.participants,

//       isParticipating: event.participants.some(
//         (participant) => participant.userId === userId,
//       ),

//       availableSpots:
//         event.maxParticipants === null
//           ? null
//           : Math.max(event.maxParticipants - event._count.participants, 0),
//     }));

//     return res.status(200).json({
//       success: true,

//       clan: {
//         id: membership.clan.id,
//         name: membership.clan.name,
//         slug: membership.clan.slug,
//         logo: membership.clan.logo,
//         banner: membership.clan.banner,
//         imageUrl: membership.clan.imageUrl,
//       },

//       currentUser: {
//         role: membership.role,
//         isLeader:
//           membership.role === "LEADER" ||
//           membership.role === "CAPTAIN" ||
//           membership.clan.captainId === userId,
//       },

//       count: data.length,
//       events: data,
//     });
//   } catch (error) {
//     console.error("GET_MY_CLAN_EVENTS_ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch clan events",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | GET EVENT DETAIL
//  * |--------------------------------------------------------------------------
//  * | GET /api/clan-events/:eventId
//  * |--------------------------------------------------------------------------
//  */
// export const getClanEventDetail = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { eventId } = req.params;

//     const event = await prisma.clanEvent.findUnique({
//       where: {
//         id: eventId,
//       },
//       include: {
//         clan: {
//           select: {
//             id: true,
//             name: true,
//             slug: true,
//             logo: true,
//             banner: true,
//             imageUrl: true,
//           },
//         },
//         createdBy: {
//           select: {
//             id: true,
//             username: true,
//             fullName: true,
//           },
//         },
//         participants: {
//           include: {
//             user: {
//               select: {
//                 id: true,
//                 username: true,
//                 fullName: true,
//               },
//             },
//           },
//           orderBy: {
//             joinedAt: "asc",
//           },
//         },
//       },
//     });

//     if (!event) {
//       return res.status(404).json({
//         success: false,
//         message: "Event not found",
//       });
//     }

//     const membership = await prisma.clanMember.findUnique({
//       where: {
//         clanId_userId: {
//           clanId: event.clanId,
//           userId,
//         },
//       },
//     });

//     if (!membership) {
//       return res.status(403).json({
//         success: false,
//         message: "Only clan members can view this event",
//       });
//     }

//     const isParticipating = event.participants.some(
//       (participant) => participant.userId === userId,
//     );

//     return res.status(200).json({
//       success: true,
//       data: {
//         ...event,
//         participantsCount: event.participants.length,
//         isParticipating,
//         currentUserRole: membership.role,
//       },
//     });
//   } catch (error) {
//     console.error("GET_CLAN_EVENT_DETAIL_ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch event detail",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };

// /**
//  * |--------------------------------------------------------------------------
//  * | CANCEL CLAN EVENT
//  * |--------------------------------------------------------------------------
//  * | PATCH /api/clan-events/:eventId/cancel
//  * |--------------------------------------------------------------------------
//  */
// export const cancelClanEvent = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { eventId } = req.params;

//     const event = await prisma.clanEvent.findUnique({
//       where: {
//         id: eventId,
//       },
//     });

//     if (!event) {
//       return res.status(404).json({
//         success: false,
//         message: "Event not found",
//       });
//     }

//     const access = await checkClanLeaderAccess(userId);

//     if (!access.allowed) {
//       return res.status(access.status).json({
//         success: false,
//         message: access.message,
//       });
//     }

//     if (access.membership.clanId !== event.clanId) {
//       return res.status(403).json({
//         success: false,
//         message: "This event does not belong to your clan",
//       });
//     }

//     if (event.status === "CANCELLED") {
//       return res.status(400).json({
//         success: false,
//         message: "Event is already cancelled",
//       });
//     }

//     if (event.status === "COMPLETED") {
//       return res.status(400).json({
//         success: false,
//         message: "A completed event cannot be cancelled",
//       });
//     }

//     const updatedEvent = await prisma.clanEvent.update({
//       where: {
//         id: eventId,
//       },
//       data: {
//         status: "CANCELLED",
//       },
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Clan event cancelled successfully",
//       data: updatedEvent,
//     });
//   } catch (error) {
//     console.error("CANCEL_CLAN_EVENT_ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to cancel clan event",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };

// export const deleteClanEvent = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { eventId } = req.params;

//     if (!eventId) {
//       return res.status(400).json({
//         success: false,
//         message: "Event ID is required",
//       });
//     }

//     const event = await prisma.clanEvent.findUnique({
//       where: {
//         id: eventId,
//       },
//       select: {
//         id: true,
//         clanId: true,
//         title: true,
//         status: true,
//       },
//     });

//     if (!event) {
//       return res.status(404).json({
//         success: false,
//         message: "Event not found",
//       });
//     }

//     const access = await checkClanLeaderAccess(userId);

//     if (!access.allowed) {
//       return res.status(access.status).json({
//         success: false,
//         message: access.message,
//       });
//     }

//     if (access.membership.clanId !== event.clanId) {
//       return res.status(403).json({
//         success: false,
//         message: "This event does not belong to your clan",
//       });
//     }

//     await prisma.$transaction([
//       prisma.clanEventParticipant.deleteMany({
//         where: {
//           eventId,
//         },
//       }),

//       prisma.clanEvent.delete({
//         where: {
//           id: eventId,
//         },
//       }),
//     ]);

//     return res.status(200).json({
//       success: true,
//       message: "Club event deleted successfully",
//       data: {
//         eventId: event.id,
//         title: event.title,
//       },
//     });
//   } catch (error) {
//     console.error("DELETE_CLAN_EVENT_ERROR:", error);

//     if (error?.code === "P2025") {
//       return res.status(404).json({
//         success: false,
//         message: "Event not found or already deleted",
//       });
//     }

//     if (error?.code === "P2003") {
//       return res.status(409).json({
//         success: false,
//         message: "The event has related records that prevent deletion",
//       });
//     }

//     return res.status(500).json({
//       success: false,
//       message: "Failed to delete clan event",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };

// modules/clan-event/clan-event.controller.js

import prisma from "../../config/prisma.js";

import { sendClanEventInvitations } from "./clanEventEmail.service.js";

import { sendFCMToUser } from "../../config/fcm.service.js";

/**
 * |--------------------------------------------------------------------------
 * | GET CURRENT USER'S CLAN MEMBERSHIP
 * |--------------------------------------------------------------------------
 */

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

  const [membership, participant] = await Promise.all([
    prisma.clanMember.findUnique({
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
    }),

    prisma.clanEventParticipant.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    }),
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

  return data;
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

    activityId: participant.activityId ?? null,

    clientActivityId: participant.clientActivityId ?? null,

    isFinalized: participant.status === "FINALIZED",
  }));

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

    const { title, description, location, startsAt, endsAt, maxParticipants } =
      req.body;

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

    const startDate = new Date(startsAt);

    const endDate = new Date(endsAt);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid event date",
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

    const access = await checkClanLeaderAccess(userId);

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const clanId = access.membership.clanId;

    const runLeaderId = await resolveClanRunLeaderId(clanId);

    if (!runLeaderId) {
      return res.status(409).json({
        success: false,
        message: "This clan does not currently have a valid event leader",
      });
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

    const clanMembers = await prisma.clanMember.findMany({
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

            title: `New Event in ${event.clan.name}`,

            message: event.location
              ? `${event.title} • ${event.location}`
              : event.title,

            data: {
              type: "CLAN_EVENT_CREATED",

              eventId: event.id,

              clanId: event.clan.id,

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

      message: "Clan event created successfully",

      invitationMessage:
        emailResult.sent > 0
          ? `Invitations sent to ${emailResult.sent} clan members`
          : "Event created successfully, but no email invitations were sent",

      notificationMessage:
        notificationResult.sent > 0
          ? `Notifications sent to ${notificationResult.sent} clan members`
          : "No push notifications were sent",

      data: {
        ...event,

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

      message: "Failed to create clan event",

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

        message: "You cannot join after the Club Event run has started",
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

        message: "The Club Event leader cannot leave this event",
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

/**
 * |--------------------------------------------------------------------------
 * | GET CURRENT USER'S CLAN EVENTS
 * |--------------------------------------------------------------------------
 */

export const getMyClanEvents = async (req, res) => {
  try {
    const userId = req.user.id;

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

      clanId: event.clanId,

      title: event.title,

      description: event.description,

      location: event.location,

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

    const membership = await prisma.clanMember.findUnique({
      where: {
        clanId_userId: {
          clanId: event.clanId,

          userId,
        },
      },
    });

    // if (!membership) {
    //   return res.status(403).json({
    //     success: false,

    //     message: "Only clan members can view this event",
    //   });
    // }

    const participant = event.participants.find(
      (item) => item.userId === userId,
    );

    return res.status(200).json({
      success: true,

      data: {
        ...event,

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
      event.runLeaderId ?? (await resolveClanRunLeaderId(event.clanId));

    if (!resolvedRunLeaderId) {
      return res.status(409).json({
        success: false,
        message: "This clan does not currently have a valid event run leader",
      });
    }

    const currentUserIsRunLeader = resolvedRunLeaderId === userId;

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

    if (
      ["STOPPED", "CUTOFF_PENDING", "FINALIZED"].includes(participant.status)
    ) {
      return res.status(409).json({
        success: false,

        message: "This participant's Club Event activity cannot be restarted",
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

    const [updatedEvent, updatedParticipant] = await prisma.$transaction([
      prisma.clanEvent.update({
        where: {
          id: eventId,
        },

        data: {
          status: "ACTIVE",

          runStartedAt: event.runStartedAt ?? now,

          runLeaderId: event.runLeaderId ?? resolvedRunLeaderId,
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
      event.runLeaderId ?? (await resolveClanRunLeaderId(event.clanId));

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
      event.runLeaderId ?? (await resolveClanRunLeaderId(event.clanId));

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

    const stats = parseEventStats(req.body, {
      partial: false,
    });

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
      event.runLeaderId ?? (await resolveClanRunLeaderId(event.clanId));

    const currentUserIsRunLeader = runLeaderId === userId;

    return res.status(200).json({
      success: true,

      serverNow: new Date(),

      event: {
        id: event.id,

        title: event.title,

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

    const [membership, participant] = await Promise.all([
      prisma.clanMember.findUnique({
        where: {
          clanId_userId: {
            clanId: event.clanId,
            userId,
          },
        },
      }),

      prisma.clanEventParticipant.findUnique({
        where: {
          eventId_userId: {
            eventId,
            userId,
          },
        },
      }),
    ]);

    if (!membership && !participant) {
      return res.status(403).json({
        success: false,
        message: "You must participate in this event to view its results",
      });
    }

    const snapshot = await buildEventResultsSnapshot(eventId);

    const myResult =
      snapshot.results.find((item) => item.userId === userId) ?? null;

    const isRunLeader = event.runLeaderId === userId;

    /**
     * Get the official Club Event leader's result.
     */
    const leaderResult = event.runLeaderId
      ? (snapshot.results.find((item) => item.userId === event.runLeaderId) ??
        null)
      : null;

    /**
     * Find the leader's actual normal Activity.
     *
     * The normal Activity contains routeEncoded,
     * while ClanEventParticipant only contains the event stats.
     */
    let leaderActivity = null;

    /**
     * First try using the already linked activityId.
     */
    if (event.runLeaderId && leaderResult?.activityId) {
      leaderActivity = await prisma.activity.findFirst({
        where: {
          id: leaderResult.activityId,
          userId: event.runLeaderId,
        },

        select: {
          id: true,
          routeEncoded: true,
          startedAt: true,
          endedAt: true,
        },
      });
    }

    /**
     * Fallback:
     *
     * Sometimes the Club Event participant has not yet
     * received activityId, but it already has clientActivityId.
     *
     * In that case use clientActivityId to locate the
     * normal Activity.
     */
    if (
      !leaderActivity &&
      event.runLeaderId &&
      leaderResult?.clientActivityId
    ) {
      leaderActivity = await prisma.activity.findFirst({
        where: {
          userId: event.runLeaderId,

          clientActivityId: leaderResult.clientActivityId,
        },

        orderBy: {
          startedAt: "desc",
        },

        select: {
          id: true,
          routeEncoded: true,
          startedAt: true,
          endedAt: true,
        },
      });
    }

    return res.status(200).json({
      success: true,

      event: {
        id: event.id,

        title: event.title,

        status: event.status,

        startsAt: event.startsAt,

        endsAt: event.endsAt,

        runStartedAt: event.runStartedAt,

        leaderStoppedAt: event.leaderStoppedAt,

        completedAt: event.completedAt,

        runLeader: event.runLeader,

        joinedParticipants: event._count.participants,
      },

      isRunLeader,
      /**
       * Official Club Event leader activity.
       */
      leaderActivity,

      /**
       * Direct route field for Flutter.
       */
      leaderRouteEncoded: leaderActivity?.routeEncoded ?? null,

      /**
       * Used for leader's combined Event Summary.
       */
      totals: snapshot.totals,

      startedParticipants: snapshot.startedParticipants,

      finalizedParticipants: snapshot.finalizedParticipants,

      pendingFinalizations: snapshot.pendingFinalizations,

      resultsFinal:
        Boolean(event.leaderStoppedAt) && snapshot.pendingFinalizations === 0,

      /**
       * Used for runner/captain personal event summary.
       */
      myResult,

      /**
       * Full event leaderboard.
       */
      leaderboard: snapshot.results,
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

    const access = await checkClanLeaderAccess(userId);

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    // =========================================================
    // MAKE SURE EVENT BELONGS TO USER'S CLAN
    // =========================================================

    if (access.membership.clanId !== event.clanId) {
      return res.status(403).json({
        success: false,
        message: "This event does not belong to your clan",
      });
    }

    // =========================================================
    // ALREADY CANCELLED
    // =========================================================

    if (event.status === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "Event is already cancelled",
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

    const access = await checkClanLeaderAccess(userId);

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    // =========================================================
    // MAKE SURE EVENT BELONGS TO THEIR CLAN
    // =========================================================

    if (access.membership.clanId !== event.clanId) {
      return res.status(403).json({
        success: false,
        message: "This event does not belong to your clan",
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

    const { title, description, location, startsAt, endsAt, maxParticipants } =
      req.body;

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
        message: "Invalid event date",
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

    const access = await checkClanLeaderAccess(userId);

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,

        message: access.message,
      });
    }

    if (access.membership.clanId !== event.clanId) {
      return res.status(403).json({
        success: false,

        message: "This event does not belong to your clan",
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
    const now = new Date();

    const membership = await getUserClanMembership(userId);

    const events = await prisma.clanEvent.findMany({
      where: {
        status: {
          notIn: ["CANCELLED", "COMPLETED"],
        },

        leaderStoppedAt: null,

        /**
         * Keep scheduled events visible until their scheduled end.
         * ACTIVE is included explicitly in case a live event runs
         * beyond its scheduled end time.
         */
        OR: [
          {
            endsAt: {
              gt: now,
            },
          },
          {
            status: "ACTIVE",
          },
        ],
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

        clanId: event.clanId,

        title: event.title,

        description: event.description,

        location: event.location,

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
