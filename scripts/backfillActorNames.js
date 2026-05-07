/**
 * backfillActorNames.js
 * Fill `actorName` on existing AuditLog documents when `user` is present.
 * Usage: from `dcim-backend` folder run `node scripts/backfillActorNames.js`
 */
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

async function backfill() {
  await connectDB();

  const cursor = AuditLog.find({ actorName: { $in: [null, undefined, ''] }, user: { $exists: true, $ne: null } }).cursor();
  let updated = 0;
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    try {
      const u = await User.findById(doc.user).select('name email');
      const actorName = u ? (u.name || u.email) : undefined;
      if (actorName) {
        doc.actorName = actorName;
        await doc.save();
        updated++;
      }
    } catch (err) {
      console.error('Error updating log', doc._id, err.message);
    }
  }

  console.log(`Backfill complete. Documents updated: ${updated}`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill error', err);
  process.exit(1);
});
