import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { register, login, getMe, updateProfile, changeUsername,getUsersWhoAreNotMyFriends,getUserDetailById, } from './auth.controller.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);

router.get('/user/me', authMiddleware, getMe);
router.put('/user/profile', authMiddleware, updateProfile);
router.patch('/user/username', authMiddleware, changeUsername);
router.get("/users/not-friends", authMiddleware, getUsersWhoAreNotMyFriends);
router.get("/user/:userId", authMiddleware, getUserDetailById);


export default router;
