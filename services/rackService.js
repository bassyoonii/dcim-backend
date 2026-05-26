const mongoose = require('mongoose');
const Rack = require('../models/Rack');
const Server = require('../models/Server');
const Switch = require('../models/Switch');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const NetworkPort = require('../models/NetworkPort');
const Cable = require('../models/Cable');
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

const buildRackListFilter = ({ datacenter, datacenterId, search, status }) => {
  const filter = {};
  const resolvedDatacenterId = normalizeRefId(datacenterId || datacenter);

  if (resolvedDatacenterId) filter.datacenter = resolvedDatacenterId;
  if (status) filter.status = status;
  if (search) {
    filter.$or = [{ name: { $regex: search, $options: 'i' } }];
  }

  return { filter, resolvedDatacenterId };
};

const getRacks = async (query) => {
  const { datacenter, datacenterId, search, status } = query;
  const { filter, resolvedDatacenterId } = buildRackListFilter({ datacenter, datacenterId, search, status });

  const { page, limit, skip } = parsePagination(query);
  const { sortBy, order, sort } = parseSort(query, ['name', 'totalU', 'occupiedU', 'status', 'createdAt']);

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

  return {
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
  };
};

const getRackById = async (id) => {
  const rack = await Rack.findById(id)
    .populate('datacenter', 'name code')
    .populate('createdBy', 'name email');

  if (!rack) {
    const err = new Error('Rack not found');
    err.statusCode = 404;
    throw err;
  }

  return rack;
};

const createRack = async ({ body, userId, ip }) => {
  if (mongoose.connection.readyState !== 1) {
    const err = new Error('Database is not connected');
    err.statusCode = 503;
    throw err;
  }

  const datacenter = typeof body.datacenter === 'object'
    ? body.datacenter?._id
    : body.datacenter;

  if (!datacenter) {
    const err = new Error('Datacenter is required');
    err.statusCode = 400;
    throw err;
  }

  const payload = {
    ...body,
    datacenter,
    createdBy: userId,
  };

  const rack = new Rack(payload);
  await rack.save();

  const persisted = await Rack.exists({ _id: rack._id });
  if (!persisted) {
    const err = new Error('Rack save verification failed');
    err.statusCode = 500;
    throw err;
  }

  console.log('[Rack:create] Rack persisted', {
    rackId: rack._id,
    name: rack.name,
    datacenter: rack.datacenter,
  });

  await logAction(userId, 'CREATE', 'Rack', rack._id, body, ip);

  return rack;
};

const updateRack = async ({ id, body, userId, ip }) => {
  if (mongoose.connection.readyState !== 1) {
    const err = new Error('Database is not connected');
    err.statusCode = 503;
    throw err;
  }

  const datacenter = typeof body.datacenter === 'object'
    ? body.datacenter?._id
    : body.datacenter;

  const payload = {
    ...body,
    ...(datacenter ? { datacenter } : {}),
  };

  const rack = await Rack.findByIdAndUpdate(
    id,
    payload,
    { new: true, runValidators: true }
  );

  if (!rack) {
    const err = new Error('Rack not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'UPDATE', 'Rack', rack._id, body, ip);

  console.log('[Rack:update] Rack updated', {
    rackId: rack._id,
    name: rack.name,
    datacenter: rack.datacenter,
  });

  return rack;
};

const deleteRack = async ({ id, userId, ip }) => {
  const rack = await Rack.findByIdAndDelete(id);

  if (!rack) {
    const err = new Error('Rack not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'DELETE', 'Rack', id, {}, ip);

  return null;
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

const getRackOccupancy = async (id) => {
  const rack = await Rack.findById(id)
    .populate('datacenter', 'name code')
    .lean();

  if (!rack) {
    const err = new Error('Rack not found');
    err.statusCode = 404;
    throw err;
  }

  const topology = await loadRackTopology(rack);

  return {
    rack: {
      id: rack._id,
      name: rack.name,
      datacenter: rack.datacenter,
    },
    occupancy: topology.occupancy,
    power: topology.power,
    ports: topology.portsSummary,
  };
};

const getRackTopology = async (id) => {
  const rack = await Rack.findById(id)
    .populate('datacenter', 'name code')
    .lean();

  if (!rack) {
    const err = new Error('Rack not found');
    err.statusCode = 404;
    throw err;
  }

  const topology = await loadRackTopology(rack);

  return {
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
  };
};

const getRack3DData = async (id) => {
  const rack = await Rack.findById(id)
    .populate('datacenter', 'name code')
    .lean();

  if (!rack) {
    const err = new Error('Rack not found');
    err.statusCode = 404;
    throw err;
  }

  const topology = await loadRackTopology(rack);

  return {
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
  };
};

module.exports = {
  getRacks,
  getRackById,
  createRack,
  updateRack,
  deleteRack,
  getRackOccupancy,
  getRackTopology,
  getRack3DData,
};
