const express = require('express');
const router = express.Router();
const {
  getRacks, getRack, createRack, updateRack, deleteRack, getRack3DData, getRackOccupancy, getRackTopology
} = require('../controllers/rackController');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(protect);

router.get('/', getRacks);

router.get('/:id', getRack);
router.get('/:id/occupancy', getRackOccupancy);
router.get('/:id/topology', getRackTopology);
router.get('/:id/3d', getRack3DData);
router.post('/', authorize('admin'), createRack);
router.put('/:id', authorize('admin'), updateRack);
router.delete('/:id', authorize('admin'), deleteRack);

module.exports = router;