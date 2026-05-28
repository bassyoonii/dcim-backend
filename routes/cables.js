const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { errorResponse } = require('../utils/apiResponse');

router.use(protect, authorize('admin', 'net_operator'));

router.use((req, res) => {
  return errorResponse(res, 'Cable APIs are not available', 410);
});
module.exports = router;
