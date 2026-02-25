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
  const queryToken = req.query?.token;
  const tokenStr = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : queryToken;
  
  if (!tokenStr) {
    return res.status(401).json({ error: 'Authentifizierung erforderlich' });
  }

  try {
    const decoded = jwt.verify(tokenStr, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
}

module.exports = authMiddleware;
