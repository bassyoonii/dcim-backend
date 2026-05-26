const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const {
  getOverview,
  listSwitches,
  getSwitchById,
  createSwitch,
  updateSwitch,
  deleteSwitch
} = require('../controllers/switchController');

router.use(protect);

router.get('/overview', getOverview);

router.get('/', listSwitches);

router.get('/:id', getSwitchById);

router.post('/', authorize('admin', 'net_operator'), createSwitch);

router.put('/:id', authorize('admin', 'net_operator'), updateSwitch);

router.delete('/:id', authorize('admin', 'net_operator'), deleteSwitch);

module.exports = router;
