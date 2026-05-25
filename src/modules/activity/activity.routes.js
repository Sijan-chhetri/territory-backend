import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { finishActivity, getMyActivities, getActivityDetail } from './activity.controller.js';

const router = Router();

router.post('/finish', authMiddleware, finishActivity);
router.get('/my', authMiddleware, getMyActivities);
router.get('/:id', authMiddleware, getActivityDetail);

export default router;
