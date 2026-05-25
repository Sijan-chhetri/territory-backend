import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { getLevels, getMyLevel } from './level.controller.js';

const router = Router();

router.get('/',   getLevels);                    // public — level config/thresholds
router.get('/me', authMiddleware, getMyLevel);   // current user's level detail

export default router;
