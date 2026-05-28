import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { getAllTerritories, getTerritoryEvents, updateTerritoryRoute } from './territory.controller.js';

const router = Router();

router.get('/all',        authMiddleware, getAllTerritories);
router.get('/events',     authMiddleware, getTerritoryEvents);
router.put('/:id/route',  authMiddleware, updateTerritoryRoute);

export default router;