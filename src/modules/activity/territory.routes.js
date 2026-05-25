import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { getAllTerritories, getTerritoryEvents } from './territory.controller.js';

const router = Router();

router.get('/all', authMiddleware, getAllTerritories);
router.get('/events', authMiddleware, getTerritoryEvents);

export default router;
