const cron = require('node-cron');

const Server = require('../models/Server');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const Switch = require('../models/Switch');
const Firewall = require('../models/Firewall');
const { sendMail } = require('../utils/mailer');

const parseToList = (value) =>
  String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const getRecipients = () => {
  const direct = parseToList(process.env.SUPPORT_ALERT_TO);
  if (direct.length) return direct;

  const fallback = process.env.DEFAULT_ADMIN_EMAIL;
  return fallback ? [String(fallback).trim()] : [];
};

const formatDate = (date) => {
  if (!date) return '';
  return new Date(date).toISOString().slice(0, 10);
};

const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  // Clamp overflow (e.g. Jan 31 + 1 month → Feb 28)
  if (d.getDate() < new Date(date).getDate()) d.setDate(0);
  return d;
};

const buildAssetRows = async () => {
  const threshold = addMonths(new Date(), 4);
  const query = { supportExpiry: { $ne: null, $lte: threshold } };

  const [servers, storage, dataDomains, switches, firewalls] = await Promise.all([
    Server.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt').lean(),
    StorageBay.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt').lean(),
    DataDomain.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt').lean(),
    Switch.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt').lean(),
    Firewall.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt').lean(),
  ]);

  const toRows = (kind, model, items) =>
    items.map((x) => ({
      assetType: kind,
      model,
      id: x._id,
      name: x.name,
      supportExpiry: x.supportExpiry,
      firstNotifiedAt: x.firstNotifiedAt,
      lastNotifiedAt: x.lastNotifiedAt
    }));

  return [
    ...toRows('Server', Server, servers),
    ...toRows('StorageBay', StorageBay, storage),
    ...toRows('DataDomain', DataDomain, dataDomains),
    ...toRows('Switch', Switch, switches),
    ...toRows('Firewall', Firewall, firewalls),
  ];
};

const sendSupportAlert = async ({ kind, name, supportExpiry, to }) => {
  const subject = `[DCIM] Support expire bientôt: ${kind} ${name}`;
  const text = [`Support expirera le: ${formatDate(supportExpiry)}`, `Équipement: ${kind} / ${name}`].join('\n');

  const result = await sendMail({ to, subject, text });
  if (!result.delivered) {
    console.error(`[supportNotifications] Failed to send alert for ${kind} ${name}:`, result.error);
    return result;
  }

  console.log(`[supportNotifications] Alert sent for ${kind} ${name} to ${to}`);
  return result;
};

const runOnce = async () => {
  const recipients = getRecipients();
  if (!recipients.length) {
    console.warn('[supportNotifications] No recipients configured');
    return { delivered: false, reason: 'no-recipients' };
  }

  const assets = await buildAssetRows();
  console.log(`[supportNotifications] Found ${assets.length} asset(s) with supportExpiry`);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let sent = 0;

  for (const asset of assets) {
    const shouldSendFirst = !asset.firstNotifiedAt;
    const shouldSendReminder = Boolean(asset.firstNotifiedAt) &&
      (!asset.lastNotifiedAt || asset.lastNotifiedAt <= weekAgo);

    if (!shouldSendFirst && !shouldSendReminder) {
      continue;
    }

    const result = await sendSupportAlert({
      kind: asset.assetType,
      name: asset.name,
      supportExpiry: asset.supportExpiry,
      to: recipients,
    });

    if (result.delivered) {
      const nextUpdate = {
        lastNotifiedAt: now
      };
      if (!asset.firstNotifiedAt) {
        nextUpdate.firstNotifiedAt = now;
      }
      await asset.model.updateOne({ _id: asset.id }, { $set: nextUpdate });

      sent += 1;
      console.log(`[supportNotifications] Alert sent for ${asset.assetType} "${asset.name}"`);
    } else {
      console.error(`[supportNotifications] Failed for ${asset.assetType} "${asset.name}":`, result.error);
    }
  }

  return { sent };
};

const startSupportNotificationJob = () => {
  const schedule = '0 9 * * 1';
  const isValid = cron.validate(schedule);
  console.log('[supportNotifications] Cron valid:', isValid);
  if (!isValid) throw new Error('Invalid cron schedule');

  const task = cron.schedule(schedule, async () => {
    try {
      console.log('[supportNotifications] Cron triggered');
      const result = await runOnce();
      console.log('[supportNotifications] Result:', result);
    } catch (err) {
      console.error('[supportNotifications] job failed:', err.message);
    }
  }, { scheduled: true });

  console.log(`[supportNotifications] Scheduled (${schedule})`);
  console.log('[supportNotifications] Cron job created');
  task.start();
  console.log('[supportNotifications] Cron job started');

  return task;
};

module.exports = { startSupportNotificationJob, runOnce };