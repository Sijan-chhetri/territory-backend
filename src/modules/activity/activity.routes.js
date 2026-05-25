// activity.routes.js

const express = require('express');
const router = express.Router();

const activityController = require('./activity.controller');
const authMiddleware = require('../../middlewares/auth');

router.post('/finish', authMiddleware, activityController.finishActivity);
router.get('/my', authMiddleware, activityController.getMyActivities);
router.get('/:id', authMiddleware, activityController.getActivityDetail);


module.exports = router;
