const rackService = require('../services/rackService');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const handleError = (res, err) => {
  const status = err.statusCode || 500;
  return errorResponse(res, err.message, status);
};

// GET /api/racks
const getRacks = async (req, res) => {
  try {
    const payload = await rackService.getRacks(req.query);
    return successResponse(res, payload);
  } catch (err) {
    console.error('[Rack:getRacks] Failed', {
      message: err.message,
      query: req.query,
      stack: err.stack,
    });
    return handleError(res, err);
  }
};

// GET /api/racks/:id
const getRack = async (req, res) => {
  try {
    const rack = await rackService.getRackById(req.params.id);
    return successResponse(res, rack);
  } catch (err) {
    return handleError(res, err);
  }
};

// POST /api/racks
const createRack = async (req, res) => {
  try {
    const rack = await rackService.createRack({
      body: req.body,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, rack, 'Rack created', 201);
  } catch (err) {
    console.error('[Rack:create] Failed to save rack', {
      message: err.message,
      body: req.body,
      stack: err.stack,
    });

    if (err.name === 'ValidationError') {
      return errorResponse(res, err.message, 400);
    }
    if (err.code === 11000) {
      return errorResponse(res, 'Rack name already exists in this datacenter', 409);
    }
    return handleError(res, err);
  }
};

// PUT /api/racks/:id
const updateRack = async (req, res) => {
  try {
    const rack = await rackService.updateRack({
      id: req.params.id,
      body: req.body,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, rack, 'Rack updated');
  } catch (err) {
    console.error('[Rack:update] Failed to update rack', {
      message: err.message,
      rackId: req.params.id,
      body: req.body,
      stack: err.stack,
    });

    if (err.name === 'ValidationError') {
      return errorResponse(res, err.message, 400);
    }
    if (err.code === 11000) {
      return errorResponse(res, 'Rack name already exists in this datacenter', 409);
    }
    return handleError(res, err);
  }
};

// DELETE /api/racks/:id
const deleteRack = async (req, res) => {
  try {
    await rackService.deleteRack({
      id: req.params.id,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, null, 'Rack deleted');
  } catch (err) {
    return handleError(res, err);
  }
};

const loadRackTopology = async (rack) => {
  const [servers, switches, storage, dataDomains] = await Promise.all([
    Server.find({ rack: rack._id })
      .select('name uStart uEnd role brand model power ramGB status state operationalStatus health')
      .lean(),
    Switch.find({ rack: rack._id })
      .select('name uStart uEnd type brand model ipAddress totalPorts usedPorts reservedPorts portSpeed')
      .lean(),
    StorageBay.find({ rack: rack._id })
      .select('name uStart uEnd storageType brand totalCapacityTB')
      .lean(),
    DataDomain.find({ rack: rack._id })
      .select('name uStart uEnd type model totalCapacityTB')
      .lean(),
  ]);

  const switchIds = switches.map((s) => s._id);
  const [ports, cables] = await Promise.all([
    switchIds.length
      ? NetworkPort.find({ switch: { $in: switchIds } })
        .select('portNumber switch speedGbps ipAddress vlanId vlanTag portType connectedDevice networkCard status description notes')
        .populate('switch', 'name ipAddress')
        .lean()
      : [],
    Cable.find({
      $or: [
        { 'network.sourceDevice.deviceId': { $in: switchIds } },
        { 'network.destDevice.deviceId': { $in: switchIds } },
        { 'power.poweredDevice.deviceId': { $in: switchIds } },
      ]
    })
      .select('cableType network power notes')
      .lean(),
  ]);

  const equipment = [
    ...servers.map((s) => ({ ...s, equipmentType: 'Server' })),
    ...switches.map((s) => ({ ...s, equipmentType: 'Switch' })),
    ...storage.map((s) => ({ ...s, equipmentType: 'Storage' })),
    ...dataDomains.map((s) => ({ ...s, equipmentType: 'DataDomain' })),
  ];

  const usedUSet = new Set();
  for (const item of equipment) {
    if (!item.uStart || !item.uEnd) continue;
    for (let u = item.uStart; u <= item.uEnd; u += 1) {
      usedUSet.add(u);
    }
  }

  const occupiedU = usedUSet.size;
  const freeU = Math.max((rack.totalU || 0) - occupiedU, 0);

  const totalPorts = switches.reduce((sum, s) => sum + (s.totalPorts || 0), 0);
  const usedPorts = switches.reduce((sum, s) => sum + (s.usedPorts || 0), 0);
  const reservedPorts = switches.reduce((sum, s) => sum + (s.reservedPorts || 0), 0);
  const upPorts = ports.filter((p) => p.status === 'Up').length;
  const downPorts = ports.filter((p) => p.status === 'Down').length;

  const topologyNodes = [
    ...servers.map((s) => ({ id: `server:${s._id}`, label: s.name, type: 'Server' })),
    ...switches.map((s) => ({ id: `switch:${s._id}`, label: s.name, type: 'Switch' })),
    ...storage.map((s) => ({ id: `storage:${s._id}`, label: s.name, type: 'Storage' })),
    ...dataDomains.map((s) => ({ id: `datadomain:${s._id}`, label: s.name, type: 'DataDomain' })),
  ];

  const topologyLinks = cables.map((c, i) => {
    if (c.cableType === 'Network') {
      const source = c.network?.sourceDevice;
      const target = c.network?.destDevice;
      return {
        id: `cable-net-${i}`,
        cableType: 'Network',
        source: source?.deviceId ? `${(source.deviceType || 'Other').toLowerCase()}:${source.deviceId}` : null,
        target: target?.deviceId ? `${(target.deviceType || 'Other').toLowerCase()}:${target.deviceId}` : null,
        speedGbps: c.network?.speedGbps || null,
        medium: c.network?.medium || null,
        color: c.network?.color || null,
      };
    }

    const target = c.power?.poweredDevice;
    return {
      id: `cable-power-${i}`,
      cableType: 'Power',
      source: `pdu:${c.power?.pdu || 'unknown'}:${c.power?.pduPort || 'unknown'}`,
      target: target?.deviceId ? `${(target.deviceType || 'Other').toLowerCase()}:${target.deviceId}` : null,
      medium: 'Power',
    };
  }).filter((l) => l.source && l.target);

  return {
    equipment,
    ports,
    cables,
    occupancy: {
      totalU: rack.totalU || 0,
      occupiedU,
      freeU,
      occupancyPct: rack.totalU ? Number(((occupiedU / rack.totalU) * 100).toFixed(2)) : 0,
      usedSlots: Array.from(usedUSet).sort((a, b) => a - b),
    },
    portsSummary: {
      total: totalPorts,
      used: usedPorts,
      reserved: reservedPorts,
      free: Math.max(totalPorts - usedPorts - reservedPorts, 0),
      up: upPorts,
      down: downPorts,
    },
    topology: {
      nodes: topologyNodes,
      links: topologyLinks,
    }
  };
};

// GET /api/racks/:id/occupancy
const getRackOccupancy = async (req, res) => {
  try {
    const payload = await rackService.getRackOccupancy(req.params.id);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/racks/:id/topology
const getRackTopology = async (req, res) => {
  try {
    const payload = await rackService.getRackTopology(req.params.id);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/racks/:id/3d
const getRack3DData = async (req, res) => {
  try {
    const payload = await rackService.getRack3DData(req.params.id);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = {
  getRacks,
  getRack,
  createRack,
  updateRack,
  deleteRack,
  getRackOccupancy,
  getRackTopology,
  getRack3DData,
};
