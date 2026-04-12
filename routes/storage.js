const express = require('express');
const router = express.Router();
const StorageBay = require('../models/StorageBay');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { normalizeObjectId, normalizeStringArray } = require('../utils/normalizeRefs');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const { datacenter, rack, datacenterId, rackId, storageType, type, brand, search } = req.query;
    const filter = {};

    const normalizedDatacenterId = normalizeObjectId(datacenterId || datacenter);
    const normalizedRackId = normalizeObjectId(rackId || rack);

    if (normalizedDatacenterId) filter.datacenter = normalizedDatacenterId;
    if (normalizedRackId) filter.rack = normalizedRackId;
    if (storageType || type) filter.storageType = storageType || type;
    if (brand) filter.brand = { $regex: brand, $options: 'i' };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { model: { $regex: search, $options: 'i' } }
      ];
    }

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['name', 'storageType', 'totalCapacityTB', 'allocatedCapacityTB', 'supportExpiry', 'createdAt']);

    const payload = await buildPaginatedPayload({
      model: StorageBay,
      filter,
      populate: [
        { path: 'datacenter', select: 'name code' },
        { path: 'rack', select: 'name' },
        { path: 'parentStorageBay', select: 'name model' }
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
        type: storageType || type || null,
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
    const item = await StorageBay.findById(req.params.id)
      .populate('datacenter', 'name code')
      .populate('rack', 'name totalU')
      .populate('parentStorageBay', 'name model');

    if (!item) return errorResponse(res, 'Storage item not found', 404);
    return successResponse(res, item);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/', authorize('admin', 'sys_operator'), async (req, res) => {
  try {
    const portGroups = Array.isArray(req.body.portGroups)
      ? req.body.portGroups.map((g) => ({
          ...g,
          switch: normalizeObjectId(g?.switch)
        }))
      : undefined;

    const payload = {
      ...req.body,
      datacenter: normalizeObjectId(req.body.datacenter),
      rack: normalizeObjectId(req.body.rack),
      parentStorageBay: normalizeObjectId(req.body.parentStorageBay),
      networkConnections: normalizeStringArray(req.body.networkConnections),
      ...(portGroups ? { portGroups } : {}),
      createdBy: req.user.id
    };

    const item = await StorageBay.create(payload);
    return successResponse(res, item, 'Storage created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.put('/:id', authorize('admin', 'sys_operator'), async (req, res) => {
  try {
    const datacenterId = normalizeObjectId(req.body.datacenter);
    const rackId = normalizeObjectId(req.body.rack);
    const parentStorageBayId = normalizeObjectId(req.body.parentStorageBay);
    const portGroups = Array.isArray(req.body.portGroups)
      ? req.body.portGroups.map((g) => ({
          ...g,
          switch: normalizeObjectId(g?.switch)
        }))
      : undefined;
    const payload = {
      ...req.body,
      ...(datacenterId ? { datacenter: datacenterId } : {}),
      ...(rackId ? { rack: rackId } : {}),
      parentStorageBay: parentStorageBayId || null,
      networkConnections: normalizeStringArray(req.body.networkConnections),
      ...(portGroups ? { portGroups } : {})
    };

    const item = await StorageBay.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );

    if (!item) return errorResponse(res, 'Storage item not found', 404);
    return successResponse(res, item, 'Storage updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.delete('/:id', authorize('admin', 'sys_operator'), async (req, res) => {
  try {
    const item = await StorageBay.findByIdAndDelete(req.params.id);
    if (!item) return errorResponse(res, 'Storage item not found', 404);
    return successResponse(res, null, 'Storage deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
