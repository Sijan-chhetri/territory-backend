const express = require('express');
const router = express.Router();

const territoryController = require('./territory.controller');
const auth = require('../../middlewares/auth');

router.get('/all', auth, territoryController.getAllTerritories);

router.get('/events', auth, territoryController.getTerritoryEvents);

module.exports = router;