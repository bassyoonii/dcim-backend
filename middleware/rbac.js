const { errorResponse } = require('../utils/apiResponse');

// Pass one or more allowed roles
// Usage: authorize('admin') or authorize('admin', 'sys_operator')
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return errorResponse(
        res,
        `Role '${req.user.role}' is not allowed to perform this action`,
        403
      );
    }
    next();
  };
};

module.exports = { authorize };