const connectDB = require('../config/db');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

const run = async () => {
  const q = process.argv[2] || '';
  if (!process.env.MONGO_URI) {
    console.error('Please set MONGO_URI environment variable before running this script.');
    process.exit(1);
  }

  await connectDB();

  try {
    let userIds = [];
    if (q) {
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(q);
      if (isObjectId) {
        userIds = [q];
      } else {
        const matched = await User.find({
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } }
          ]
        }).select('_id name email');
        if (matched.length === 0) {
          console.log(`No users found matching "${q}"`);
          process.exit(0);
        }
        userIds = matched.map(u => u._id);
        console.log('Matched users:');
        matched.forEach(u => console.log(` - ${u._id}  ${u.name} <${u.email}>`));
      }
    }

    const filter = {};
    if (userIds.length > 0) filter.user = { $in: userIds };

    const logs = await AuditLog.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).limit(200);
    if (!logs || logs.length === 0) {
      console.log('No audit logs found for the given query.');
      process.exit(0);
    }

    console.log(`Found ${logs.length} audit log(s):`);
    logs.forEach((l) => {
      const userStr = l.user ? `${l.user.name} <${l.user.email}>` : 'System';
      console.log(`${l.createdAt.toISOString()} | ${userStr} | ${l.action} | ${l.entity} (${l.entityId || '-'})`);
      if (l.changes) console.log('  changes:', JSON.stringify(l.changes));
    });

    process.exit(0);
  } catch (err) {
    console.error('Error while querying audit logs:', err.message);
    process.exit(1);
  }
};

run();
