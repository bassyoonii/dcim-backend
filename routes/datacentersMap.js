const express = require('express');
const router = express.Router();
const { getDatacentersMap } = require('../controllers/datacenterController');

router.get('/', getDatacentersMap);

module.exports = router;
