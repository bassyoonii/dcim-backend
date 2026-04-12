const express = require('express');
const router = express.Router();
const Switch = require('../models/Switch');
const NetworkPort = require('../models/NetworkPort');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { normalizeObjectId } = require('../utils/normalizeRefs');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

router.use(protect);

router.get('/overview', async (req, res) => {
  try {
    const { datacenter, rack, datacenterId, rackId, type, brand, search } = req.query;
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

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['name', 'type', 'totalPorts', 'usedPorts', 'portSpeed', 'consumptionW', 'createdAt']);

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

    return successResponse(res, {
      items,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.max(Math.ceil(totalItems / limit), 1),
        hasNextPage: page * limit < totalItems,
        hasPrevPage: page > 1
      },
      filters: {
        datacenterId: normalizedDatacenterId || null,
        rackId: normalizedRackId || null,
        type: type || null,
        brand: brand || null,
        search: search || null
      },
      sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/', async (req, res) => {
  try {
    const { datacenter, rack, datacenterId, rackId, type, brand, search } = req.query;
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

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['name', 'type', 'totalPorts', 'usedPorts', 'portSpeed', 'consumptionW', 'createdAt']);

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

    return successResponse(res, {
      ...payload,
      filters: {
        datacenterId: normalizedDatacenterId || null,
        rackId: normalizedRackId || null,
        type: type || null,
        brand: brand || null,
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
    const sw = await Switch.findById(req.params.id)
      .populate('datacenter', 'name code')
      .populate('rack', 'name totalU');

    if (!sw) return errorResponse(res, 'Switch not found', 404);
    return successResponse(res, sw);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const payload = {
      ...req.body,
      datacenter: normalizeObjectId(req.body.datacenter),
      rack: normalizeObjectId(req.body.rack),
      createdBy: req.user.id
    };
    const sw = await Switch.create(payload);

    // Auto-generate ports for the switch (Port 1..N)
    const totalPorts = Math.max(1, Number(sw.totalPorts || 0));
    const ports = Array.from({ length: totalPorts }, (_, idx) => {
      const portIndex = idx + 1;
      return {
        portNumber: `Port ${portIndex}`,
        switch: sw._id,
        vlanId: 100,
        vlanTag: 'VLAN-100',
        portType: 'Access',
        status: 'Down',
      };
    });

    try {
      await NetworkPort.insertMany(ports, { ordered: false });
    } catch (e) {
      // Best-effort: if some ports already exist, keep the switch creation successful.
    }
    return successResponse(res, sw, 'Switch created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Switch port mapping conflict', 409);
    return errorResponse(res, err.message, 500);
  }
});

router.put('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const payload = {
      ...req.body,
      ...(normalizeObjectId(req.body.datacenter) ? { datacenter: normalizeObjectId(req.body.datacenter) } : {}),
      ...(normalizeObjectId(req.body.rack) ? { rack: normalizeObjectId(req.body.rack) } : {})
    };

    const sw = await Switch.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );

    if (!sw) return errorResponse(res, 'Switch not found', 404);

    // Best-effort: if totalPorts increased, ensure the missing NetworkPorts exist.
    const totalPorts = Math.max(1, Number(sw.totalPorts || 0));
    if (Number.isFinite(totalPorts) && totalPorts > 0) {
      try {
        const existingCount = await NetworkPort.countDocuments({ switch: sw._id });
        if (existingCount < totalPorts) {
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
              status: 'Down',
            });
          }
          if (missing.length) {
            await NetworkPort.insertMany(missing, { ordered: false });
          }
        }
      } catch (_) {
        // keep update successful
      }
    }
    return successResponse(res, sw, 'Switch updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.delete('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const sw = await Switch.findByIdAndDelete(req.params.id);
    if (!sw) return errorResponse(res, 'Switch not found', 404);

    // Cleanup related ports (avoid orphans)
    await NetworkPort.deleteMany({ switch: sw._id });

    return successResponse(res, null, 'Switch deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
