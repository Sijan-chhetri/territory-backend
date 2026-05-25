import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { getMyTransactions, getMyXpSummary } from './xp.controller.js';

const router = Router();

router.get('/summary', authMiddleware, getMyXpSummary);
router.get('/transactions', authMiddleware, getMyTransactions);

export default router;
