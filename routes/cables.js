const express = require('express');
const router = express.Router();
const Cable = require('../models/Cable');
const NetworkPort = require('../models/NetworkPort');
const Switch = require('../models/Switch');
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

const normalizePortLabel = (value) => {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return `Port ${raw}`;
  const m = raw.match(/^\s*port\s*(\d+)\s*$/i);
  if (m) return `Port ${m[1]}`;
  return raw;
};

const resolveDeviceName = async (deviceType, deviceId) => {
  if (!deviceType) return '';
  if (!deviceId) return deviceType;
  try {
    const modelMap = {
      Switch,
      Server,
      StorageBay,
      DataDomain,
      Firewall,
    };
    const model = modelMap[deviceType];
    if (!model) return deviceType;
    const doc = await model.findById(deviceId).select('name').lean();
    return doc?.name || deviceType;
  } catch {
    return deviceType;
  }
};

const connectSwitchPort = async ({ switchId, port, peer, cableNetwork }) => {
  const normalizedSwitchId = normalizeObjectId(switchId);
  const portNumber = normalizePortLabel(port);
  if (!normalizedSwitchId || !portNumber) return;

  const peerId = normalizeObjectId(peer?.deviceId);
  const peerType = peer?.deviceType;
  const peerName = await resolveDeviceName(peerType, peerId);
  const peerPort = typeof peer?.port === 'string' ? peer.port.trim() : (peer?.port ? String(peer.port).trim() : '');

  const isTrunk = peerType === 'Switch';
  const speedGbps = typeof cableNetwork?.speedGbps === 'number' ? cableNetwork.speedGbps : null;

  const vlanIdRaw = cableNetwork?.vlanId;
  const vlanId = vlanIdRaw === undefined || vlanIdRaw === null || vlanIdRaw === '' ? null : Number(vlanIdRaw);
  const vlanTagRaw = typeof cableNetwork?.vlanTag === 'string' ? cableNetwork.vlanTag.trim() : '';
  const vlanTag = vlanTagRaw || (vlanId ? `VLAN-${vlanId}` : '');

  const update = {
    $set: {
      connectedDevice: {
        deviceType: peerType,
        deviceId: peerId,
        deviceName: peerName,
      },
      status: 'Up',
      portType: isTrunk ? 'Trunk' : 'Access',
      vlanTag: isTrunk ? 'TRUNK' : (vlanTag || 'VLAN-100'),
      ...(isTrunk ? {} : { vlanId: Number.isFinite(vlanId) ? vlanId : 100 }),
      ...(speedGbps !== null ? { speedGbps } : {}),
      ...(peerType === 'Server' && peerPort ? { networkCard: peerPort } : {}),
    },
    $setOnInsert: {
      switch: normalizedSwitchId,
      portNumber,
    },
    $unset: {
      ...(isTrunk ? { vlanId: 1 } : {}),
      ...(speedGbps === null ? { speedGbps: 1 } : {}),
    }
  };

  await NetworkPort.findOneAndUpdate(
    { switch: normalizedSwitchId, portNumber },
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const disconnectSwitchPort = async ({ switchId, port }) => {
  const normalizedSwitchId = normalizeObjectId(switchId);
  const portNumber = normalizePortLabel(port);
  if (!normalizedSwitchId || !portNumber) return;

  await NetworkPort.findOneAndUpdate(
    { switch: normalizedSwitchId, portNumber },
    {
      $set: { status: 'Down', portType: 'Access', vlanId: 100, vlanTag: 'VLAN-100' },
      $unset: { connectedDevice: 1, speedGbps: 1, networkCard: 1 }
    },
    { new: true }
  );
};

const syncCableToPorts = async (cable) => {
  if (!cable || cable.cableType !== 'Network') return;
  const src = cable.network?.sourceDevice;
  const dst = cable.network?.destDevice;

  if (src?.deviceType === 'Switch') {
    await connectSwitchPort({
      switchId: src.deviceId,
      port: src.port,
      peer: dst,
      cableNetwork: cable.network,
    });
  }
  if (dst?.deviceType === 'Switch') {
    await connectSwitchPort({
      switchId: dst.deviceId,
      port: dst.port,
      peer: src,
      cableNetwork: cable.network,
    });
  }
};

const clearCableFromPorts = async (cable) => {
  if (!cable || cable.cableType !== 'Network') return;
  const src = cable.network?.sourceDevice;
  const dst = cable.network?.destDevice;

  if (src?.deviceType === 'Switch') {
    await disconnectSwitchPort({ switchId: src.deviceId, port: src.port });
  }
  if (dst?.deviceType === 'Switch') {
    await disconnectSwitchPort({ switchId: dst.deviceId, port: dst.port });
  }
};

router.use(protect, authorize('admin', 'net_operator'));

router.get('/', async (req, res) => {
  try {
    const { cableType, medium, deviceId, search } = req.query;
    const filter = {};

    if (cableType) filter.cableType = cableType;
    if (medium) filter['network.medium'] = medium;

    const normalizedDeviceId = normalizeObjectId(deviceId);
    if (normalizedDeviceId) {
      filter.$or = [
        { 'network.sourceDevice.deviceId': normalizedDeviceId },
        { 'network.destDevice.deviceId': normalizedDeviceId },
        { 'power.poweredDevice.deviceId': normalizedDeviceId },
      ];
    }

    if (search) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { 'network.sourceDevice.port': { $regex: search, $options: 'i' } },
          { 'network.destDevice.port': { $regex: search, $options: 'i' } },
          { 'power.pdu': { $regex: search, $options: 'i' } },
          { 'power.pduPort': { $regex: search, $options: 'i' } },
          { notes: { $regex: search, $options: 'i' } },
        ],
      });
    }

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['createdAt', 'cableType']);

    const payload = await buildPaginatedPayload({
      model: Cable,
      filter,
      sort,
      page,
      limit,
      skip
    });

    return successResponse(res, {
      ...payload,
      filters: {
        cableType: cableType || null,
        medium: medium || null,
        deviceId: normalizeObjectId(deviceId) || null,
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
    const cable = await Cable.findById(req.params.id);
    if (!cable) return errorResponse(res, 'Cable not found', 404);
    return successResponse(res, cable);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const payload = {
      ...req.body,
      network: req.body.network
        ? {
            ...req.body.network,
            sourceDevice: req.body.network.sourceDevice
              ? {
                  ...req.body.network.sourceDevice,
                  deviceId: normalizeObjectId(req.body.network.sourceDevice.deviceId),
                }
              : undefined,
            destDevice: req.body.network.destDevice
              ? {
                  ...req.body.network.destDevice,
                  deviceId: normalizeObjectId(req.body.network.destDevice.deviceId),
                }
              : undefined,
          }
        : undefined,
      power: req.body.power
        ? {
            ...req.body.power,
            poweredDevice: req.body.power.poweredDevice
              ? {
                  ...req.body.power.poweredDevice,
                  deviceId: normalizeObjectId(req.body.power.poweredDevice.deviceId),
                }
              : undefined,
          }
        : undefined,
      createdBy: req.user.id,
    };

    const created = await Cable.create(payload);
    await syncCableToPorts(created);
    await logAction(req.user.id, 'CREATE', 'Cable', created._id, payload, req.ip);
    return successResponse(res, created, 'Cable created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.put('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const existing = await Cable.findById(req.params.id);
    if (!existing) return errorResponse(res, 'Cable not found', 404);

    const payload = {
      ...req.body,
      network: req.body.network
        ? {
            ...req.body.network,
            sourceDevice: req.body.network.sourceDevice
              ? {
                  ...req.body.network.sourceDevice,
                  deviceId: normalizeObjectId(req.body.network.sourceDevice.deviceId),
                }
              : undefined,
            destDevice: req.body.network.destDevice
              ? {
                  ...req.body.network.destDevice,
                  deviceId: normalizeObjectId(req.body.network.destDevice.deviceId),
                }
              : undefined,
          }
        : undefined,
      power: req.body.power
        ? {
            ...req.body.power,
            poweredDevice: req.body.power.poweredDevice
              ? {
                  ...req.body.power.poweredDevice,
                  deviceId: normalizeObjectId(req.body.power.poweredDevice.deviceId),
                }
              : undefined,
          }
        : undefined,
    };

    await clearCableFromPorts(existing);

    const updated = await Cable.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );

    await syncCableToPorts(updated);
    await logAction(req.user.id, 'UPDATE', 'Cable', updated._id, payload, req.ip);
    return successResponse(res, updated, 'Cable updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.delete('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const existing = await Cable.findById(req.params.id);
    if (!existing) return errorResponse(res, 'Cable not found', 404);

    await clearCableFromPorts(existing);

    const deleted = await Cable.findByIdAndDelete(req.params.id);
    if (!deleted) return errorResponse(res, 'Cable not found', 404);
    await logAction(req.user.id, 'DELETE', 'Cable', req.params.id, {}, req.ip);
    return successResponse(res, null, 'Cable deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
