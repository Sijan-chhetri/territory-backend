// modules/clan-event/clan-event.controller.js

import prisma from "../../config/prisma.js";

import { sendClanEventInvitations } from "./clanEventEmail.service.js";



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
                    captainId: true,
                },
            },
        },
    });
};

/**
 * Check whether the user is allowed to manage a clan.
 * Supports both captainId and LEADER/CAPTAIN membership roles.
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
        membership.role === "LEADER" ||
        membership.role === "CAPTAIN";

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
 * | CREATE EVENT FOR CURRENT USER'S CLAN
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
    } = req.body;

    /**
     * |--------------------------------------------------------------------------
     * | VALIDATION
     * |--------------------------------------------------------------------------
     */

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

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
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

    /**
     * |--------------------------------------------------------------------------
     * | CHECK CLAN LEADER ACCESS
     * |--------------------------------------------------------------------------
     */

    const access = await checkClanLeaderAccess(userId);

    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const clanId = access.membership.clanId;

    /**
     * |--------------------------------------------------------------------------
     * | CREATE EVENT
     * |--------------------------------------------------------------------------
     */

    const event = await prisma.clanEvent.create({
      data: {
        clanId,
        createdById: userId,
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
     * |--------------------------------------------------------------------------
     * | FETCH ALL CLAN MEMBERS
     * |--------------------------------------------------------------------------
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
     * |--------------------------------------------------------------------------
     * | SEND EMAIL INVITATIONS
     * |--------------------------------------------------------------------------
     *
     * Email failure should not undo event creation.
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
      console.error(
        "CLAN_EVENT_INVITATION_EMAIL_ERROR:",
        emailError
      );
    }

    /**
     * |--------------------------------------------------------------------------
     * | RESPONSE
     * |--------------------------------------------------------------------------
     */

    return res.status(201).json({
      success: true,
      message: "Clan event created successfully",

      invitationMessage:
        emailResult.sent > 0
          ? `Invitations sent to ${emailResult.sent} clan members`
          : "Event created successfully, but no email invitations were sent",

      data: {
        ...event,

        participantsCount:
          event._count?.participants ?? 0,
      },

      emailInvitations: {
        totalClanMembers: clanMembers.length,
        attempted: emailResult.attempted,
        sent: emailResult.sent,
        failed: emailResult.failed,
      },
    });
  } catch (error) {
    console.error("CREATE_CLAN_EVENT_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create clan event",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | JOIN CLAN EVENT
 * |--------------------------------------------------------------------------
 * | POST /api/clan-events/:eventId/join
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

        if (new Date() >= event.endsAt) {
            return res.status(400).json({
                success: false,
                message: "This event has already ended",
            });
        }

        // Only a member of this specific clan can join
        const membership = await prisma.clanMember.findUnique({
            where: {
                clanId_userId: {
                    clanId: event.clanId,
                    userId,
                },
            },
        });

        if (!membership) {
            return res.status(403).json({
                success: false,
                message: "Only clan members can participate in this event",
            });
        }

        const existingParticipant =
            await prisma.clanEventParticipant.findUnique({
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

        const participant =
            await prisma.clanEventParticipant.create({
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
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
};

/**
 * |--------------------------------------------------------------------------
 * | LEAVE CLAN EVENT
 * |--------------------------------------------------------------------------
 * | DELETE /api/clan-events/:eventId/leave
 * |--------------------------------------------------------------------------
 */
export const leaveClanEvent = async (req, res) => {
    try {
        const userId = req.user.id;
        const { eventId } = req.params;

        const participant =
            await prisma.clanEventParticipant.findUnique({
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
            },
        });

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found",
            });
        }

        if (event.status === "ACTIVE") {
            return res.status(400).json({
                success: false,
                message: "You cannot leave an active event",
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
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
};

/**
 * |--------------------------------------------------------------------------
 * | GET CURRENT USER'S CLAN EVENTS
 * |--------------------------------------------------------------------------
 * | GET /api/clan-events
 * |--------------------------------------------------------------------------
 */
export const getMyClanEvents = async (req, res) => {
    try {
        const userId = req.user.id;

        const membership = await getUserClanMembership(userId);

        if (!membership) {
            return res.status(404).json({
                success: false,
                message: "You are not a member of any clan",
            });
        }

        const clanId = membership.clanId;

        const events = await prisma.clanEvent.findMany({
            where: {
                clanId,
            },
            include: {
                clan: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        logo: true,
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

            clan: event.clan,
            createdBy: event.createdBy,
            participants: event.participants,

            participantsCount: event._count.participants,

            isParticipating: event.participants.some(
                (participant) => participant.userId === userId
            ),

            availableSpots:
                event.maxParticipants === null
                    ? null
                    : Math.max(
                        event.maxParticipants -
                        event._count.participants,
                        0
                    ),
        }));

        return res.status(200).json({
            success: true,

            clan: {
                id: membership.clan.id,
                name: membership.clan.name,
                slug: membership.clan.slug,
                logo: membership.clan.logo,
                banner: membership.clan.banner,
            },

            currentUser: {
                role: membership.role,
                isLeader:
                    membership.role === "LEADER" ||
                    membership.role === "CAPTAIN" ||
                    membership.clan.captainId === userId,
            },

            count: data.length,
            events: data,
        });
    } catch (error) {
        console.error("GET_MY_CLAN_EVENTS_ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch clan events",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
};

/**
 * |--------------------------------------------------------------------------
 * | GET EVENT DETAIL
 * |--------------------------------------------------------------------------
 * | GET /api/clan-events/:eventId
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

        if (!membership) {
            return res.status(403).json({
                success: false,
                message: "Only clan members can view this event",
            });
        }

        const isParticipating = event.participants.some(
            (participant) => participant.userId === userId
        );

        return res.status(200).json({
            success: true,
            data: {
                ...event,
                participantsCount: event.participants.length,
                isParticipating,
                currentUserRole: membership.role,
            },
        });
    } catch (error) {
        console.error("GET_CLAN_EVENT_DETAIL_ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch event detail",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
};

/**
 * |--------------------------------------------------------------------------
 * | CANCEL CLAN EVENT
 * |--------------------------------------------------------------------------
 * | PATCH /api/clan-events/:eventId/cancel
 * |--------------------------------------------------------------------------
 */
export const cancelClanEvent = async (req, res) => {
    try {
        const userId = req.user.id;
        const { eventId } = req.params;

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

        if (event.status === "CANCELLED") {
            return res.status(400).json({
                success: false,
                message: "Event is already cancelled",
            });
        }

        if (event.status === "COMPLETED") {
            return res.status(400).json({
                success: false,
                message: "A completed event cannot be cancelled",
            });
        }

        const updatedEvent = await prisma.clanEvent.update({
            where: {
                id: eventId,
            },
            data: {
                status: "CANCELLED",
            },
        });

        return res.status(200).json({
            success: true,
            message: "Clan event cancelled successfully",
            data: updatedEvent,
        });
    } catch (error) {
        console.error("CANCEL_CLAN_EVENT_ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to cancel clan event",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
};