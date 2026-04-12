const dotenv = require('dotenv');
const connectDB = require('../config/db');
const User = require('../models/User');

dotenv.config();

const getArg = (name) => {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
};

const main = async () => {
  const role = getArg('--role');
  const limit = Number(getArg('--limit') || 50);

  await connectDB();

  const filter = {};
  if (role) filter.role = role;

  const users = await User.find(filter)
    .select('_id name email role isActive createdAt updatedAt')
    .sort({ createdAt: -1 })
    .limit(Number.isFinite(limit) ? limit : 50);

  console.log(
    JSON.stringify(
      users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt
      })),
      null,
      2
    )
  );

  process.exit(0);
};

main().catch((err) => {
  console.error('[user:list] failed:', err);
  process.exit(1);
});
