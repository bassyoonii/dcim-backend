const Rack = require('../models/Rack');
const Server = require('../models/Server');
const Switch = require('../models/Switch');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const NetworkPort = require('../models/NetworkPort');
const Cable = require('../models/Cable');
const mongoose = require('mongoose');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { logAction } = require('../utils/auditLog');
const { parsePagination, parseSort } = require('../utils/queryHelpers');

const normalizeRefId = (value) => {
  if (!value) return undefined;

  if (typeof value === 'object' && value?._id) {
    return mongoose.Types.ObjectId.isValid(value._id) ? value._id : undefined;
  }

  if (typeof value === 'string') {
    if (value === '[object Object]') return undefined;
    if (value.startsWith('{') && value.endsWith('}')) {
      try {
        const parsed = JSON.parse(value);
        const candidate = parsed?._id;
        return mongoose.Types.ObjectId.isValid(candidate) ? candidate : undefined;
      } catch (_) {
        return undefined;
      }
    }
    return mongoose.Types.ObjectId.isValid(value) ? value : undefined;
  }

  return undefined;
};

// GET /api/racks
const getRacks = async (req, res) => {
  try {
    const { datacenter, datacenterId, search, status } = req.query;
    const filter = {};

    const resolvedDatacenterId = normalizeRefId(datacenterId || datacenter);

    if (resolvedDatacenterId) filter.datacenter = resolvedDatacenterId;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [{ name: { $regex: search, $options: 'i' } }];
    }

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['name', 'totalU', 'occupiedU', 'status', 'createdAt']);

    console.log('[Rack:getRacks] Request query', {
      rawDatacenter: datacenter,
      normalizedDatacenter: resolvedDatacenterId,
      search,
      filter,
    });

    const [racks, totalItems] = await Promise.all([
      Rack.find(filter)
      .populate('datacenter', 'name code')
      .sort(sort)
      .skip(skip)
      .limit(limit),
      Rack.countDocuments(filter)
    ]);

    console.log('[Rack:getRacks] Returning racks', {
      count: racks.length,
      rackIds: racks.map((r) => r._id.toString()),
    });

    return successResponse(res, {
      items: racks,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.max(Math.ceil(totalItems / limit), 1),
        hasNextPage: page * limit < totalItems,
        hasPrevPage: page > 1
      },
      filters: {
        datacenterId: resolvedDatacenterId || null,
        status: status || null,
        search: search || null
      },
      sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
    });
  } catch (err) {
    console.error('[Rack:getRacks] Failed', {
      message: err.message,
      query: req.query,
      stack: err.stack,
    });
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/racks/:id
const getRack = async (req, res) => {
  try {
    const rack = await Rack.findById(req.params.id)
      .populate('datacenter', 'name code')
      .populate('createdBy', 'name email');

    if (!rack) return errorResponse(res, 'Rack not found', 404);
    return successResponse(res, rack);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// POST /api/racks
const createRack = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.error('[Rack:create] MongoDB is not connected. readyState=', mongoose.connection.readyState);
      return errorResponse(res, 'Database is not connected', 503);
    }

    const datacenter = typeof req.body.datacenter === 'object'
      ? req.body.datacenter?._id
      : req.body.datacenter;

    if (!datacenter) {
      return errorResponse(res, 'Datacenter is required', 400);
    }

    const payload = {
      ...req.body,
      datacenter,
      createdBy: req.user.id,
    };

    const rack = new Rack(payload);
    await rack.save();

    const persisted = await Rack.exists({ _id: rack._id });
    if (!persisted) {
      console.error('[Rack:create] Save returned but document not found', {
        rackId: rack._id,
        payload,
      });
      return errorResponse(res, 'Rack save verification failed', 500);
    }

    console.log('[Rack:create] Rack persisted', {
      rackId: rack._id,
      name: rack.name,
      datacenter: rack.datacenter,
    });

    await logAction(req.user.id, 'CREATE', 'Rack', rack._id, req.body, req.ip);

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
    return errorResponse(res, err.message, 500);
  }
};

// PUT /api/racks/:id
const updateRack = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.error('[Rack:update] MongoDB is not connected. readyState=', mongoose.connection.readyState);
      return errorResponse(res, 'Database is not connected', 503);
    }

    const datacenter = typeof req.body.datacenter === 'object'
      ? req.body.datacenter?._id
      : req.body.datacenter;

    const payload = {
      ...req.body,
      ...(datacenter ? { datacenter } : {}),
    };

    const rack = await Rack.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );

    if (!rack) return errorResponse(res, 'Rack not found', 404);

    await logAction(req.user.id, 'UPDATE', 'Rack', rack._id, req.body, req.ip);

    console.log('[Rack:update] Rack updated', {
      rackId: rack._id,
      name: rack.name,
      datacenter: rack.datacenter,
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
    return errorResponse(res, err.message, 500);
  }
};

// DELETE /api/racks/:id
const deleteRack = async (req, res) => {
  try {
    const rack = await Rack.findByIdAndDelete(req.params.id);

    if (!rack) return errorResponse(res, 'Rack not found', 404);

    await logAction(req.user.id, 'DELETE', 'Rack', req.params.id, {}, req.ip);

    return successResponse(res, null, 'Rack deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
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
    power: {
      maxW: rack.maxPowerConsumption || 0,
      currentW: rack.currentPowerConsumption || 0,
      utilizationPct: rack.maxPowerConsumption
        ? Number((((rack.currentPowerConsumption || 0) / rack.maxPowerConsumption) * 100).toFixed(2))
        : 0,
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
    const rack = await Rack.findById(req.params.id)
      .populate('datacenter', 'name code')
      .lean();

    if (!rack) return errorResponse(res, 'Rack not found', 404);

    const topology = await loadRackTopology(rack);

    return successResponse(res, {
      rack: {
        id: rack._id,
        name: rack.name,
        datacenter: rack.datacenter,
      },
      occupancy: topology.occupancy,
      power: topology.power,
      ports: topology.portsSummary,
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/racks/:id/topology
const getRackTopology = async (req, res) => {
  try {
    const rack = await Rack.findById(req.params.id)
      .populate('datacenter', 'name code')
      .lean();

    if (!rack) return errorResponse(res, 'Rack not found', 404);

    const topology = await loadRackTopology(rack);

    return successResponse(res, {
      rack: {
        id: rack._id,
        name: rack.name,
        totalU: rack.totalU,
        datacenter: rack.datacenter,
      },
      ports: topology.ports,
      cables: topology.cables,
      topology: topology.topology,
      portsSummary: topology.portsSummary,
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/racks/:id/3d
const getRack3DData = async (req, res) => {
  try {
    const rack = await Rack.findById(req.params.id)
      .populate('datacenter', 'name code')
      .lean();

    if (!rack) return errorResponse(res, 'Rack not found', 404);

    const topology = await loadRackTopology(rack);

    return successResponse(res, {
      rack: {
        id: rack._id,
        name: rack.name,
        totalU: rack.totalU,
        datacenter: rack.datacenter,
      },
      equipment: topology.equipment,
      occupancy: topology.occupancy,
      power: topology.power,
      ports: topology.ports,
      portsSummary: topology.portsSummary,
      cables: topology.cables,
      topology: topology.topology,
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
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
