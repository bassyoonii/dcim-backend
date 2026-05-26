const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const {
  listPorts,
  getPortById,
  updateStatus,
  updateSpeed,
  updateConnection,
  updateNotes,
  createPort,
  updatePort,
  deletePort,
} = require('../controllers/networkPortController');

router.use(protect);

router.get('/', listPorts);

router.get('/:id', getPortById);

// Allow manual status toggle (limited mutation)
router.patch('/:id/status', authorize('admin', 'net_operator'), updateStatus);

router.patch('/:id/speed', authorize('admin', 'net_operator'), updateSpeed);

router.patch('/:id/connection', authorize('admin', 'net_operator'), updateConnection);

router.patch('/:id/notes', authorize('admin', 'net_operator'), updateNotes);

router.post('/', authorize('admin', 'net_operator'), createPort);

router.put('/:id', authorize('admin', 'net_operator'), updatePort);

router.delete('/:id', authorize('admin', 'net_operator'), deletePort);

module.exports = router;
