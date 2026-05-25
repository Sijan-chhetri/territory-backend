import express from 'express';
import { getMyProgress, getMyBadges } from '../modules/progression/progression.controller.js';
import authMiddleware from '../middlewares/auth.js';

const router = express.Router();

router.get('/me', authMiddleware, getMyProgress);

router.get('/badges', authMiddleware, getMyBadges);




export default router;