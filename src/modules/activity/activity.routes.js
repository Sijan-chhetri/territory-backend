import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';

import {
  finishActivity,
  getMyActivities,
  getActivityDetail,
  getMyTotalStats,
  getTodayStats,
  getMyTodayActivities,
  getMyFriendsActivities,
  getWeeklyActivityStats,
  getPersonalRecords,
} from './activity.controller.js';

const router = Router();

router.post('/finish', authMiddleware, finishActivity);

router.get('/my', authMiddleware, getMyActivities);

router.get('/my/today', authMiddleware, getMyTodayActivities);

router.get('/stats/total', authMiddleware, getMyTotalStats);
router.get('/stats/today', authMiddleware, getTodayStats);

// IMPORTANT: keep this before /:id
router.get('/friends', authMiddleware, getMyFriendsActivities);

// dynamic route always last
router.get('/:id', authMiddleware, getActivityDetail);

router.get('/stats/weekly', authMiddleware, getWeeklyActivityStats);

// lifetime stats 
router.get('/stats/lifetime', authMiddleware, getLifetimeActivityStats);


router.get('/stats/personal-records', authMiddleware, getPersonalRecords);

export default router;