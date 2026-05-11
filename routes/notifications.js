const express = require('express');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications?limit=20&page=1&unreadOnly=0
router.get('/', protect, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const unreadOnly =
      String(req.query.unreadOnly || '0') === '1' ||
      String(req.query.unreadOnly || '').toLowerCase() === 'true';

    const filter = { recipient: req.user._id };
    if (unreadOnly) filter.readAt = null;

    const [items, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('actor', 'name email avatar role')
        .lean(),
      Notification.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('[notifications] list failed:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', protect, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ recipient: req.user._id, readAt: null });
    res.json({ success: true, data: { count } });
  } catch (err) {
    console.error('[notifications] unread-count failed:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', protect, async (req, res) => {
  try {
    const notif = await Notification.findOne({ _id: req.params.id, recipient: req.user._id });
    if (!notif) return res.status(404).json({ success: false, message: 'Not found' });

    if (!notif.readAt) {
      notif.readAt = new Date();
      await notif.save();
    }

    const populated = await Notification.findById(notif._id)
      .populate('actor', 'name email avatar role')
      .lean();

    res.json({ success: true, data: populated });
  } catch (err) {
    console.error('[notifications] mark read failed:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', protect, async (req, res) => {
  try {
    const now = new Date();
    const result = await Notification.updateMany(
      { recipient: req.user._id, readAt: null },
      { $set: { readAt: now } }
    );

    res.json({ success: true, data: { modified: result.modifiedCount ?? result.nModified ?? 0 } });
  } catch (err) {
    console.error('[notifications] read-all failed:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
