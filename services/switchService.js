const Switch = require('../models/Switch');
const NetworkPort = require('../models/NetworkPort');
const { logAction } = require('../utils/auditLog');
const { normalizeObjectId } = require('../utils/normalizeRefs');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

const SORT_FIELDS = ['name', 'type', 'totalPorts', 'usedPorts', 'portSpeed', 'consumptionW', 'createdAt'];

const buildFilters = (query) => {
  const { datacenter, rack, datacenterId, rackId, type, brand, search } = query;
  const filter = {};

  const normalizedDatacenterId = normalizeObjectId(datacenterId || datacenter);
  const normalizedRackId = normalizeObjectId(rackId || rack);

  if (normalizedDatacenterId) filter.datacenter = normalizedDatacenterId;
  if (normalizedRackId) filter.rack = normalizedRackId;
  if (type) filter.type = type;
  if (brand) filter.brand = { $regex: brand, $options: 'i' };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { model: { $regex: search, $options: 'i' } }
    ];
  }

  return {
    filter,
    filtersPayload: {
      datacenterId: normalizedDatacenterId || null,
      rackId: normalizedRackId || null,
      type: type || null,
      brand: brand || null,
      search: search || null
    }
  };
};

const ensureSwitchExists = (sw) => {
  if (sw) return sw;
  const err = new Error('Switch not found');
  err.statusCode = 404;
  throw err;
};

const createMissingPorts = async (sw) => {
  const totalPorts = Math.max(1, Number(sw.totalPorts || 0));
  if (!Number.isFinite(totalPorts) || totalPorts <= 0) return;

  const ports = Array.from({ length: totalPorts }, (_, idx) => {
    const portIndex = idx + 1;
    return {
      portNumber: `Port ${portIndex}`,
      switch: sw._id,
      vlanId: 100,
      vlanTag: 'VLAN-100',
      portType: 'Access',
      status: 'Down'
    };
  });

  try {
    await NetworkPort.insertMany(ports, { ordered: false });
  } catch (_) {
    // best-effort only
  }
};

const reconcilePortsOnUpdate = async (sw) => {
  const totalPorts = Math.max(1, Number(sw.totalPorts || 0));
  if (!Number.isFinite(totalPorts) || totalPorts <= 0) return;

  try {
    const existingCount = await NetworkPort.countDocuments({ switch: sw._id });
    if (existingCount >= totalPorts) return;

    const existing = await NetworkPort.find({ switch: sw._id }).select('portNumber').lean();
    const used = new Set(
      existing
        .map((p) => {
          const raw = String(p.portNumber || '').trim();
          const m = raw.match(/^(?:port\s*)?(\d+)$/i) || raw.match(/(\d+)\s*$/);
          const idx = m ? Number(m[1]) : null;
          return Number.isFinite(idx) && idx > 0 ? idx : null;
        })
        .filter(Boolean)
    );

    const missing = [];
    for (let i = 1; i <= totalPorts; i += 1) {
      if (used.has(i)) continue;
      missing.push({
        portNumber: `Port ${i}`,
        switch: sw._id,
        vlanId: 100,
        vlanTag: 'VLAN-100',
        portType: 'Access',
        status: 'Down'
      });
    }

    if (missing.length) {
      await NetworkPort.insertMany(missing, { ordered: false });
    }
  } catch (_) {
    // best-effort only
  }
};

const getOverview = async (query) => {
  const { filter, filtersPayload } = buildFilters(query);
  const { page, limit, skip } = parsePagination(query);
  const { sortBy, order, sort } = parseSort(query, SORT_FIELDS);

  const [items, totalItems] = await Promise.all([
    Switch.aggregate([
      { $match: filter },
      { $sort: sort },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'datacenters',
          localField: 'datacenter',
          foreignField: '_id',
          as: 'datacenter'
        }
      },
      { $unwind: { path: '$datacenter', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'racks',
          localField: 'rack',
          foreignField: '_id',
          as: 'rack'
        }
      },
      { $unwind: { path: '$rack', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'networkports',
          let: { switchId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$switch', '$$switchId'] } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ],
          as: 'portCounts'
        }
      },
      {
        $addFields: {
          portsUp: {
            $let: {
              vars: {
                up: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$portCounts',
                        as: 'pc',
                        cond: { $eq: ['$$pc._id', 'Up'] }
                      }
                    },
                    0
                  ]
                }
              },
              in: { $ifNull: ['$$up.count', 0] }
            }
          },
          portsDown: {
            $let: {
              vars: {
                down: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$portCounts',
                        as: 'pc',
                        cond: { $eq: ['$$pc._id', 'Down'] }
                      }
                    },
                    0
                  ]
                }
              },
              in: { $ifNull: ['$$down.count', 0] }
            }
          },
          portsObserved: {
            $reduce: {
              input: '$portCounts',
              initialValue: 0,
              in: { $add: ['$$value', '$$this.count'] }
            }
          }
        }
      },
      {
        $project: {
          name: 1,
          brand: 1,
          model: 1,
          ipAddress: 1,
          status: 1,
          type: 1,
          totalPorts: 1,
          usedPorts: 1,
          reservedPorts: 1,
          portSpeed: 1,
          firmware: 1,
          redundantPower: 1,
          consumptionW: 1,
          uStart: 1,
          uEnd: 1,
          notes: 1,
          createdAt: 1,
          portsUp: 1,
          portsDown: 1,
          portsObserved: 1,
          datacenter: { _id: 1, name: 1, code: 1 },
          rack: { _id: 1, name: 1, totalU: 1 }
        }
      }
    ]),
    Switch.countDocuments(filter)
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.max(Math.ceil(totalItems / limit), 1),
      hasNextPage: page * limit < totalItems,
      hasPrevPage: page > 1
    },
    filters: filtersPayload,
    sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
  };
};

const listSwitches = async (query) => {
  const { filter, filtersPayload } = buildFilters(query);
  const { page, limit, skip } = parsePagination(query);
  const { sortBy, order, sort } = parseSort(query, SORT_FIELDS);

  const payload = await buildPaginatedPayload({
    model: Switch,
    filter,
    populate: [
      { path: 'datacenter', select: 'name code' },
      { path: 'rack', select: 'name' }
    ],
    sort,
    page,
    limit,
    skip
  });

  return {
    ...payload,
    filters: filtersPayload,
    sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
  };
};

const getSwitchById = async (id) => {
  const sw = await Switch.findById(id)
    .populate('datacenter', 'name code')
    .populate('rack', 'name totalU');

  return ensureSwitchExists(sw);
};

const createSwitch = async ({ body, userId, ip }) => {
  const payload = {
    ...body,
    datacenter: normalizeObjectId(body.datacenter),
    rack: normalizeObjectId(body.rack),
    createdBy: userId
  };

  const sw = await Switch.create(payload);
  await logAction(userId, 'CREATE', 'Switch', sw._id, body, ip);

  await createMissingPorts(sw);

  return sw;
};

const updateSwitch = async ({ id, body, userId, ip }) => {
  const payload = {
    ...body,
    ...(normalizeObjectId(body.datacenter) ? { datacenter: normalizeObjectId(body.datacenter) } : {}),
    ...(normalizeObjectId(body.rack) ? { rack: normalizeObjectId(body.rack) } : {})
  };

  const sw = await Switch.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
  ensureSwitchExists(sw);

  await logAction(userId, 'UPDATE', 'Switch', sw._id, body, ip);
  await reconcilePortsOnUpdate(sw);

  return sw;
};

const deleteSwitch = async ({ id, userId, ip }) => {
  const sw = await Switch.findByIdAndDelete(id);
  ensureSwitchExists(sw);

  await logAction(userId, 'DELETE', 'Switch', sw._id, {}, ip);
  await NetworkPort.deleteMany({ switch: sw._id });

  return null;
};

module.exports = {
  getOverview,
  listSwitches,
  getSwitchById,
  createSwitch,
  updateSwitch,
  deleteSwitch
};
