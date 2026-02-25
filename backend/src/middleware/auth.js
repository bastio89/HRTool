const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../routes/auth');

function authMiddleware(req, res, next) {
  // Login route doesn't need auth
  if (req.path === '/api/auth/login' || req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Allow unauthenticated if no users configured yet
    req.user = null;
    return next();
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    req.user = null;
  }

  next();
}

module.exports = authMiddleware;
