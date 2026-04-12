const express = require('express');
const router = express.Router();
const {
  getServers, getServer, createServer, updateServer, deleteServer
} = require('../controllers/serverController');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(protect);

router.get('/', getServers);
router.get('/:id', getServer);
router.post('/', authorize('admin', 'sys_operator'), createServer);
router.put('/:id', authorize('admin', 'sys_operator'), updateServer);
router.delete('/:id', authorize('admin', 'sys_operator'), deleteServer);

module.exports = router;
