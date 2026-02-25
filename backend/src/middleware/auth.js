const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../routes/auth');

// Routes that don't require authentication
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/health',
  '/api/docs',
  '/api/docs.json',
];

function isPublicPath(path) {
  return PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'));
}

function authMiddleware(req, res, next) {
  // Public routes and CORS preflight don't need auth
  if (req.method === 'OPTIONS' || isPublicPath(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentifizierung erforderlich' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
}

module.exports = authMiddleware;
