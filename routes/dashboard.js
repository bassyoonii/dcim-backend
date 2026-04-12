const express = require('express');
const router = express.Router();
const { getDashboardStats, getCapacityStats } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

router.get('/', protect, getDashboardStats);
router.get('/capacity', protect, getCapacityStats);
module.exports = router;