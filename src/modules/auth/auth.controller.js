import prisma from '../../config/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import validator from 'validator';
import { JWT_SECRET } from '../../config/jwt.js';


import { OAuth2Client } from "google-auth-library";
import appleSignin from "apple-signin-auth";


// ─────────────────────────────────────────────
// Generate Unique Username
// ─────────────────────────────────────────────
async function generateUsername(fullName) {
  let base = fullName?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  let username = base;
  let count = 1;

  while (true) {
    const exists = await prisma.user.findUnique({ where: { username } });
    if (!exists) return username;
    username = `${base}${count}`;
    count++;
  }
}


// const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const googleClient = new OAuth2Client();

const allowedGoogleClientIds = [
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
  process.env.GOOGLE_WEB_CLIENT_ID,
].filter(Boolean);

function generateJwt(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}


// ─────────────────────────────────────────────
// Register
// POST /api/auth/register
// ─────────────────────────────────────────────
export const register = async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ success: false, message: 'Email, password and full name are required' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const existingEmail = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existingEmail) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const username = await generateUsername(full_name);
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), password: hashedPassword, fullName: full_name, username },
    });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    const { password: _, ...safeUser } = user;

    return res.status(201).json({ success: true, message: 'Account created successfully', token, user: safeUser });

  } catch (error) {
    console.error('REGISTER ERROR:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};


// ─────────────────────────────────────────────
// Login
// POST /api/auth/login
// ─────────────────────────────────────────────
export const login = async (req, res) => {
  try {
    const { email, password, fcmToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    let updatedUser = user;

    // Save FCM token after successful login
    if (fcmToken && fcmToken.trim() !== "") {
      updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          fcmToken: fcmToken.trim(),
        },
      });
    }

    const token = jwt.sign(
      {
        id: updatedUser.id,
        email: updatedUser.email,
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    const { password: _, ...safeUser } = updatedUser;

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Get Me
// GET /api/auth/user/me
// ─────────────────────────────────────────────
export const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.user.id,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const territoryStats = await prisma.territory.aggregate({
      where: {
        userId: req.user.id,
        activity: {
          includeInClan: false,
        },
      },
      _sum: {
        areaKm2: true,
      },
      _count: {
        id: true,
      },
    });

    const { password: _, ...safeUser } = user;

    return res.status(200).json({
      success: true,

      user: {
        ...safeUser,

        stats: {
          totalTerritories: territoryStats._count.id,
          totalAreaKm2: Number(
            territoryStats._sum.areaKm2 ?? 0
          ),
        },
      },
    });
  } catch (error) {
    console.error('GET_ME ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Update Profile
// PUT /api/auth/user/profile
// ─────────────────────────────────────────────
export const updateProfile = async (req, res) => {
  try {
    const { full_name, country, city } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(full_name !== undefined && { fullName: full_name }),
        ...(country !== undefined && { country }),
        ...(city !== undefined && { city }),
      },
    });

    const { password: _, ...safeUser } = updated;
    return res.status(200).json({ success: true, message: 'Profile updated', user: safeUser });

  } catch (error) {
    console.error('UPDATE_PROFILE ERROR:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};


// ─────────────────────────────────────────────
// Change Username
// PATCH /api/auth/user/username
// ─────────────────────────────────────────────
export const changeUsername = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) return res.status(400).json({ success: false, message: 'Username is required' });

    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (sanitized.length < 3) return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });

    const existing = await prisma.user.findUnique({ where: { username: sanitized } });
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ success: false, message: 'Username already taken' });
    }

    const updated = await prisma.user.update({ where: { id: req.user.id }, data: { username: sanitized } });
    const { password: _, ...safeUser } = updated;

    return res.status(200).json({ success: true, message: 'Username updated', user: safeUser });

  } catch (error) {
    console.error('CHANGE_USERNAME ERROR:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};



// ─────────────────────────────────────────────
// Get Users Who Are Not My Friends
// GET /api/auth/users/not-friends
// ─────────────────────────────────────────────
export const getUsersWhoAreNotMyFriends = async (req, res) => {
  try {
    const userId = req.user.id;

    const friendships = await prisma.friendship.findMany({
      where: { userId },
      select: { friendId: true },
    });

    const friendIds = friendships.map((f) => f.friendId);

    const pendingRequests = await prisma.friendRequest.findMany({
      where: {
        OR: [
          { senderId: userId, status: "PENDING" },
          { receiverId: userId, status: "PENDING" },
        ],
      },
      select: {
        id: true,
        senderId: true,
        receiverId: true,
        status: true,
      },
    });

    const pendingUserIds = pendingRequests.map((r) =>
      r.senderId === userId ? r.receiverId : r.senderId
    );

    const users = await prisma.user.findMany({
      where: {
        id: {
          notIn: [userId, ...friendIds],
        },
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        city: true,
        country: true,
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    });

    const result = users.map((u) => ({
      ...u,
      isPending: pendingUserIds.includes(u.id),
    }));

    return res.status(200).json({
      success: true,
      count: result.length,
      users: result,
    });
  } catch (error) {
    console.error("GET_NOT_FRIEND_USERS_ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};



// ─────────────────────────────────────────────
// Get User Detail By UserId + Leaderboard Rank
// GET /api/auth/user/:userId
// Rank is based on total activity distance
// ─────────────────────────────────────────────
export const getUserDetailById = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User id is required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        city: true,
        country: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // User total distance
    const userActivityStats = await prisma.activity.aggregate({
      where: { userId },
      _sum: {
        distanceKm: true,
      },
      _count: {
        id: true,
      },
    });

    const totalDistanceKm = Number(userActivityStats._sum.distanceKm || 0);

    // All users ranked by total distance
    const leaderboard = await prisma.activity.groupBy({
      by: ["userId"],
      _sum: {
        distanceKm: true,
      },
      orderBy: {
        _sum: {
          distanceKm: "desc",
        },
      },
    });

    const rankIndex = leaderboard.findIndex((item) => item.userId === userId);

    const rank = rankIndex === -1 ? null : rankIndex + 1;

    return res.status(200).json({
      success: true,
      user: {
        ...user,
        stats: {
          totalDistanceKm,
          totalActivities: userActivityStats._count.id,
          leaderboardRank: rank,
        },
      },
    });
  } catch (error) {
    console.error("GET_USER_DETAIL_BY_ID_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};



export const googleAuth = async (req, res) => {
  try {
    const { idToken, fcmToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Google idToken is required",
      });
    }

    if (allowedGoogleClientIds.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Google client IDs are not configured",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: allowedGoogleClientIds,
    });

    const payload = ticket.getPayload();

    const googleId = payload.sub;
    const email = payload.email?.toLowerCase();
    const fullName = payload.name || "Google User";

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Google account email not found",
      });
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleId }, { email }],
      },
    });

    if (!user) {
      const username = await generateUsername(fullName);

      user = await prisma.user.create({
        data: {
          email,
          fullName,
          username,
          googleId,
          authProvider: "GOOGLE",
          fcmToken: fcmToken?.trim() || null,
        },
      });
    } else {
      const updateData = {};

      if (!user.googleId) {
        updateData.googleId = googleId;
        updateData.authProvider = "GOOGLE";
      }

      if (fcmToken?.trim()) {
        updateData.fcmToken = fcmToken.trim();
      }

      if (Object.keys(updateData).length > 0) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }
    }

    const token = generateJwt(user);
    const { password, ...safeUser } = user;

    return res.status(200).json({
      success: true,
      message: "Google login successful",
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("GOOGLE_AUTH_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Google authentication failed",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


export const appleAuth = async (req, res) => {
  try {
    const { identityToken, fullName, fcmToken } = req.body;

    if (!identityToken) {
      return res.status(400).json({
        success: false,
        message: "Apple identityToken is required",
      });
    }

    const appleUser = await appleSignin.verifyIdToken(identityToken, {
      audience: process.env.APPLE_CLIENT_ID,
      ignoreExpiration: false,
    });

    const appleId = appleUser.sub;
    const email = appleUser.email?.toLowerCase();

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ appleId }, ...(email ? [{ email }] : [])],
      },
    });

    if (!user) {
      const name = fullName || "Apple User";
      const username = await generateUsername(name);

      user = await prisma.user.create({
        data: {
          email: email || `${appleId}@apple.private`,
          fullName: name,
          username,
          appleId,
          authProvider: "APPLE",
          fcmToken: fcmToken?.trim() || null,
        },
      });
    } else {
      const updateData = {};

      if (!user.appleId) {
        updateData.appleId = appleId;
        updateData.authProvider = "APPLE";
      }

      if (fcmToken?.trim()) {
        updateData.fcmToken = fcmToken.trim();
      }

      if (Object.keys(updateData).length > 0) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }
    }

    const token = generateJwt(user);
    const { password, ...safeUser } = user;

    return res.status(200).json({
      success: true,
      message: "Apple login successful",
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("APPLE_AUTH_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Apple authentication failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

