const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 500;

const parsePagination = (query = {}) => {
  const page = Math.max(parseInt(query.page, 10) || DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const parseSort = (query = {}, allowedSortFields = ['name']) => {
  const requested = (query.sortBy || 'name').trim();
  const sortBy = allowedSortFields.includes(requested) ? requested : allowedSortFields[0];
  const order = String(query.order || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  return { sortBy, order, sort: { [sortBy]: order } };
};

const buildPaginatedPayload = async ({ model, filter, populate = [], sort, page, limit, skip, select = null }) => {
  let findQuery = model.find(filter);
  if (select) findQuery = findQuery.select(select);

  populate.forEach((p) => {
    findQuery = findQuery.populate(p);
  });

  const [items, totalItems] = await Promise.all([
    findQuery.sort(sort).skip(skip).limit(limit),
    model.countDocuments(filter)
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
    }
  };
};

module.exports = {
  parsePagination,
  parseSort,
  buildPaginatedPayload
};
