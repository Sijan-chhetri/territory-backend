import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { finishActivity, getMyActivities, getActivityDetail, getMyTotalStats, getTodayStats, getMyTodayActivities } from './activity.controller.js';

const router = Router();

router.post('/finish', authMiddleware, finishActivity);
router.get('/my', authMiddleware, getMyActivities);
router.get(
    '/my/today',
    authMiddleware,
    getMyTodayActivities
);
router.get("/stats/total", authMiddleware, getMyTotalStats);
router.get("/stats/today", authMiddleware, getTodayStats);
router.get('/:id', authMiddleware, getActivityDetail);

export default router;
