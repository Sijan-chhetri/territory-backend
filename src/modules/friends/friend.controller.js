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
      where: {
        id: requestId,
      },
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

    if (request.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Request already handled",
      });
    }

    // transaction
    await prisma.$transaction([
      prisma.friendRequest.update({
        where: {
          id: requestId,
        },
        data: {
          status: "ACCEPTED",
        },
      }),

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
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Friend request accepted",
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
 * REJECT FRIEND REQUEST
 * ============================================================================
 */

export const rejectFriendRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;

    const request = await prisma.friendRequest.findUnique({
      where: {
        id: requestId,
      },
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

    await prisma.friendRequest.update({
      where: {
        id: requestId,
      },
      data: {
        status: "REJECTED",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Friend request rejected",
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
 * SEARCH USER BY USERNAME
 * ============================================================================
 */

export const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const users = await prisma.user.findMany({
      where: {
        username: {
          contains: q,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        username: true,
        fullName: true,
      },
      take: 10,
    });

    if (users.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No users found",
        data: [],
      });
    }

    return res.status(200).json({
      success: true,
      data: users,
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