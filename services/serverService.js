const Server = require('../models/Server');
const { logAction } = require('../utils/auditLog');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

const SORT_FIELDS = ['name', 'supportExpiry', 'ramGB', 'createdAt'];

const buildFilters = (query) => {
  const {
    datacenter,
    rack,
    datacenterId,
    rackId,
    role,
    type,
    brand,
    search
  } = query;

  const filter = {};

  if (datacenterId || datacenter) filter.datacenter = datacenterId || datacenter;
  if (rackId || rack) filter.rack = rackId || rack;
  if (role) filter.role = role;
  if (type) filter.type = type;
  if (brand) filter.brand = { $regex: brand, $options: 'i' };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { serialNumber: { $regex: search, $options: 'i' } },
      { 'idrac.ip': { $regex: search, $options: 'i' } }
    ];
  }

  return {
    filter,
    filtersPayload: {
      datacenterId: datacenterId || datacenter || null,
      rackId: rackId || rack || null,
      role: role || null,
      type: type || null,
      brand: brand || null,
      search: search || null
    }
  };
};

const listServers = async (query) => {
  const { filter, filtersPayload } = buildFilters(query);
  const { page, limit, skip } = parsePagination(query);
  const { sortBy, order, sort } = parseSort(query, SORT_FIELDS);

  const payload = await buildPaginatedPayload({
    model: Server,
    filter,
    populate: ['datacenter', 'rack'],
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

const getServerById = async (id) => {
  const server = await Server.findById(id)
    .populate('datacenter', 'name code')
    .populate('rack', 'name totalU');

  if (!server) {
    const err = new Error('Server not found');
    err.statusCode = 404;
    throw err;
  }

  return server;
};

const createServer = async ({ body, userId, ip }) => {
  const datacenter = typeof body.datacenter === 'object'
    ? body.datacenter?._id
    : body.datacenter;
  const rack = typeof body.rack === 'object'
    ? body.rack?._id
    : body.rack;

  const payload = {
    ...body,
    ...(datacenter ? { datacenter } : {}),
    ...(rack ? { rack } : {}),
    createdBy: userId
  };

  const server = await Server.create(payload);
  await logAction(userId, 'CREATE', 'Server', server._id, body, ip);
  return server;
};

const updateServer = async ({ id, body, userId, ip }) => {
  const datacenter = typeof body.datacenter === 'object'
    ? body.datacenter?._id
    : body.datacenter;
  const rack = typeof body.rack === 'object'
    ? body.rack?._id
    : body.rack;

  const payload = {
    ...body,
    ...(datacenter ? { datacenter } : {}),
    ...(rack ? { rack } : {}),
  };

  const server = await Server.findByIdAndUpdate(
    id,
    payload,
    { new: true, runValidators: true }
  );

  if (!server) {
    const err = new Error('Server not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'UPDATE', 'Server', server._id, body, ip);
  return server;
};

const deleteServer = async ({ id, userId, ip }) => {
  const server = await Server.findByIdAndDelete(id);
  if (!server) {
    const err = new Error('Server not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'DELETE', 'Server', id, {}, ip);
  return null;
};

module.exports = {
  listServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer
};
