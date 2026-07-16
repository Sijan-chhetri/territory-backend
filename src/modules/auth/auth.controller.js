import prisma from '../../config/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import validator from 'validator';
import { JWT_SECRET } from '../../config/jwt.js';


import { OAuth2Client } from "google-auth-library";
import appleSignin from "apple-signin-auth";

import crypto from "crypto";
import emailTransporter from "../../config/emailTransporter.js";

import {
  passwordResetOtpTemplate,
} from "../../config/templates/passwordResetOtp.template.js";


// helper for OTP

const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

const generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

const hashOtp = (otp) => {
  return crypto
    .createHash("sha256")
    .update(String(otp))
    .digest("hex");
};

const sendPasswordResetOtpEmail = async ({
  user,
  otp,
}) => {
  console.log("SENDING_PASSWORD_RESET_OTP:", {
    email: user.email,
    otp,
    gmailUser: process.env.GMAIL_USER,
    hasAppPassword: Boolean(
      process.env.GMAIL_APP_PASSWORD
    ),
  });

  const template = passwordResetOtpTemplate({
    fullName:
      user.fullName ||
      user.username ||
      "Duro Athlete",
    otp,
  });

  const info = await emailTransporter.sendMail({
    from: {
      name: "Duro",
      address: process.env.GMAIL_USER,
    },

    to: user.email,
    subject: template.subject,
    text: template.text,
    html: template.html,

    replyTo:
      process.env.DURO_SUPPORT_EMAIL ||
      process.env.GMAIL_USER,
  });

  console.log("PASSWORD_RESET_EMAIL_SENT:", {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  });

  return info;
};


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
    const { full_name, country, city, weight } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(full_name !== undefined && { fullName: full_name }),
        ...(country !== undefined && { country }),
        ...(city !== undefined && { city }),
        ...(weight !== undefined && { weight }),
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
// export const getUserDetailById = async (req, res) => {
//   try {
//     const { userId } = req.params;

//     if (!userId) {
//       return res.status(400).json({
//         success: false,
//         message: "User id is required",
//       });
//     }

//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       select: {
//         id: true,
//         username: true,
//         fullName: true,
//         email: true,
//         city: true,
//         country: true,
//         createdAt: true,
//       },
//     });

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: "User not found",
//       });
//     }

//     // User total distance
//     const userActivityStats = await prisma.activity.aggregate({
//       where: { userId },
//       _sum: {
//         distanceKm: true,
//       },
//       _count: {
//         id: true,
//       },
//     });

//     const totalDistanceKm = Number(userActivityStats._sum.distanceKm || 0);

//     // All users ranked by total distance
//     const leaderboard = await prisma.activity.groupBy({
//       by: ["userId"],
//       _sum: {
//         distanceKm: true,
//       },
//       orderBy: {
//         _sum: {
//           distanceKm: "desc",
//         },
//       },
//     });

//     const rankIndex = leaderboard.findIndex((item) => item.userId === userId);

//     const rank = rankIndex === -1 ? null : rankIndex + 1;

//     return res.status(200).json({
//       success: true,
//       user: {
//         ...user,
//         stats: {
//           totalDistanceKm,
//           totalActivities: userActivityStats._count.id,
//           leaderboardRank: rank,
//         },
//       },
//     });
//   } catch (error) {
//     console.error("GET_USER_DETAIL_BY_ID_ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong",
//       error:
//         process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };


// ─────────────────────────────────────────────
// Get User Detail By UserId + Leaderboard Rank
// GET /api/auth/user/:userId
// Rank is based on total activity distance
// Level and XP come from user_progress
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
      where: {
        id: userId,
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        city: true,
        country: true,
        createdAt: true,

        // Get stored level and XP from user_progress
        progress: {
          select: {
            totalXp: true,
            level: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // User total distance and total activities
    const userActivityStats = await prisma.activity.aggregate({
      where: {
        userId,
      },
      _sum: {
        distanceKm: true,
      },
      _count: {
        id: true,
      },
    });

    const totalDistanceKm = Number(
      userActivityStats._sum.distanceKm ?? 0
    );

    const totalActivities = Number(
      userActivityStats._count.id ?? 0
    );

    // All users ranked by total activity distance
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

    const rankIndex = leaderboard.findIndex(
      (item) => item.userId === userId
    );

    const leaderboardRank =
      rankIndex === -1 ? null : rankIndex + 1;

    // Remove nested progress object from the user response
    const { progress, ...userData } = user;

    return res.status(200).json({
      success: true,
      user: {
        ...userData,

        stats: {
          totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
          totalActivities,
          leaderboardRank,

          // Same format as your area leaderboard
          totalXp: Number(progress?.totalXp ?? 0),
          level: Number(progress?.level ?? 0),
        },
      },
    });
  } catch (error) {
    console.error("GET_USER_DETAIL_BY_ID_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
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

    if (!payload?.sub) {
      return res.status(400).json({
        success: false,
        message: "Invalid Google account information",
      });
    }

    const googleId = payload.sub;
    const email = payload.email?.toLowerCase().trim();
    const fullName = payload.name?.trim() || "Google User";

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Google account email not found",
      });
    }

    /**
     * |--------------------------------------------------------------------------
     * | CHECK EXISTING GOOGLE ACCOUNT
     * |--------------------------------------------------------------------------
     */

    let user = await prisma.user.findUnique({
      where: {
        googleId,
      },
    });

    if (user) {
      const updateData = {};

      if (fcmToken?.trim()) {
        updateData.fcmToken = fcmToken.trim();
      }

      if (Object.keys(updateData).length > 0) {
        user = await prisma.user.update({
          where: {
            id: user.id,
          },
          data: updateData,
        });
      }

      const token = generateJwt(user);
      const { password, ...safeUser } = user;

      return res.status(200).json({
        success: true,
        message: "Google login successful",
        token,
        user: safeUser,
      });
    }

    /**
     * |--------------------------------------------------------------------------
     * | CHECK IF EMAIL IS ALREADY REGISTERED
     * |--------------------------------------------------------------------------
     *
     * Do not automatically connect an existing email/password account
     * to Google.
     */

    const existingEmailUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingEmailUser) {
      return res.status(409).json({
        success: false,
        code: "EMAIL_ALREADY_EXISTS",
        message:
          "An account with this email already exists. Please log in using your email and password.",
        loginMethod: existingEmailUser.authProvider,
      });
    }

    /**
     * |--------------------------------------------------------------------------
     * | CREATE NEW GOOGLE USER
     * |--------------------------------------------------------------------------
     */

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

    const token = generateJwt(user);
    const { password, ...safeUser } = user;

    return res.status(201).json({
      success: true,
      message: "Google account created successfully",
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("GOOGLE_AUTH_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Google authentication failed",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
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



// ─────────────────────────────────────────────
// Check User Setup Status
// GET /api/auth/user/setup-status
// Returns true if weight, country, or city is missing
// ─────────────────────────────────────────────
export const checkUserSetupStatus = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        weight: true,
        country: true,
        city: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isMissing =
      user.weight === null ||
      user.weight === undefined ||
      !user.country ||
      user.country.trim() === "" ||
      !user.city ||
      user.city.trim() === "";

    return res.status(200).json({
      success: true,
      isSetupRequired: isMissing,
    });
  } catch (error) {
    console.error("CHECK_USER_SETUP_STATUS_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Setup User Weight, Country, City
// PUT /api/auth/user/setup
// ─────────────────────────────────────────────
export const setupUserInfo = async (req, res) => {
  try {
    const { weight, country, city } = req.body;

    if (weight === undefined || weight === null || country === undefined || city === undefined) {
      return res.status(400).json({
        success: false,
        message: "Weight, country, and city are required",
      });
    }

    const parsedWeight = Number(weight);

    if (Number.isNaN(parsedWeight) || parsedWeight <= 0) {
      return res.status(400).json({
        success: false,
        message: "Weight must be a valid number greater than 0",
      });
    }

    if (!country || country.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Country is required",
      });
    }

    if (!city || city.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "City is required",
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        weight: parsedWeight,
        country: country.trim(),
        city: city.trim(),
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        weight: true,
        country: true,
        city: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "User setup completed successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("SETUP_USER_INFO_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Get User Weight Only
// GET /api/auth/user/weight
// ─────────────────────────────────────────────
export const getUserWeight = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        weight: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      weight: user.weight,
    });
  } catch (error) {
    console.error("GET_USER_WEIGHT_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


/**
 * |--------------------------------------------------------------------------
 * | REQUEST PASSWORD RESET OTP
 * |--------------------------------------------------------------------------
 * | POST /api/auth/forgot-password/request-otp
 * |--------------------------------------------------------------------------
 */
export const requestPasswordResetOtp = async (req, res) => {
  try {
    const normalizedEmail = req.body.email
      ?.toLowerCase()
      .trim();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        password: true,
        authProvider: true,
      },
    });

    /*
     * Generic response avoids revealing whether an email exists.
     */
    if (!user) {
      return res.status(200).json({
        success: true,
        message:
          "If an account exists with this email, a password reset code has been sent.",
      });
    }

    if (!user.password) {
      return res.status(400).json({
        success: false,
        code: "SOCIAL_LOGIN_ACCOUNT",
        message:
          user.authProvider === "GOOGLE"
            ? "This account uses Google login. Please continue with Google."
            : "This account uses social login. Please use the original login method.",
        loginMethod: user.authProvider,
      });
    }

    const latestOtp =
      await prisma.passwordResetOtp.findFirst({
        where: {
          userId: user.id,
          isUsed: false,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    if (latestOtp) {
      const cooldownEndsAt = new Date(
        latestOtp.createdAt.getTime() +
          OTP_RESEND_COOLDOWN_SECONDS * 1000
      );

      if (new Date() < cooldownEndsAt) {
        const retryAfterSeconds = Math.ceil(
          (cooldownEndsAt.getTime() - Date.now()) / 1000
        );

        return res.status(429).json({
          success: false,
          code: "OTP_RESEND_COOLDOWN",
          message: `Please wait ${retryAfterSeconds} seconds before requesting another code.`,
          retryAfterSeconds,
        });
      }
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);

    const expiresAt = new Date(
      Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
    );

    /*
     * Invalidate previous unused OTPs.
     */
    await prisma.passwordResetOtp.updateMany({
      where: {
        userId: user.id,
        isUsed: false,
      },
      data: {
        isUsed: true,
      },
    });

    const otpRecord =
      await prisma.passwordResetOtp.create({
        data: {
          userId: user.id,
          email: user.email,
          otpHash,
          attempts: 0,
          maxAttempts: OTP_MAX_ATTEMPTS,
          expiresAt,
          isVerified: false,
          isUsed: false,
        },
      });

    try {
      await sendPasswordResetOtpEmail({
        user,
        otp,
      });
    } catch (emailError) {
      console.error(
        "PASSWORD_RESET_OTP_EMAIL_ERROR:",
        emailError
      );

      await prisma.passwordResetOtp.update({
        where: {
          id: otpRecord.id,
        },
        data: {
          isUsed: true,
        },
      });

      return res.status(500).json({
        success: false,
        message: "Failed to send password reset code",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Password reset code sent successfully",
      expiresInSeconds: OTP_EXPIRY_MINUTES * 60,
      maxAttempts: OTP_MAX_ATTEMPTS,
      resendAvailableInSeconds:
        OTP_RESEND_COOLDOWN_SECONDS,
    });
  } catch (error) {
    console.error(
      "REQUEST_PASSWORD_RESET_OTP_ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to request password reset code",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | RESEND PASSWORD RESET OTP
 * |--------------------------------------------------------------------------
 * | POST /api/auth/forgot-password/resend-otp
 * |--------------------------------------------------------------------------
 */
export const resendPasswordResetOtp = async (req, res) => {
  try {
    const normalizedEmail = req.body.email
      ?.toLowerCase()
      .trim();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        password: true,
        authProvider: true,
      },
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message:
          "If an account exists with this email, a new code has been sent.",
      });
    }

    if (!user.password) {
      return res.status(400).json({
        success: false,
        code: "SOCIAL_LOGIN_ACCOUNT",
        message:
          "This account does not use an email password. Please use the original login method.",
        loginMethod: user.authProvider,
      });
    }

    const latestOtp =
      await prisma.passwordResetOtp.findFirst({
        where: {
          userId: user.id,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    if (latestOtp) {
      const cooldownEndsAt = new Date(
        latestOtp.createdAt.getTime() +
          OTP_RESEND_COOLDOWN_SECONDS * 1000
      );

      if (new Date() < cooldownEndsAt) {
        const retryAfterSeconds = Math.ceil(
          (cooldownEndsAt.getTime() - Date.now()) / 1000
        );

        return res.status(429).json({
          success: false,
          code: "OTP_RESEND_COOLDOWN",
          message: `Please wait ${retryAfterSeconds} seconds before resending the code.`,
          retryAfterSeconds,
        });
      }
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);

    const expiresAt = new Date(
      Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
    );

    await prisma.passwordResetOtp.updateMany({
      where: {
        userId: user.id,
        isUsed: false,
      },
      data: {
        isUsed: true,
      },
    });

    const newOtpRecord =
      await prisma.passwordResetOtp.create({
        data: {
          userId: user.id,
          email: user.email,
          otpHash,
          attempts: 0,
          maxAttempts: OTP_MAX_ATTEMPTS,
          expiresAt,
          isVerified: false,
          isUsed: false,
        },
      });

    try {
      await sendPasswordResetOtpEmail({
        user,
        otp,
      });
    } catch (emailError) {
      console.error(
        "RESEND_PASSWORD_RESET_OTP_EMAIL_ERROR:",
        emailError
      );

      await prisma.passwordResetOtp.update({
        where: {
          id: newOtpRecord.id,
        },
        data: {
          isUsed: true,
        },
      });

      return res.status(500).json({
        success: false,
        message: "Failed to resend password reset code",
      });
    }

    return res.status(200).json({
      success: true,
      message: "A new password reset code has been sent",
      expiresInSeconds: OTP_EXPIRY_MINUTES * 60,
      maxAttempts: OTP_MAX_ATTEMPTS,
      resendAvailableInSeconds:
        OTP_RESEND_COOLDOWN_SECONDS,
    });
  } catch (error) {
    console.error(
      "RESEND_PASSWORD_RESET_OTP_ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to resend password reset code",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};


/**
 * |--------------------------------------------------------------------------
 * | VERIFY PASSWORD RESET OTP
 * |--------------------------------------------------------------------------
 * | POST /api/auth/forgot-password/verify-otp
 * |--------------------------------------------------------------------------
 */
export const verifyPasswordResetOtp = async (req, res) => {
  try {
    const normalizedEmail = req.body.email
      ?.toLowerCase()
      .trim();

    const otp = String(req.body.otp || "").trim();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "OTP must be a 6-digit number",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    const otpRecord =
      await prisma.passwordResetOtp.findFirst({
        where: {
          userId: user.id,
          email: normalizedEmail,
          isUsed: false,
          isVerified: false,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        code: "OTP_NOT_FOUND",
        message:
          "No active password reset code was found. Please request a new code.",
      });
    }

    if (new Date() > otpRecord.expiresAt) {
      await prisma.passwordResetOtp.update({
        where: {
          id: otpRecord.id,
        },
        data: {
          isUsed: true,
        },
      });

      return res.status(400).json({
        success: false,
        code: "OTP_EXPIRED",
        message:
          "The password reset code has expired. Please request a new code.",
      });
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await prisma.passwordResetOtp.update({
        where: {
          id: otpRecord.id,
        },
        data: {
          isUsed: true,
        },
      });

      return res.status(429).json({
        success: false,
        code: "OTP_ATTEMPTS_EXCEEDED",
        message:
          "Maximum verification attempts exceeded. Please request a new code.",
      });
    }

    const providedOtpHash = hashOtp(otp);
    const isOtpCorrect =
      providedOtpHash === otpRecord.otpHash;

    if (!isOtpCorrect) {
      const newAttempts = otpRecord.attempts + 1;
      const attemptsRemaining = Math.max(
        otpRecord.maxAttempts - newAttempts,
        0
      );

      await prisma.passwordResetOtp.update({
        where: {
          id: otpRecord.id,
        },
        data: {
          attempts: newAttempts,
          isUsed:
            newAttempts >= otpRecord.maxAttempts,
        },
      });

      return res.status(400).json({
        success: false,
        code:
          attemptsRemaining === 0
            ? "OTP_ATTEMPTS_EXCEEDED"
            : "INVALID_OTP",

        message:
          attemptsRemaining === 0
            ? "Maximum verification attempts exceeded. Please request a new code."
            : `Invalid OTP. You have ${attemptsRemaining} attempt${
                attemptsRemaining === 1 ? "" : "s"
              } remaining.`,

        attemptsRemaining,
      });
    }

    await prisma.passwordResetOtp.update({
      where: {
        id: otpRecord.id,
      },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
      },
    });

    const resetToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        otpId: otpRecord.id,
        purpose: "PASSWORD_RESET",
      },
      JWT_SECRET,
      {
        expiresIn: "10m",
      }
    );

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      resetToken,
      resetTokenExpiresInSeconds: 600,
    });
  } catch (error) {
    console.error(
      "VERIFY_PASSWORD_RESET_OTP_ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to verify password reset code",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

/**
 * |--------------------------------------------------------------------------
 * | RESET PASSWORD
 * |--------------------------------------------------------------------------
 * | POST /api/auth/forgot-password/reset
 * |--------------------------------------------------------------------------
 */
export const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } =
      req.body;

    if (!resetToken || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Reset token, new password and confirm password are required",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 6 characters",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch {
      return res.status(401).json({
        success: false,
        code: "INVALID_RESET_TOKEN",
        message:
          "The password reset session is invalid or expired",
      });
    }

    if (
      decoded.purpose !== "PASSWORD_RESET" ||
      !decoded.userId ||
      !decoded.otpId
    ) {
      return res.status(401).json({
        success: false,
        code: "INVALID_RESET_TOKEN",
        message: "Invalid password reset token",
      });
    }

    const otpRecord =
      await prisma.passwordResetOtp.findUnique({
        where: {
          id: decoded.otpId,
        },
      });

    if (
      !otpRecord ||
      otpRecord.userId !== decoded.userId ||
      !otpRecord.isVerified ||
      otpRecord.isUsed
    ) {
      return res.status(401).json({
        success: false,
        code: "RESET_SESSION_NOT_VALID",
        message:
          "This password reset session is no longer valid",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.userId,
      },
      select: {
        id: true,
        password: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isSamePassword = user.password
      ? await bcrypt.compare(
          newPassword,
          user.password
        )
      : false;

    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message:
          "Your new password must be different from your current password",
      });
    }

    const hashedPassword = await bcrypt.hash(
      newPassword,
      10
    );

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: decoded.userId,
        },
        data: {
          password: hashedPassword,
        },
      });

      await tx.passwordResetOtp.update({
        where: {
          id: otpRecord.id,
        },
        data: {
          isUsed: true,
        },
      });

      /*
       * Invalidate any remaining reset codes.
       */
      await tx.passwordResetOtp.updateMany({
        where: {
          userId: decoded.userId,
          isUsed: false,
        },
        data: {
          isUsed: true,
        },
      });
    });

    return res.status(200).json({
      success: true,
      message:
        "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("RESET_PASSWORD_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to reset password",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};