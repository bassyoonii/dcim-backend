const StorageBay = require('../models/StorageBay');
const { normalizeObjectId, normalizeStringArray } = require('../utils/normalizeRefs');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

const SORT_FIELDS = ['name', 'storageType', 'totalCapacityTB', 'allocatedCapacityTB', 'supportExpiry', 'createdAt'];

const buildFilters = (query) => {
  const { datacenter, rack, datacenterId, rackId, storageType, type, brand, search } = query;
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

  return {
    filter,
    filtersPayload: {
      datacenterId: normalizedDatacenterId || null,
      rackId: normalizedRackId || null,
      type: storageType || type || null,
      brand: brand || null,
      search: search || null
    }
  };
};

const listStorage = async (query) => {
  const { filter, filtersPayload } = buildFilters(query);
  const { page, limit, skip } = parsePagination(query);
  const { sortBy, order, sort } = parseSort(query, SORT_FIELDS);

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

  return {
    ...payload,
    filters: filtersPayload,
    sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
  };
};

const getStorageById = async (id) => {
  const item = await StorageBay.findById(id)
    .populate('datacenter', 'name code')
    .populate('rack', 'name totalU')
    .populate('parentStorageBay', 'name model');

  if (!item) {
    const err = new Error('Storage item not found');
    err.statusCode = 404;
    throw err;
  }

  return item;
};

const createStorage = async ({ body, userId }) => {
  const portGroups = Array.isArray(body.portGroups)
    ? body.portGroups.map((g) => ({
        ...g,
        switch: normalizeObjectId(g?.switch)
      }))
    : undefined;

  const payload = {
    ...body,
    datacenter: normalizeObjectId(body.datacenter),
    rack: normalizeObjectId(body.rack),
    parentStorageBay: normalizeObjectId(body.parentStorageBay),
    networkConnections: normalizeStringArray(body.networkConnections),
    ...(portGroups ? { portGroups } : {}),
    createdBy: userId
  };

  const item = await StorageBay.create(payload);
  return item;
};

const updateStorage = async ({ id, body }) => {
  const datacenterId = normalizeObjectId(body.datacenter);
  const rackId = normalizeObjectId(body.rack);
  const parentStorageBayId = normalizeObjectId(body.parentStorageBay);
  const portGroups = Array.isArray(body.portGroups)
    ? body.portGroups.map((g) => ({
        ...g,
        switch: normalizeObjectId(g?.switch)
      }))
    : undefined;

  const payload = {
    ...body,
    ...(datacenterId ? { datacenter: datacenterId } : {}),
    ...(rackId ? { rack: rackId } : {}),
    parentStorageBay: parentStorageBayId || null,
    networkConnections: normalizeStringArray(body.networkConnections),
    ...(portGroups ? { portGroups } : {})
  };

  const item = await StorageBay.findByIdAndUpdate(
    id,
    payload,
    { new: true, runValidators: true }
  );

  if (!item) {
    const err = new Error('Storage item not found');
    err.statusCode = 404;
    throw err;
  }

  return item;
};

const deleteStorage = async (id) => {
  const item = await StorageBay.findByIdAndDelete(id);
  if (!item) {
    const err = new Error('Storage item not found');
    err.statusCode = 404;
    throw err;
  }

  return null;
};

module.exports = {
  listStorage,
  getStorageById,
  createStorage,
  updateStorage,
  deleteStorage
};
