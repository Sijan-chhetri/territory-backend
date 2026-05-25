import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { getMyProgress, getMyBadges } from './progression.controller.js';

const router = Router();

router.get('/me',     authMiddleware, getMyProgress);
router.get('/badges', authMiddleware, getMyBadges);

export default router;
