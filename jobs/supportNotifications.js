const cron = require('node-cron');

const Server = require('../models/Server');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const Switch = require('../models/Switch');
const Firewall = require('../models/Firewall');
const SupportNotification = require('../models/SupportNotification');
const { sendMail } = require('../utils/mailer');

const parseToList = (value) => {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
};

const getRecipients = () => {
  const direct = parseToList(process.env.SUPPORT_ALERT_TO);
  if (direct.length) return direct;

  const fallback = process.env.DEFAULT_ADMIN_EMAIL;
  return fallback ? [String(fallback).trim()] : [];
};

const isEnabled = () => {
  const v = String(process.env.SUPPORT_NOTIFICATIONS_ENABLED ?? '').trim();
  if (!v) return true;
  return v.toLowerCase() === 'true' || v === '1';
};

const addMonths = (date, months) => {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  d.setMonth(targetMonth);
  return d;
};

const isSameDay = (a, b) => {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
};

const buildAssetRows = async () => {
  const [servers, storage, dataDomains, switches, firewalls] = await Promise.all([
    Server.find({ supportExpiry: { $ne: null } }).select('name supportExpiry serialNumber').lean(),
    StorageBay.find({ supportExpiry: { $ne: null } }).select('name supportExpiry brand model').lean(),
    DataDomain.find({ supportExpiry: { $ne: null } }).select('name supportExpiry model').lean(),
    Switch.find({ supportExpiry: { $ne: null } }).select('name supportExpiry brand model').lean(),
    Firewall.find({ supportExpiry: { $ne: null } }).select('name supportExpiry brand model role').lean(),
  ]);

  const toRows = (kind, items) =>
    items.map((x) => ({
      assetType: kind,
      assetId: x._id,
      name: x.name,
      supportExpiry: x.supportExpiry,
    }));

  return [
    ...toRows('Server', servers),
    ...toRows('StorageBay', storage),
    ...toRows('DataDomain', dataDomains),
    ...toRows('Switch', switches),
    ...toRows('Firewall', firewalls),
  ].filter((x) => x.supportExpiry);
};

const ensureNotificationRow = async ({ assetType, assetId, supportExpiry }) => {
  const existing = await SupportNotification.findOne({ assetType, assetId }).lean();

  if (!existing) {
    return SupportNotification.create({ assetType, assetId, supportExpiry });
  }

  if (!isSameDay(new Date(existing.supportExpiry), new Date(supportExpiry))) {
    return SupportNotification.findOneAndUpdate(
      { assetType, assetId },
      {
        $set: { supportExpiry, lastError: '' },
        $unset: { firstAlertSentAt: 1, lastReminderSentAt: 1 },
      },
      { new: true }
    );
  }

  return existing;
};

const sendSupportAlert = async ({ kind, name, supportExpiry, to }) => {
  const subject = `[DCIM] Support expire bientôt: ${kind} ${name}`;
  const text = [
    `Support expirera le: ${formatDate(supportExpiry)}`,
    `Équipement: ${kind} / ${name}`,
  ].join('\n');

  await sendMail({ to, subject, text });
};

const sendSupportReminder = async ({ kind, name, supportExpiry, to }) => {
  const subject = `[DCIM] Rappel support expiré/à renouveler: ${kind} ${name}`;
  const text = [
    `Support expirera (ou a expiré) le: ${formatDate(supportExpiry)}`,
    `Équipement: ${kind} / ${name}`,
    `Rappel hebdomadaire (lundi) tant que la date n'est pas renouvelée.`,
  ].join('\n');

  await sendMail({ to, subject, text });
};

const getAlertDate = (supportExpiry) => {
  // Mode test rapide: si TEST_SUPPORT_MINUTES_BEFORE est défini,
  // on envoie l'alerte X minutes avant supportExpiry.
  const testMinutes = Number(process.env.TEST_SUPPORT_MINUTES_BEFORE || 0);

  if (testMinutes > 0) {
    return new Date(new Date(supportExpiry).getTime() - testMinutes * 60 * 1000);
  }

  // Mode normal: 4 mois avant expiration
  return addMonths(supportExpiry, -4);
};

const runOnce = async () => {
  if (!isEnabled()) {
    console.log('[supportNotifications] Disabled');
    return { enabled: false };
  }

  const recipients = getRecipients();
  if (!recipients.length) {
    console.warn('[supportNotifications] No recipients configured');
    return { enabled: true, delivered: false, reason: 'no-recipients' };
  }

  const now = new Date();
  const isMonday = now.getDay() === 1;
  const assets = await buildAssetRows();

  console.log(`[supportNotifications] Found ${assets.length} asset(s) with supportExpiry`);

  let sent = 0;

  for (const asset of assets) {
    const supportExpiry = new Date(asset.supportExpiry);
    const alertDate = getAlertDate(supportExpiry);

    console.log(
      `[supportNotifications] Checking ${asset.assetType} "${asset.name}" | expiry=${formatDate(
        supportExpiry
      )} | alertDate=${alertDate.toISOString()}`
    );

    const notif = await ensureNotificationRow(asset);

    if (!notif.firstAlertSentAt && now.getTime() >= alertDate.getTime()) {
      try {
        await sendSupportAlert({
          kind: asset.assetType,
          name: asset.name,
          supportExpiry,
          to: recipients,
        });

        await SupportNotification.updateOne(
          { assetType: asset.assetType, assetId: asset.assetId },
          { $set: { firstAlertSentAt: new Date(), lastError: '' } }
        );

        sent += 1;
        console.log(`[supportNotifications] First alert sent for ${asset.assetType} "${asset.name}"`);
      } catch (err) {
        await SupportNotification.updateOne(
          { assetType: asset.assetType, assetId: asset.assetId },
          { $set: { lastError: String(err?.message || err) } }
        );
        console.warn(
          `[supportNotifications] Failed first alert for ${asset.assetType} "${asset.name}":`,
          err.message
        );
      }
      continue;
    }

    const pastAlertWindow = now.getTime() >= alertDate.getTime();

    if (isMonday && pastAlertWindow && notif.firstAlertSentAt) {
      const last = notif.lastReminderSentAt ? new Date(notif.lastReminderSentAt) : null;
      const alreadyToday = last ? isSameDay(startOfDay(last), startOfDay(now)) : false;

      if (!alreadyToday) {
        try {
          await sendSupportReminder({
            kind: asset.assetType,
            name: asset.name,
            supportExpiry,
            to: recipients,
          });

          await SupportNotification.updateOne(
            { assetType: asset.assetType, assetId: asset.assetId },
            { $set: { lastReminderSentAt: new Date(), lastError: '' } }
          );

          sent += 1;
          console.log(`[supportNotifications] Reminder sent for ${asset.assetType} "${asset.name}"`);
        } catch (err) {
          await SupportNotification.updateOne(
            { assetType: asset.assetType, assetId: asset.assetId },
            { $set: { lastError: String(err?.message || err) } }
          );
          console.warn(
            `[supportNotifications] Failed reminder for ${asset.assetType} "${asset.name}":`,
            err.message
          );
        }
      }
    }
  }

  return { enabled: true, sent };
};

const startSupportNotificationJob = () => {
  if (!isEnabled()) {
    console.log('[supportNotifications] Disabled by env SUPPORT_NOTIFICATIONS_ENABLED');
    return null;
  }

  const schedule = process.env.SUPPORT_NOTIFICATIONS_CRON || '0 9 * * *';

  const task = cron.schedule(schedule, async () => {
    try {
      console.log('[supportNotifications] Cron triggered');
      const result = await runOnce();
      console.log('[supportNotifications] Result:', result);
    } catch (err) {
      console.warn('[supportNotifications] job failed:', err.message);
    }
  });

  console.log(`[supportNotifications] Scheduled (${schedule})`);

  if (String(process.env.SUPPORT_NOTIFICATIONS_RUN_ON_STARTUP || '').toLowerCase() === 'true') {
    runOnce()
      .then((result) => console.log('[supportNotifications] Startup result:', result))
      .catch((err) => console.warn('[supportNotifications] startup run failed:', err.message));
  }

  return task;
};

module.exports = { startSupportNotificationJob, runOnce };