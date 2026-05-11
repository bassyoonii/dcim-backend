const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendMail } = require('./mailer');
const { getIO } = require('../socket');

const AUDIT_NOTIFY_ADMINS = !['0', 'false', 'no', 'off'].includes(
  String(process.env.AUDIT_NOTIFY_ADMINS || '').toLowerCase()
);

const NOTIFY_ADMIN_ON_AUDIT_ROLES = new Set(['sys_operator', 'net_operator']);

const pickEntityLabel = (changes) => {
  if (!changes || typeof changes !== 'object') return null;
  return (
    changes.name ||
    changes.hostname ||
    changes.label ||
    changes.model ||
    changes.serialNumber ||
    changes.email ||
    changes.title ||
    null
  );
};

const toFrenchVerb = (action) => {
  switch (action) {
    case 'CREATE':
      return 'a ajouté';
    case 'UPDATE':
      return 'a modifié';
    case 'DELETE':
      return 'a supprimé';
    default:
      return 'a mis à jour';
  }
};

const notifyFromAudit = async ({ actorId, actorName, actorRole, action, entity, entityId, changes }) => {
  // By default we DO propagate audit events (from operators) to admins.
  // Set AUDIT_NOTIFY_ADMINS=false to disable.
  if (!AUDIT_NOTIFY_ADMINS) return;
  if (!actorId) return;
  if (!actorRole || !NOTIFY_ADMIN_ON_AUDIT_ROLES.has(actorRole)) return;

  const recipients = await User.find({
    isActive: true,
    role: 'admin',
    _id: { $ne: actorId }
  })
    .select('_id email')
    .lean();

  if (!recipients.length) return;

  const entityLabel = pickEntityLabel(changes);
  const baseDoc = {
    actor: actorId,
    actorName: actorName || null,
    action,
    entity,
    entityId: entityId || null,
    entityLabel: entityLabel || null,
    readAt: null
  };

  const docs = recipients.map((r) => ({ ...baseDoc, recipient: r._id }));
  const inserted = await Notification.insertMany(docs, { ordered: false });

  const io = getIO();
  if (io) {
    for (const n of inserted) {
      io.to(`user:${n.recipient.toString()}`).emit('notification:new', {
        _id: n._id,
        actor: actorId ? { _id: actorId, name: actorName } : null,
        actorName: actorName || null,
        action: n.action,
        entity: n.entity,
        entityId: n.entityId,
        entityLabel: n.entityLabel,
        readAt: n.readAt,
        createdAt: n.createdAt
      });
    }
  }

  const subject = 'DCIM - Nouvelle notification';
  const text = `${actorName || 'Quelqu\'un'} ${toFrenchVerb(action)} ${entityLabel || entity}`;

  await Promise.allSettled(
    recipients
      .filter((r) => r.email)
      .map((r) => sendMail({ to: r.email, subject, text }))
  );
};

const logAction = async (userId, action, entity, entityId, changes, ip) => {
  try {
    let actorName = undefined;
    let actorRole = undefined;
    if (userId) {
      try {
        const u = await User.findById(userId).select('name email role');
        if (u) {
          actorName = u.name || u.email;
          actorRole = u.role;
        }
      } catch (e) {
        // ignore user lookup failures
      }
    }

    await AuditLog.create({
      user: userId || undefined,
      actorName,
      action,
      entity,
      entityId,
      changes,
      ip
    });

    // Do not block the main request on notification delivery
    setImmediate(() => {
      notifyFromAudit({
        actorId: userId || null,
        actorName,
        actorRole,
        action,
        entity,
        entityId,
        changes
      }).catch((err) => {
        console.error('[notifications] error:', err.message);
      });
    });
  } catch (err) {
    // Audit failure should never crash the main request
    console.error('Audit log error:', err.message);
  }
};

module.exports = { logAction };