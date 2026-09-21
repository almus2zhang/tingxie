const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'tingxie_super_secret_jwt_key_2026';

/**
 * Generate JWT token for user
 */
function signUserToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

/**
 * Optional Auth middleware:
 * Extracts user from Authorization header if present, attaches to req.user.
 * Does not block if no token provided.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7).trim();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, username, role FROM users WHERE id = ?').get(decoded.id);
    req.user = user || null;
  } catch (err) {
    req.user = null;
  }
  next();
}

/**
 * Required Auth middleware:
 * Blocks with 401 if user is not authenticated.
 */
function authRequired(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录后再进行此操作' });
  }

  const token = authHeader.slice(7).trim();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, username, role FROM users WHERE id = ?').get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: '用户不存在或登录已失效，请重新登录' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录身份已过期，请重新登录' });
  }
}

/**
 * Required Admin middleware:
 * Blocks with 403 if user is not an admin.
 */
function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: '需要管理员权限方可执行此操作' });
    }
    next();
  });
}

module.exports = {
  signUserToken,
  optionalAuth,
  authRequired,
  adminRequired,
};
