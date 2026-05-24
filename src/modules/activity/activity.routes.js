// activity.routes.js

const express = require('express');
const router = express.Router();

const activityController = require('./activity.controller');
const authMiddleware = require('../../middlewares/auth');

// router.post('/', authMiddleware, activityController.createActivity);
router.post('/finish', authMiddleware, activityController.finishActivity);

router.get('/my', authMiddleware, activityController.getMyActivities);
router.get('/territories', authMiddleware, activityController.getActivityDetail);

router.get('/finishActivity', authMiddleware, activityController.finishActivity);

module.exports = router;