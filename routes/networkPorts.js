const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const NetworkPort = require('../models/NetworkPort');
const Switch = require('../models/Switch');
const Cable = require('../models/Cable');
const Server = require('../models/Server');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const Firewall = require('../models/Firewall');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { normalizeObjectId } = require('../utils/normalizeRefs');
const { logAction } = require('../utils/auditLog');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

const extractPortIndex = (portNumber) => {
  if (!portNumber) return null;
  const raw = String(portNumber).trim();
  if (!raw) return null;
  const m = raw.match(/(\d+)\s*$/);
  if (!m) return null;
  const idx = Number(m[1]);
  return Number.isFinite(idx) && idx > 0 ? idx : null;
};

const normalizePortLabel = (value) => {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return `Port ${raw}`;
  const m = raw.match(/^\s*port\s*(\d+)\s*$/i);
  if (m) return `Port ${m[1]}`;
  return raw;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveDeviceIdByName = async ({ deviceType, deviceName }) => {
  const name = typeof deviceName === 'string' ? deviceName.trim() : '';
  if (!name) return null;

  const modelMap = {
    Server,
    Switch,
    StorageBay,
    DataDomain,
    Firewall,
  };
  const Model = modelMap[deviceType];
  if (!Model) return null;

  const rx = new RegExp(`^${escapeRegExp(name)}$`, 'i');
  const found = await Model.findOne({ name: rx }).select('_id').lean();
  return found?._id || null;
};

const AUTO_CABLE_NOTE_PREFIX = '[AUTO] NetworkPort connection';

const upsertAutoCableForPort = async ({ portDoc, userId, ip }) => {
  if (!portDoc) return;
  const switchId = normalizeObjectId(portDoc.switch);
  const portLabel = normalizePortLabel(portDoc.portNumber);
  if (!switchId || !portLabel) return;

  const connected = portDoc.connectedDevice;
  const deviceType = connected?.deviceType;
  const deviceName = connected?.deviceName;
  const deviceId = connected?.deviceId;

  if (!deviceType || !deviceName || !deviceId) return;

  const existing = await Cable.findOne({
    cableType: 'Network',
    'network.sourceDevice.deviceType': 'Switch',
    'network.sourceDevice.deviceId': switchId,
    'network.sourceDevice.port': portLabel,
  }).select('_id notes').lean();

  // If a manual cable already exists for this port, do not override it.
  if (existing && typeof existing.notes === 'string' && !existing.notes.startsWith(AUTO_CABLE_NOTE_PREFIX)) {
    return;
  }

  const payload = {
    cableType: 'Network',
    network: {
      sourceDevice: {
        deviceType: 'Switch',
        deviceId: switchId,
        port: portLabel,
      },
      destDevice: {
        deviceType,
        deviceId,
      },
    },
    notes: `${AUTO_CABLE_NOTE_PREFIX} (portId=${portDoc._id})`,
    createdBy: userId,
  };

  const saved = await Cable.findOneAndUpdate(
    {
      cableType: 'Network',
      'network.sourceDevice.deviceType': 'Switch',
      'network.sourceDevice.deviceId': switchId,
      'network.sourceDevice.port': portLabel,
      $or: [
        { notes: { $regex: `^${escapeRegExp(AUTO_CABLE_NOTE_PREFIX)}` } },
        { notes: { $exists: false } },
        { notes: '' },
      ],
    },
    { $set: payload },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  try {
    await logAction(userId, existing ? 'UPDATE' : 'CREATE', 'Cable', saved._id, payload, ip);
  } catch {
    // ignore audit failures
  }
};

const deleteAutoCableForPort = async ({ portDoc, userId, ip }) => {
  if (!portDoc) return;
  const switchId = normalizeObjectId(portDoc.switch);
  const portLabel = normalizePortLabel(portDoc.portNumber);
  if (!switchId || !portLabel) return;

  const existing = await Cable.findOne({
    cableType: 'Network',
    'network.sourceDevice.deviceType': 'Switch',
    'network.sourceDevice.deviceId': switchId,
    'network.sourceDevice.port': portLabel,
    notes: { $regex: `^${escapeRegExp(AUTO_CABLE_NOTE_PREFIX)}` },
  }).select('_id').lean();

  if (!existing) return;
  await Cable.findByIdAndDelete(existing._id);
  try {
    await logAction(userId, 'DELETE', 'Cable', existing._id, { auto: true }, ip);
  } catch {
    // ignore audit failures
  }
};

const ensureSwitchPortsExist = async (switchId) => {
  const sw = await Switch.findById(switchId).select('totalPorts').lean();
  if (!sw) return;

  const rawTotal = sw.totalPorts;
  const numericTotal = (() => {
    const n = Number(rawTotal);
    if (Number.isFinite(n)) return n;
    const m = String(rawTotal ?? '').match(/(\d+)/);
    return m ? Number(m[1]) : 0;
  })();

  const totalPorts = Math.max(1, Math.floor(numericTotal || 0));
  if (!Number.isFinite(totalPorts) || totalPorts <= 0) return;

  const existingCount = await NetworkPort.countDocuments({ switch: switchId });
  if (existingCount >= totalPorts) return;

  const docs = [];

  if (existingCount === 0) {
    for (let i = 1; i <= totalPorts; i += 1) {
      docs.push({
        portNumber: `Port ${i}`,
        switch: switchId,
        vlanId: 100,
        vlanTag: 'VLAN-100',
        portType: 'Access',
        status: 'Down',
      });
    }
  } else {
    const existing = await NetworkPort.find({ switch: switchId }).select('portNumber').lean();
    const used = new Set(existing.map((p) => extractPortIndex(p.portNumber)).filter(Boolean));
    for (let i = 1; i <= totalPorts; i += 1) {
      if (used.has(i)) continue;
      docs.push({
        portNumber: `Port ${i}`,
        switch: switchId,
        vlanId: 100,
        vlanTag: 'VLAN-100',
        portType: 'Access',
        status: 'Down',
      });
    }
  }

  if (docs.length === 0) return;

  try {
    await NetworkPort.insertMany(docs, { ordered: false });
  } catch (err) {
    // Ignore duplicate key errors (idempotent behavior)
    if (err?.code !== 11000) throw err;
  }
};

const buildPortNumberSortPipeline = ({ filter, order, skip, limit }) => {
  const portIndexExpr = {
    $let: {
      vars: {
        m: {
          $regexFind: {
            input: '$portNumber',
            regex: /(\d+)\s*$/
          }
        }
      },
      in: {
        $convert: {
          input: { $arrayElemAt: [{ $ifNull: ['$$m.captures', []] }, 0] },
          to: 'int',
          onError: 2147483647,
          onNull: 2147483647
        }
      }
    }
  };

  return [
    { $match: filter },
    { $addFields: { __portIndex: portIndexExpr } },
    { $sort: { __portIndex: order, portNumber: order, _id: 1 } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: 'switches',
              localField: 'switch',
              foreignField: '_id',
              as: 'switch'
            }
          },
          { $unwind: { path: '$switch', preserveNullAndEmptyArrays: true } },
          { $project: { __portIndex: 0 } }
        ],
        totalItems: [{ $count: 'count' }]
      }
    }
  ];
};

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const { switch: switchIdRaw, switchId, serverId, status, vlanId, portType, search } = req.query;
    const filter = {};

    const normalizedSwitchId = normalizeObjectId(switchId || switchIdRaw);
    if (normalizedSwitchId) filter.switch = normalizedSwitchId;

    const normalizedServerId = normalizeObjectId(serverId);
    if (normalizedServerId) {
      filter['connectedDevice.deviceType'] = 'Server';
      filter['connectedDevice.deviceId'] = normalizedServerId;
    }

    if (normalizedSwitchId) {
      await ensureSwitchPortsExist(normalizedSwitchId);
    }

    if (status) filter.status = status;
    if (vlanId) filter.vlanId = Number(vlanId);
    if (portType) filter.portType = portType;
    if (search) {
      filter.$or = [
        { portNumber: { $regex: search, $options: 'i' } },
        { ipAddress: { $regex: search, $options: 'i' } },
        { vlanTag: { $regex: search, $options: 'i' } },
      ];
    }

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['portNumber', 'ipAddress', 'vlanId', 'status', 'createdAt']);

    let payload;

    // Special-case: sort by portNumber should be numeric-aware (Port 2 before Port 10)
    if (sortBy === 'portNumber') {
      const aggFilter = { ...filter };
      if (aggFilter.switch && typeof aggFilter.switch === 'string' && mongoose.Types.ObjectId.isValid(aggFilter.switch)) {
        aggFilter.switch = new mongoose.Types.ObjectId(aggFilter.switch);
      }
      if (
        aggFilter['connectedDevice.deviceId'] &&
        typeof aggFilter['connectedDevice.deviceId'] === 'string' &&
        mongoose.Types.ObjectId.isValid(aggFilter['connectedDevice.deviceId'])
      ) {
        aggFilter['connectedDevice.deviceId'] = new mongoose.Types.ObjectId(aggFilter['connectedDevice.deviceId']);
      }

      try {
        const agg = await NetworkPort.aggregate(
          buildPortNumberSortPipeline({ filter: aggFilter, order, skip, limit })
        );
        const first = agg?.[0] || {};
        const items = first.items || [];
        const totalItems = first.totalItems?.[0]?.count || 0;

        payload = {
          items,
          pagination: {
            page,
            limit,
            totalItems,
            totalPages: Math.max(Math.ceil(totalItems / limit), 1),
            hasNextPage: page * limit < totalItems,
            hasPrevPage: page > 1
          }
        };
      } catch (aggErr) {
        // Fallback for older MongoDB versions that don't support $regexFind
        const all = await NetworkPort.find(filter)
          .populate({ path: 'switch', select: 'name ipAddress brand model uStart rack datacenter' })
          .lean();

        const sorted = Array.isArray(all)
          ? [...all].sort((a, b) => {
              const ai = extractPortIndex(a?.portNumber) ?? Number.POSITIVE_INFINITY;
              const bi = extractPortIndex(b?.portNumber) ?? Number.POSITIVE_INFINITY;
              return order === 1 ? ai - bi : bi - ai;
            })
          : [];

        const totalItems = sorted.length;
        const items = sorted.slice(skip, skip + limit);
        payload = {
          items,
          pagination: {
            page,
            limit,
            totalItems,
            totalPages: Math.max(Math.ceil(totalItems / limit), 1),
            hasNextPage: page * limit < totalItems,
            hasPrevPage: page > 1
          }
        };
      }
    } else {
      payload = await buildPaginatedPayload({
        model: NetworkPort,
        filter,
        populate: [{ path: 'switch', select: 'name ipAddress brand model uStart rack datacenter' }],
        sort,
        page,
        limit,
        skip
      });
    }

    return successResponse(res, {
      ...payload,
      filters: {
        switchId: normalizedSwitchId || null,
        serverId: normalizedServerId || null,
        status: status || null,
        vlanId: vlanId || null,
        portType: portType || null,
        search: search || null
      },
      sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const port = await NetworkPort.findById(req.params.id)
      .populate('switch', 'name ipAddress brand model uStart rack datacenter');

    if (!port) return errorResponse(res, 'Network port not found', 404);
    return successResponse(res, port);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

// Allow manual status toggle (limited mutation)
router.patch('/:id/status', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status || !['Up', 'Down'].includes(status)) {
      return errorResponse(res, 'Invalid status (must be Up or Down)', 400);
    }

    const updated = await NetworkPort.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true, runValidators: true }
    );

    if (!updated) return errorResponse(res, 'Network port not found', 404);
    await logAction(req.user.id, 'UPDATE', 'NetworkPort', updated._id, { status }, req.ip);
    return successResponse(res, updated, 'Network port status updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.patch('/:id/speed', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const { speedGbps } = req.body || {};

    if (speedGbps === '' || speedGbps === null || speedGbps === undefined) {
      const updated = await NetworkPort.findByIdAndUpdate(
        req.params.id,
        { $unset: { speedGbps: 1 } },
        { new: true }
      );
      if (!updated) return errorResponse(res, 'Network port not found', 404);
      await logAction(req.user.id, 'UPDATE', 'NetworkPort', updated._id, { speedGbps: null }, req.ip);
      return successResponse(res, updated, 'Network port speed cleared');
    }

    const parsed = Number(speedGbps);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return errorResponse(res, 'Invalid speedGbps', 400);
    }

    const updated = await NetworkPort.findByIdAndUpdate(
      req.params.id,
      { $set: { speedGbps: parsed } },
      { new: true, runValidators: true }
    );

    if (!updated) return errorResponse(res, 'Network port not found', 404);
    await logAction(req.user.id, 'UPDATE', 'NetworkPort', updated._id, { speedGbps: parsed }, req.ip);
    return successResponse(res, updated, 'Network port speed updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.patch('/:id/connection', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const { deviceType, deviceName } = req.body || {};

    const name = typeof deviceName === 'string' ? deviceName.trim() : '';
    if (!name) {
      const before = await NetworkPort.findById(req.params.id).select('switch portNumber').lean();

      const updated = await NetworkPort.findByIdAndUpdate(
        req.params.id,
        { $unset: { connectedDevice: 1 } },
        { new: true }
      );
      if (!updated) return errorResponse(res, 'Network port not found', 404);

      try {
        await deleteAutoCableForPort({ portDoc: before, userId: req.user.id, ip: req.ip });
      } catch {
        // keep request successful
      }

      await logAction(req.user.id, 'UPDATE', 'NetworkPort', updated._id, { connectedDevice: null }, req.ip);
      return successResponse(res, updated, 'Network port connection cleared');
    }

    const type = typeof deviceType === 'string' ? deviceType.trim() : 'Other';
    const allowedTypes = ['Server', 'Switch', 'StorageBay', 'Other'];
    const safeType = allowedTypes.includes(type) ? type : 'Other';

    const resolvedDeviceId = safeType === 'Other'
      ? null
      : await resolveDeviceIdByName({ deviceType: safeType, deviceName: name });

    const updated = await NetworkPort.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          connectedDevice: {
            deviceType: safeType,
            deviceName: name,
            ...(resolvedDeviceId ? { deviceId: resolvedDeviceId } : {}),
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!updated) return errorResponse(res, 'Network port not found', 404);

    try {
      await upsertAutoCableForPort({ portDoc: updated, userId: req.user.id, ip: req.ip });
    } catch {
      // keep request successful
    }

    await logAction(req.user.id, 'UPDATE', 'NetworkPort', updated._id, { connectedDevice: { deviceType: safeType, deviceName: name } }, req.ip);
    return successResponse(res, updated, 'Network port connection updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.patch('/:id/notes', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const raw = req.body?.notes;
    const notes = raw === null || raw === undefined ? '' : String(raw);
    const trimmed = notes.trim();

    const updated = await NetworkPort.findByIdAndUpdate(
      req.params.id,
      trimmed
        ? { $set: { notes: trimmed } }
        : { $set: { notes: '' } },
      { new: true, runValidators: true }
    );

    if (!updated) return errorResponse(res, 'Network port not found', 404);

    await logAction(req.user.id, 'UPDATE', 'NetworkPort', updated._id, { notes: trimmed }, req.ip);
    return successResponse(res, updated, 'Network port notes updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.post('/', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const payload = {
      ...req.body,
      switch: normalizeObjectId(req.body.switch),
      connectedDevice: req.body.connectedDevice
        ? {
            ...req.body.connectedDevice,
            deviceId: normalizeObjectId(req.body.connectedDevice.deviceId),
          }
        : undefined,
    };

    if (!payload.switch) {
      return errorResponse(res, 'Switch is required', 400);
    }

    const created = await NetworkPort.create(payload);
    await logAction(req.user.id, 'CREATE', 'NetworkPort', created._id, payload, req.ip);
    return successResponse(res, created, 'Network port created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Port already exists on this switch', 409);
    return errorResponse(res, err.message, 500);
  }
});

router.put('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const switchId = normalizeObjectId(req.body.switch);
    const payload = {
      ...req.body,
      ...(switchId ? { switch: switchId } : {}),
      connectedDevice: req.body.connectedDevice
        ? {
            ...req.body.connectedDevice,
            deviceId: normalizeObjectId(req.body.connectedDevice.deviceId),
          }
        : undefined,
    };

    const updated = await NetworkPort.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );

    if (!updated) return errorResponse(res, 'Network port not found', 404);
    await logAction(req.user.id, 'UPDATE', 'NetworkPort', updated._id, payload, req.ip);
    return successResponse(res, updated, 'Network port updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Port already exists on this switch', 409);
    return errorResponse(res, err.message, 500);
  }
});

router.delete('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const deleted = await NetworkPort.findByIdAndDelete(req.params.id);
    if (!deleted) return errorResponse(res, 'Network port not found', 404);
    await logAction(req.user.id, 'DELETE', 'NetworkPort', req.params.id, {}, req.ip);
    return successResponse(res, null, 'Network port deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
