const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

/** Reject the request unless it carries a valid "Authorization: Bearer <token>" header. */
function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    req.user = { id: String(payload.id) };
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

/** Use after requireAuth. The role is read from the database, so demoting an admin takes effect at once. */
async function requireAdmin(req, res, next) {
  const user = await User.findById(req.user.id).select('role').lean();
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
