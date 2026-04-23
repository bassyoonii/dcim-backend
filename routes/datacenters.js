const express = require('express');
const router = express.Router();
const {
  getDatacenters, getDatacenter, getDatacenterLocations, geocodeProxy,
  createDatacenter, updateDatacenter, deleteDatacenter
} = require('../controllers/datacenterController');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

// Make locations public so maps can load without authentication
router.get('/locations', getDatacenterLocations);
// public geocode proxy
router.get('/geocode', geocodeProxy);

router.use(protect); // other datacenter routes require login

router.get('/', getDatacenters);
router.get('/:id', getDatacenter);
router.post('/', authorize('admin'), createDatacenter);
router.put('/:id', authorize('admin'), updateDatacenter);
router.delete('/:id', authorize('admin'), deleteDatacenter);

module.exports = router;