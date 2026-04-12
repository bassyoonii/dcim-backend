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
  const email = (getArg('--email') || '').toLowerCase().trim();
  if (!email) {
    console.error('Usage: node scripts/userInspect.js --email someone@domain.tld');
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email }).select('_id name email role isActive createdAt updatedAt');

  if (!user) {
    console.log(JSON.stringify({ found: false, email }, null, 2));
    process.exit(0);
  }

  console.log(
    JSON.stringify(
      {
        found: true,
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      null,
      2
    )
  );

  process.exit(0);
};

main().catch((err) => {
  console.error('[user:inspect] failed:', err);
  process.exit(1);
});
