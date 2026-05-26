const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const {
  listStorage,
  getStorageById,
  createStorage,
  updateStorage,
  deleteStorage
} = require('../controllers/storageController');

router.use(protect);

router.get('/', listStorage);

router.get('/:id', getStorageById);

router.post('/', authorize('admin', 'sys_operator'), createStorage);

router.put('/:id', authorize('admin', 'sys_operator'), updateStorage);

router.delete('/:id', authorize('admin', 'sys_operator'), deleteStorage);

module.exports = router;
