const express = require('express');
const router = express.Router();
const {
  getDatacenters, getDatacenter,
  createDatacenter, updateDatacenter, deleteDatacenter
} = require('../controllers/datacenterController');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(protect); // all datacenter routes require login

router.get('/', getDatacenters);
router.get('/:id', getDatacenter);
router.post('/', authorize('admin'), createDatacenter);
router.put('/:id', authorize('admin'), updateDatacenter);
router.delete('/:id', authorize('admin'), deleteDatacenter);

module.exports = router;