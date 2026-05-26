const mongoose = require('mongoose');
const NetworkPort = require('../models/NetworkPort');
const Switch = require('../models/Switch');
const Cable = require('../models/Cable');
const Server = require('../models/Server');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const Firewall = require('../models/Firewall');
const { normalizeObjectId } = require('../utils/normalizeRefs');
const { logAction } = require('../utils/auditLog');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

const SORT_FIELDS = ['portNumber', 'ipAddress', 'vlanId', 'status', 'createdAt'];
const AUTO_CABLE_NOTE_PREFIX = '[AUTO] NetworkPort connection';

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

const listPorts = async (query) => {
  const { switch: switchIdRaw, switchId, serverId, status, vlanId, portType, search } = query;
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

  const { page, limit, skip } = parsePagination(query);
  const { sortBy, order, sort } = parseSort(query, SORT_FIELDS);

  let payload;

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

  return {
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
  };
};

const getPortById = async (id) => {
  const port = await NetworkPort.findById(id)
    .populate('switch', 'name ipAddress brand model uStart rack datacenter');

  if (!port) {
    const err = new Error('Network port not found');
    err.statusCode = 404;
    throw err;
  }

  return port;
};

const updateStatus = async ({ id, status, userId, ip }) => {
  if (!status || !['Up', 'Down'].includes(status)) {
    const err = new Error('Invalid status (must be Up or Down)');
    err.statusCode = 400;
    throw err;
  }

  const updated = await NetworkPort.findByIdAndUpdate(
    id,
    { $set: { status } },
    { new: true, runValidators: true }
  );

  if (!updated) {
    const err = new Error('Network port not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'UPDATE', 'NetworkPort', updated._id, { status }, ip);
  return { data: updated, message: 'Network port status updated' };
};

const updateSpeed = async ({ id, speedGbps, userId, ip }) => {
  if (speedGbps === '' || speedGbps === null || speedGbps === undefined) {
    const updated = await NetworkPort.findByIdAndUpdate(
      id,
      { $unset: { speedGbps: 1 } },
      { new: true }
    );
    if (!updated) {
      const err = new Error('Network port not found');
      err.statusCode = 404;
      throw err;
    }
    await logAction(userId, 'UPDATE', 'NetworkPort', updated._id, { speedGbps: null }, ip);
    return { data: updated, message: 'Network port speed cleared' };
  }

  const parsed = Number(speedGbps);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const err = new Error('Invalid speedGbps');
    err.statusCode = 400;
    throw err;
  }

  const updated = await NetworkPort.findByIdAndUpdate(
    id,
    { $set: { speedGbps: parsed } },
    { new: true, runValidators: true }
  );

  if (!updated) {
    const err = new Error('Network port not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'UPDATE', 'NetworkPort', updated._id, { speedGbps: parsed }, ip);
  return { data: updated, message: 'Network port speed updated' };
};

const updateConnection = async ({ id, deviceType, deviceName, userId, ip }) => {
  const name = typeof deviceName === 'string' ? deviceName.trim() : '';
  if (!name) {
    const before = await NetworkPort.findById(id).select('switch portNumber').lean();

    const updated = await NetworkPort.findByIdAndUpdate(
      id,
      { $unset: { connectedDevice: 1 } },
      { new: true }
    );
    if (!updated) {
      const err = new Error('Network port not found');
      err.statusCode = 404;
      throw err;
    }

    try {
      await deleteAutoCableForPort({ portDoc: before, userId, ip });
    } catch {
      // keep request successful
    }

    await logAction(userId, 'UPDATE', 'NetworkPort', updated._id, { connectedDevice: null }, ip);
    return { data: updated, message: 'Network port connection cleared' };
  }

  const type = typeof deviceType === 'string' ? deviceType.trim() : 'Other';
  const allowedTypes = ['Server', 'Switch', 'StorageBay', 'Other'];
  const safeType = allowedTypes.includes(type) ? type : 'Other';

  const resolvedDeviceId = safeType === 'Other'
    ? null
    : await resolveDeviceIdByName({ deviceType: safeType, deviceName: name });

  const updated = await NetworkPort.findByIdAndUpdate(
    id,
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

  if (!updated) {
    const err = new Error('Network port not found');
    err.statusCode = 404;
    throw err;
  }

  try {
    await upsertAutoCableForPort({ portDoc: updated, userId, ip });
  } catch {
    // keep request successful
  }

  await logAction(userId, 'UPDATE', 'NetworkPort', updated._id, {
    connectedDevice: { deviceType: safeType, deviceName: name }
  }, ip);

  return { data: updated, message: 'Network port connection updated' };
};

const updateNotes = async ({ id, notes, userId, ip }) => {
  const raw = notes;
  const safeNotes = raw === null || raw === undefined ? '' : String(raw);
  const trimmed = safeNotes.trim();

  const updated = await NetworkPort.findByIdAndUpdate(
    id,
    trimmed ? { $set: { notes: trimmed } } : { $set: { notes: '' } },
    { new: true, runValidators: true }
  );

  if (!updated) {
    const err = new Error('Network port not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'UPDATE', 'NetworkPort', updated._id, { notes: trimmed }, ip);
  return { data: updated, message: 'Network port notes updated' };
};

const createPort = async ({ body, userId, ip }) => {
  const payload = {
    ...body,
    switch: normalizeObjectId(body.switch),
    connectedDevice: body.connectedDevice
      ? {
          ...body.connectedDevice,
          deviceId: normalizeObjectId(body.connectedDevice.deviceId),
        }
      : undefined,
  };

  if (!payload.switch) {
    const err = new Error('Switch is required');
    err.statusCode = 400;
    throw err;
  }

  const created = await NetworkPort.create(payload);
  await logAction(userId, 'CREATE', 'NetworkPort', created._id, payload, ip);
  return created;
};

const updatePort = async ({ id, body, userId, ip }) => {
  const switchId = normalizeObjectId(body.switch);
  const payload = {
    ...body,
    ...(switchId ? { switch: switchId } : {}),
    connectedDevice: body.connectedDevice
      ? {
          ...body.connectedDevice,
          deviceId: normalizeObjectId(body.connectedDevice.deviceId),
        }
      : undefined,
  };

  const updated = await NetworkPort.findByIdAndUpdate(
    id,
    payload,
    { new: true, runValidators: true }
  );

  if (!updated) {
    const err = new Error('Network port not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'UPDATE', 'NetworkPort', updated._id, payload, ip);
  return updated;
};

const deletePort = async ({ id, userId, ip }) => {
  const deleted = await NetworkPort.findByIdAndDelete(id);
  if (!deleted) {
    const err = new Error('Network port not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'DELETE', 'NetworkPort', id, {}, ip);
  return null;
};

module.exports = {
  listPorts,
  getPortById,
  updateStatus,
  updateSpeed,
  updateConnection,
  updateNotes,
  createPort,
  updatePort,
  deletePort,
};
