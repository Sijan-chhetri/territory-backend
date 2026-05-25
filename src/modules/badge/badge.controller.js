import prisma from '../../config/prisma.js';

// ─────────────────────────────────────────────
// Get All Badges (catalog)
// GET /api/badges
// ─────────────────────────────────────────────
export const getAllBadges = async (req, res) => {
  try {
    const badges = await prisma.badge.findMany({
      orderBy: { requirementValue: 'asc' },
    });

    return res.status(200).json({ success: true, badges });

  } catch (error) {
    console.error('GET_ALL_BADGES ERROR:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─────────────────────────────────────────────
// Get My Earned Badges
// GET /api/badges/mine
// ─────────────────────────────────────────────
export const getMyBadges = async (req, res) => {
  try {
    const userBadges = await prisma.userBadge.findMany({
      where: { userId: req.user.id },
      include: { badge: true },
      orderBy: { earnedAt: 'desc' },
    });

    return res.status(200).json({ success: true, badges: userBadges });

  } catch (error) {
    console.error('GET_MY_BADGES ERROR:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─────────────────────────────────────────────
// Get Single Badge
// GET /api/badges/:id
// ─────────────────────────────────────────────
export const getBadge = async (req, res) => {
  try {
    const badge = await prisma.badge.findUnique({
      where: { id: req.params.id },
      include: { users: { include: { user: { select: { id: true, username: true, fullName: true } } } } },
    });

    if (!badge) return res.status(404).json({ success: false, message: 'Badge not found' });

    return res.status(200).json({ success: true, badge });

  } catch (error) {
    console.error('GET_BADGE ERROR:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
