const dotenv = require('dotenv');
const connectDB = require('../config/db');
const User = require('../models/User');

dotenv.config();

const getArg = (name) => {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
};

const hasFlag = (name) => process.argv.includes(name);

const main = async () => {
  const email = (getArg('--email') || process.env.DEFAULT_ADMIN_EMAIL || 'admin@dcim.local').toLowerCase();
  const password = getArg('--password') || process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';

  const doActivate = hasFlag('--activate');
  const doMakeAdmin = hasFlag('--make-admin');

  const confirm = (getArg('--confirm') || '').toUpperCase();
  if (confirm !== 'YES') {
    console.log('Refusé: ajoute `--confirm YES` pour appliquer les changements.');
    console.log('Exemple: node scripts/adminResetPassword.js --email admin@dcim.local --password admin123 --activate --make-admin --confirm YES');
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    console.error(`Utilisateur introuvable: ${email}`);
    process.exit(1);
  }

  // Only modify what was explicitly requested.
  user.password = password;
  if (doActivate) user.isActive = true;
  if (doMakeAdmin) user.role = 'admin';

  await user.save();

  console.log(JSON.stringify({
    ok: true,
    email,
    passwordReset: true,
    activated: doActivate,
    roleSetToAdmin: doMakeAdmin
  }, null, 2));

  process.exit(0);
};

main().catch((err) => {
  console.error('[admin:reset] failed:', err);
  process.exit(1);
});
