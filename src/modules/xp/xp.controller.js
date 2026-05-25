import prisma from '../../config/prisma.js';

// ─────────────────────────────────────────────
// Get My XP Transactions
// GET /api/xp/transactions
// ─────────────────────────────────────────────
export const getMyTransactions = async (req, res) => {
  try {
    const transactions = await prisma.xPTransaction.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.status(200).json({ success: true, transactions });

  } catch (error) {
    console.error('GET_XP_TRANSACTIONS ERROR:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─────────────────────────────────────────────
// Get My XP Summary
// GET /api/xp/summary
// ─────────────────────────────────────────────
export const getMyXpSummary = async (req, res) => {
  try {
    const progress = await prisma.userProgress.findUnique({
      where: { userId: req.user.id },
    });

    if (!progress) {
      return res.status(404).json({ success: false, message: 'No progress found' });
    }

    return res.status(200).json({
      success: true,
      xp: {
        currentXp:    progress.currentXp,
        totalXp:      progress.totalXp,
        xpToNextLevel: progress.xpToNextLevel,
        level:        progress.level,
      },
    });

  } catch (error) {
    console.error('GET_XP_SUMMARY ERROR:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
