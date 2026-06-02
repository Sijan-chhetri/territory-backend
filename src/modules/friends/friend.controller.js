// controllers/friend.controller.js

import prisma from "../../config/prisma.js";

/**
 * ============================================================================
 * SEND FRIEND REQUEST
 * ============================================================================
 */

export const sendFriendRequest = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { username } = req.body;

    // find receiver
    const receiver = await prisma.user.findUnique({
      where: {
        username,
      },
    });

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // prevent self request
    if (receiver.id === senderId) {
      return res.status(400).json({
        success: false,
        message: "You cannot send request to yourself",
      });
    }

    // already friends?
    const existingFriend = await prisma.friendship.findFirst({
      where: {
        userId: senderId,
        friendId: receiver.id,
      },
    });

    if (existingFriend) {
      return res.status(400).json({
        success: false,
        message: "Already friends",
      });
    }

    // existing request?
    const existingRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          {
            senderId,
            receiverId: receiver.id,
          },
          {
            senderId: receiver.id,
            receiverId: senderId,
          },
        ],
        status: "PENDING",
      },
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: "Friend request already exists",
      });
    }

    // create request
    const friendRequest = await prisma.friendRequest.create({
      data: {
        senderId,
        receiverId: receiver.id,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Friend request sent",
      data: friendRequest,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * ============================================================================
 * GET ALL FRIEND REQUESTS
 * ============================================================================
 */
export const getFriendRequests = async (req, res) => {
  try {
    const userId = req.user.id;

    const requests = await prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // If no friend requests found
    if (requests.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No friend requests found",
        data: [],
      });
    }

    return res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * ============================================================================
 * GET ONLY PENDING REQUESTS
 * ============================================================================
 */

export const getPendingRequests = async (req, res) => {
  try {
    const userId = req.user.id;

    const requests = await prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
        status: "PENDING",
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * ============================================================================
 * ACCEPT FRIEND REQUEST
 * ============================================================================
 */

export const acceptFriendRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;

    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    if (request.receiverId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    await prisma.$transaction([
      prisma.friendship.createMany({
        data: [
          {
            userId: request.senderId,
            friendId: request.receiverId,
          },
          {
            userId: request.receiverId,
            friendId: request.senderId,
          },
        ],
        skipDuplicates: true,
      }),

      prisma.friendRequest.delete({
        where: { id: requestId },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Friend request accepted",
    });
  } catch (error) {
    console.error("ACCEPT_FRIEND_REQUEST_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * ============================================================================
 * REJECT FRIEND REQUEST
 * ============================================================================
 */

export const rejectFriendRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;

    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    if (request.receiverId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    await prisma.friendRequest.delete({
      where: { id: requestId },
    });

    return res.status(200).json({
      success: true,
      message: "Friend request rejected",
    });
  } catch (error) {
    console.error("REJECT_FRIEND_REQUEST_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * ============================================================================
 * SEARCH USER BY USERNAME
 * ============================================================================
 */

export const searchUsers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const users = await prisma.user.findMany({
      where: {
        id: {
          not: userId,
        },
        OR: [
          {
            username: {
              contains: q,
              mode: "insensitive",
            },
          },
          {
            fullName: {
              contains: q,
              mode: "insensitive",
            },
          },
        ],
      },
      select: {
        id: true,
        username: true,
        fullName: true,
      },
      take: 20,
    });

    const results = await Promise.all(
      users.map(async (user) => {
        const friendship = await prisma.friendship.findFirst({
          where: {
            userId,
            friendId: user.id,
          },
        });

        const sentRequest = await prisma.friendRequest.findFirst({
          where: {
            senderId: userId,
            receiverId: user.id,
            status: "PENDING",
          },
        });

        const receivedRequest = await prisma.friendRequest.findFirst({
          where: {
            senderId: user.id,
            receiverId: userId,
            status: "PENDING",
          },
        });

        return {
          ...user,

          isFriend: !!friendship,

          requestSent: !!sentRequest,
          sentRequestId: sentRequest?.id || null,

          requestReceived: !!receivedRequest,
          receivedRequestId: receivedRequest?.id || null,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error("SEARCH_USERS_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * ============================================================================
 * GET ALL FRIENDS
 * ============================================================================
 */

export const getFriends = async (req, res) => {
  try {
    const userId = req.user.id;

    const friends = await prisma.friendship.findMany({
      where: {
        userId,
      },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      data: friends,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * ============================================================================
 * REMOVE FRIEND
 * ============================================================================
 */

export const removeFriend = async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.params;

    await prisma.friendship.deleteMany({
      where: {
        OR: [
          {
            userId,
            friendId,
          },
          {
            userId: friendId,
            friendId: userId,
          },
        ],
      },
    });

    return res.status(200).json({
      success: true,
      message: "Friend removed",
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};


/**
 * ============================================================================
 * GET MY FRIENDS
 * ============================================================================
 */

export const getMyFriends = async (req, res) => {
  try {
    const userId = req.user.id;

    const friends = await prisma.friendship.findMany({
      where: {
        userId,
      },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
            fullName: true,
            // profileImage: true, 
            // xp: true,           
            // level: true,        
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      count: friends.length,
      friends: friends.map((item) => item.friend),
    });
  } catch (error) {
    console.error("GET_MY_FRIENDS_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
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



export const searchFriendsOnly = async (req, res) => {
  try {
    const userId = req.user.id;
    const { q } = req.query;

    if (!q?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const friends = await prisma.friendship.findMany({
      where: {
        userId,
        friend: {
          OR: [
            {
              username: {
                contains: q.trim(),
                mode: "insensitive",
              },
            },
            {
              fullName: {
                contains: q.trim(),
                mode: "insensitive",
              },
            },
          ],
        },
      },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
            fullName: true,
            // profileImage: true, // optional
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });

    return res.status(200).json({
      success: true,
      count: friends.length,
      data: friends.map((item) => item.friend),
    });
  } catch (error) {
    console.error("SEARCH_FRIENDS_ONLY_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};