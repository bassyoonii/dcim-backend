const cron = require('node-cron');

const Server = require('../models/Server');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const Switch = require('../models/Switch');
const Firewall = require('../models/Firewall');
const { sendMail } = require('../utils/mailer');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { getIO } = require('../socket');

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

const startOfWeekMonday = (value) => {
  const d = new Date(value);
  const day = d.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysSinceMonday);
  return d;
};

const formatNotes = (value) => {
  const s = String(value || '').trim();
  if (!s) return null;
  const max = 300;
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const buildAssetRows = async () => {
  const threshold = addMonths(new Date(), 4);
  const query = { supportExpiry: { $ne: null, $lte: threshold } };

  const [servers, storage, dataDomains, switches, firewalls] = await Promise.all([
    Server.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt notes').lean(),
    StorageBay.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt notes').lean(),
    DataDomain.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt notes').lean(),
    Switch.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt notes').lean(),
    Firewall.find(query).select('name supportExpiry firstNotifiedAt lastNotifiedAt notes').lean(),
  ]);

  const toRows = (kind, model, items) =>
    items.map((x) => ({
      assetType: kind,
      model,
      id: x._id,
      name: x.name,
      supportExpiry: x.supportExpiry,
      firstNotifiedAt: x.firstNotifiedAt,
      lastNotifiedAt: x.lastNotifiedAt,
      notes: x.notes
    }));

  return [
    ...toRows('Server', Server, servers),
    ...toRows('StorageBay', StorageBay, storage),
    ...toRows('DataDomain', DataDomain, dataDomains),
    ...toRows('Switch', Switch, switches),
    ...toRows('Firewall', Firewall, firewalls),
  ];
};

const sendSupportAlert = async ({ kind, name, supportExpiry, notes, to }) => {
  const skipEmail = ['1', 'true', 'yes', 'on'].includes(String(process.env.SUPPORT_ALERT_SKIP_EMAIL || '').toLowerCase());
  if (skipEmail) {
    console.log(`[supportNotifications] SUPPORT_ALERT_SKIP_EMAIL enabled; skipping email for ${kind} ${name}`);
    return { delivered: true, skipped: true };
  }
  const subject = `[DCIM] Support expire bientôt: ${kind} ${name}`;
  const note = formatNotes(notes);
  const text = [
    `Support expirera le: ${formatDate(supportExpiry)}`,
    `Équipement: ${kind} / ${name}`,
    ...(note ? [`Remarque: ${note}`] : [])
  ].join('\n');

  const result = await sendMail({ to, subject, text });
  if (!result.delivered) {
    console.error(`[supportNotifications] Failed to send alert for ${kind} ${name}:`, result.error);
    return result;
  }

  console.log(`[supportNotifications] Alert sent for ${kind} ${name} to ${to}`);
  return result;
};

const buildInAppRecipients = async (emails) => {
  const sendToAll = ['1', 'true', 'yes', 'on'].includes(String(process.env.SUPPORT_ALERT_INAPP_ALL || '').toLowerCase());
  if (sendToAll) {
    const users = await User.find({ isActive: true }).select('_id').lean();
    console.log(`[supportNotifications] In-app recipients mode=ALL (${users.length})`);
    return users.map((u) => u._id);
  }

  const list = Array.isArray(emails) ? emails : [];
  const normalized = list.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) return [];

  const users = await User.find({
    isActive: true,
    email: { $in: normalized }
  })
    .select('_id email')
    .lean();

  return users.map((u) => u._id);
};

const createInAppAlert = async ({ userIds, kind, assetId, name, supportExpiry }) => {
  if (!userIds || userIds.length === 0) return;

  const docs = userIds.map((uid) => ({
    recipient: uid,
    actor: null,
    actorName: 'Système',
    action: 'ALERT',
    entity: kind,
    entityId: assetId,
    entityLabel: `${name} (expire: ${formatDate(supportExpiry)})`,
    readAt: null
  }));

  const inserted = await Notification.insertMany(docs, { ordered: false });

  const io = getIO();
  if (io) {
    for (const n of inserted) {
      io.to(`user:${n.recipient.toString()}`).emit('notification:new', {
        _id: n._id,
        actor: null,
        actorName: n.actorName || 'Système',
        action: n.action,
        entity: n.entity,
        entityId: n.entityId,
        entityLabel: n.entityLabel,
        readAt: n.readAt,
        createdAt: n.createdAt
      });
    }
  }
};

const isEnabled = () => ['1', 'true', 'yes', 'on'].includes(String(process.env.SUPPORT_NOTIFICATIONS_ENABLED || '').toLowerCase());

const isSameDay = (a, b) => a.toDateString() === b.toDateString();

const startOfDay = (d) => { const dd = new Date(d); dd.setHours(0,0,0,0); return dd; };

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
  const forceInApp = ['1', 'true', 'yes', 'on'].includes(String(process.env.SUPPORT_ALERT_FORCE_INAPP || '').toLowerCase());

  const recipients = getRecipients();
  if (!recipients.length) {
    console.warn('[supportNotifications] No recipients configured');
    return { enabled: true, delivered: false, reason: 'no-recipients' };
  }

  const inAppRecipients = await buildInAppRecipients(recipients);
  if (!inAppRecipients.length) {
    console.warn('[supportNotifications] No in-app recipients matched SUPPORT_ALERT_TO/DEFAULT_ADMIN_EMAIL');
  }

  const assets = await buildAssetRows();
  console.log(`[supportNotifications] Found ${assets.length} asset(s) with supportExpiry`);

  const now = new Date();
  const isMonday = now.getDay() === 1;
  const weekStart = startOfWeekMonday(now);

  let sent = 0;

  for (const asset of assets) {
    const shouldSendFirst = !asset.firstNotifiedAt;
    const shouldSendReminder = Boolean(asset.firstNotifiedAt) &&
      isMonday &&
      (!asset.lastNotifiedAt || new Date(asset.lastNotifiedAt) < weekStart);

    if (!shouldSendFirst && !shouldSendReminder) {
      continue;
    }

    const result = await sendSupportAlert({
      kind: asset.assetType,
      name: asset.name,
      supportExpiry: asset.supportExpiry,
      notes: asset.notes,
      to: recipients,
    });

    const treatAsDelivered = Boolean(result && result.delivered) || forceInApp;

    if (treatAsDelivered) {
      const nextUpdate = {
        lastNotifiedAt: now
      };
      if (!asset.firstNotifiedAt) {
        nextUpdate.firstNotifiedAt = now;
      }
      await asset.model.updateOne({ _id: asset.id }, { $set: nextUpdate });

      try {
        await createInAppAlert({
          userIds: inAppRecipients,
          kind: asset.assetType,
          assetId: asset.id,
          name: asset.name,
          supportExpiry: asset.supportExpiry
        });
      } catch (err) {
        console.warn('[supportNotifications] In-app notification failed:', err.message);
      }

      sent += 1;
      console.log(`[supportNotifications] Alert sent for ${asset.assetType} "${asset.name}"`);
    } else {
      console.error(`[supportNotifications] Failed for ${asset.assetType} "${asset.name}":`, result.error);
    }
  }

  return { sent };
};

const startSupportNotificationJob = () => {
  if (!isEnabled()) {
    console.log('[supportNotifications] Disabled by env SUPPORT_NOTIFICATIONS_ENABLED');
    return null;
  }

  const schedule = String(process.env.SUPPORT_ALERT_CRON || '0 9 * * 1').trim();
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

  if (String(process.env.SUPPORT_NOTIFICATIONS_RUN_ON_STARTUP || '').toLowerCase() === 'true') {
    runOnce()
      .then((result) => console.log('[supportNotifications] Startup result:', result))
      .catch((err) => console.warn('[supportNotifications] startup run failed:', err.message));
  }
  console.log('[supportNotifications] Cron job created');
  task.start();
  console.log('[supportNotifications] Cron job started');

  return task;
};

module.exports = { startSupportNotificationJob, runOnce };