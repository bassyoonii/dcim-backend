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
  const email = (getArg('--email') || '').toLowerCase().trim();
  if (!email) {
    console.error('Usage: node scripts/userFix.js --email someone@domain.tld [--password xxx] [--activate] [--role admin|sys_operator|net_operator] --confirm YES');
    process.exit(1);
  }

  const newPassword = getArg('--password');
  const newRole = getArg('--role');
  const doActivate = hasFlag('--activate');

  const confirm = (getArg('--confirm') || '').toUpperCase();
  if (confirm !== 'YES') {
    console.log('Refusé: ajoute `--confirm YES` pour appliquer les changements.');
    console.log('Exemple: node scripts/userFix.js --email sysop@dcim.local --password MyPass123! --activate --role sys_operator --confirm YES');
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    console.error(`Utilisateur introuvable: ${email}`);
    process.exit(1);
  }

  const changes = { passwordReset: false, activated: false, roleChanged: false };

  if (typeof newPassword === 'string' && newPassword.length > 0) {
    user.password = newPassword;
    changes.passwordReset = true;
  }

  if (doActivate) {
    user.isActive = true;
    changes.activated = true;
  }

  if (typeof newRole === 'string' && newRole.length > 0) {
    user.role = newRole;
    changes.roleChanged = true;
  }

  await user.save();

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        ...changes
      },
      null,
      2
    )
  );

  process.exit(0);
};

main().catch((err) => {
  console.error('[user:fix] failed:', err);
  process.exit(1);
});
