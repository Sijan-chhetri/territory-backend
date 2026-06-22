import express from 'express';
import { getMyClanMessages } from './clanChatController.js';
import authMiddleware from '../../middlewares/auth.js';

const router = express.Router();

router.get('/messages', authMiddleware, getMyClanMessages);

export default router;