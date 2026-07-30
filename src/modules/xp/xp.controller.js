import prisma from '../../config/prisma.js';

/*
 * Use the same import paths currently used by your
 * activity controller for addXP and checkLevelUp.
 */
import { addXP } from './xp.service.js';
import { checkLevelUp } from '../level/level.service.js';


const REWARDED_AD_XP = 25;

/*
 * Your current Flutter HomeScreen allows 5 rewarded ads per day.
 * Change this to 3 if you want a maximum of 75 XP per day.
 */
const MAX_REWARDED_ADS_PER_DAY = 5;

/*
 * Nepal is UTC +05:45.
 *
 * This produces the beginning and ending of the current
 * Nepal calendar day as UTC Date objects for Prisma.
 */
const getNepalDayRange = () => {
  const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;
  const NEPAL_OFFSET_MS =
    NEPAL_OFFSET_MINUTES * 60 * 1000;

  const now = new Date();

  const nepalNow = new Date(
    now.getTime() + NEPAL_OFFSET_MS,
  );

  const startOfNepalDayAsUtc = Date.UTC(
    nepalNow.getUTCFullYear(),
    nepalNow.getUTCMonth(),
    nepalNow.getUTCDate(),
    0,
    0,
    0,
    0,
  );

  const start = new Date(
    startOfNepalDayAsUtc - NEPAL_OFFSET_MS,
  );

  const end = new Date(
    start.getTime() + 24 * 60 * 60 * 1000,
  );

  return {
    start,
    end,
  };
};

// ─────────────────────────────────────────────
// Grant Rewarded Ad XP
// POST /api/xp/rewarded-ad
// ─────────────────────────────────────────────
export const grantRewardedAdXp = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const { start, end } = getNepalDayRange();

    /*
     * Count only successful rewarded-ad XP transactions
     * created during the current Nepal calendar day.
     */
    const watchedToday =
      await prisma.xPTransaction.count({
        where: {
          userId,
          type: 'REWARDED_AD',
          amount: REWARDED_AD_XP,
          createdAt: {
            gte: start,
            lt: end,
          },
        },
      });

    if (
      watchedToday >= MAX_REWARDED_ADS_PER_DAY
    ) {
      return res.status(429).json({
        success: false,
        message:
          'You have already received all rewarded-ad XP for today',
        watchedToday,
        maximumAdsPerDay:
          MAX_REWARDED_ADS_PER_DAY,
      });
    }

    /*
     * addXP should:
     *
     * 1. Create the XPTransaction
     * 2. Increment UserProgress.currentXp
     * 3. Increment UserProgress.totalXp
     *
     * XP amount is controlled by the backend.
     * Never accept an XP amount from Flutter.
     */
    await addXP({
      userId,
      amount: REWARDED_AD_XP,
      type: 'REWARDED_AD',
      description: 'Completed a rewarded advertisement',
      activityId: null,
    });

    /*
     * Update:
     * - level
     * - currentXp after a level-up
     * - xpToNextLevel
     */
    const levelResult =
      await checkLevelUp(userId);

    const progress =
      await prisma.userProgress.findUnique({
        where: {
          userId,
        },
      });

    if (!progress) {
      return res.status(500).json({
        success: false,
        message:
          'XP was recorded, but user progress could not be loaded',
      });
    }

    return res.status(200).json({
      success: true,
      message: `+${REWARDED_AD_XP} XP added`,
      xpEarned: REWARDED_AD_XP,

      watchedToday: watchedToday + 1,
      maximumAdsPerDay:
        MAX_REWARDED_ADS_PER_DAY,

      progression: {
        leveledUp:
          levelResult?.leveledUp ?? false,

        level:
          levelResult?.level ??
          progress.level,

        currentXp:
          progress.currentXp,

        totalXp:
          progress.totalXp,

        xpToNextLevel:
          progress.xpToNextLevel,
      },
    });
  } catch (error) {
    console.error(
      'GRANT_REWARDED_AD_XP ERROR:',
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        'Could not add rewarded-ad XP',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined,
    });
  }
};

// ─────────────────────────────────────────────
// Get My XP Transactions
// GET /api/xp/transactions
// ─────────────────────────────────────────────
export const getMyTransactions = async (
  req,
  res,
) => {
  try {
    const transactions =
      await prisma.xPTransaction.findMany({
        where: {
          userId: req.user.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50,
      });

    return res.status(200).json({
      success: true,
      transactions,
    });
  } catch (error) {
    console.error(
      'GET_XP_TRANSACTIONS ERROR:',
      error,
    );

    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

// ─────────────────────────────────────────────
// Get My XP Summary
// GET /api/xp/summary
// ─────────────────────────────────────────────
export const getMyXpSummary = async (
  req,
  res,
) => {
  try {
    const progress =
      await prisma.userProgress.findUnique({
        where: {
          userId: req.user.id,
        },
      });

    if (!progress) {
      return res.status(404).json({
        success: false,
        message: 'No progress found',
      });
    }

    return res.status(200).json({
      success: true,
      xp: {
        currentXp:
          progress.currentXp,

        totalXp:
          progress.totalXp,

        xpToNextLevel:
          progress.xpToNextLevel,

        level:
          progress.level,
      },
    });
  } catch (error) {
    console.error(
      'GET_XP_SUMMARY ERROR:',
      error,
    );

    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};