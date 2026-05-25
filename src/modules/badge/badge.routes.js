import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { getAllBadges, getMyBadges, getBadge } from './badge.controller.js';

const router = Router();

router.get('/',      authMiddleware, getAllBadges);  // full catalog
router.get('/mine',  authMiddleware, getMyBadges);   // earned by current user
router.get('/:id',   authMiddleware, getBadge);      // single badge detail

export default router;
