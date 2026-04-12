const express = require('express');
const router = express.Router();
const Firewall = require('../models/Firewall');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { normalizeObjectId } = require('../utils/normalizeRefs');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const { datacenter, rack, datacenterId, rackId, q, search } = req.query;
    const filter = {};

    const term = String(search || q || '').trim();

    const normalizedDatacenterId = normalizeObjectId(datacenterId || datacenter);
    const normalizedRackId = normalizeObjectId(rackId || rack);

    if (normalizedDatacenterId) filter.datacenter = normalizedDatacenterId;
    if (normalizedRackId) filter.rack = normalizedRackId;

    if (term) {
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { brand: { $regex: term, $options: 'i' } },
        { model: { $regex: term, $options: 'i' } },
        { role: { $regex: term, $options: 'i' } },
        { 'management.ip': { $regex: term, $options: 'i' } },
      ];
    }

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['name', 'brand', 'model', 'supportExpiry', 'createdAt']);

    const payload = await buildPaginatedPayload({
      model: Firewall,
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
        search: term || null
      },
      sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await Firewall.findById(req.params.id)
      .populate('datacenter', 'name code')
      .populate('rack', 'name totalU');

    if (!item) return errorResponse(res, 'Firewall not found', 404);
    return successResponse(res, item);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/', authorize('admin', 'net_operator'), async (req, res) => {
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
      ...(portGroups ? { portGroups } : {}),
      createdBy: req.user.id
    };

    const item = await Firewall.create(payload);
    return successResponse(res, item, 'Firewall created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.put('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const dcId = normalizeObjectId(req.body.datacenter);
    const rackId = normalizeObjectId(req.body.rack);
    const portGroups = Array.isArray(req.body.portGroups)
      ? req.body.portGroups.map((g) => ({
          ...g,
          switch: normalizeObjectId(g?.switch)
        }))
      : undefined;

    const payload = {
      ...req.body,
      ...(dcId ? { datacenter: dcId } : {}),
      ...(rackId ? { rack: rackId } : {}),
      ...(portGroups ? { portGroups } : {})
    };

    const item = await Firewall.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );

    if (!item) return errorResponse(res, 'Firewall not found', 404);
    return successResponse(res, item, 'Firewall updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return errorResponse(res, err.message, 500);
  }
});

router.delete('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const item = await Firewall.findByIdAndDelete(req.params.id);
    if (!item) return errorResponse(res, 'Firewall not found', 404);
    return successResponse(res, null, 'Firewall deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
