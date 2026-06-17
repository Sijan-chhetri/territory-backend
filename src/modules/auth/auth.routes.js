import { Router } from 'express';
import authMiddleware from '../../middlewares/auth.js';
import { register, login, getMe, updateProfile, changeUsername,getUsersWhoAreNotMyFriends,getUserDetailById,googleAuth,
  appleAuth,checkUserSetupStatus,
setupUserInfo,
getUserWeight,
 } from './auth.controller.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);

router.post("/google", googleAuth);
router.post("/apple", appleAuth);

router.get('/user/me', authMiddleware, getMe);
router.put('/user/profile', authMiddleware, updateProfile);
router.patch('/user/username', authMiddleware, changeUsername);
router.get("/users/not-friends", authMiddleware, getUsersWhoAreNotMyFriends);

router.get("/user/setup-status", authMiddleware, checkUserSetupStatus);

router.put("/user/setup", authMiddleware, setupUserInfo);

router.get("/user/weight", authMiddleware, getUserWeight);

router.get("/user/:userId", authMiddleware, getUserDetailById);





export default router;
