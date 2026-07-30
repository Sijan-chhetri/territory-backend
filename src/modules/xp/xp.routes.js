import express from 'express';

import {
  getMyTransactions,
  getMyXpSummary,
  grantRewardedAdXp,
} from './xp.controller.js';

import authMiddleware from '../../middlewares/auth.js';

const router = express.Router();

router.get(
  '/transactions',
  authMiddleware,
  getMyTransactions,
);

router.get(
  '/summary',
  authMiddleware,
  getMyXpSummary,
);

router.post(
  '/rewarded-ad',
  authMiddleware,
  grantRewardedAdXp,
);

export default router;