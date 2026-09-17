const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../routes/auth');

// Routes that don't require authentication
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/health',
  '/api/docs',
  '/api/docs.json',
  '/api/matching/external',
];

function isPublicPath(path) {
  if (path === '/api/docs' || path.startsWith('/api/docs/') || path === '/api/docs.json') {
    // Die vollstaendige API-Dokumentation gehoert nicht ins oeffentliche Netz.
    return process.env.NODE_ENV !== 'production';
  }
  return PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'));
}

// Bilder und Downloads werden vom Browser ueber <img src> bzw. einen Link
// geladen - dort laesst sich kein Authorization-Header setzen. Nur diese
// lesenden Routen akzeptieren das Token deshalb aus der Query. Ueberall sonst
// waere es ein unnoetiges Leck: Query-Parameter landen in Zugriffsprotokollen,
// im Browserverlauf und im Referer-Header.
const QUERY_TOKEN_PATTERNS = [
  /^\/api\/uploads\/download\/[^/]+$/,
  /^\/api\/uploads\/preview\/[^/]+$/,
  /^\/api\/candidate-details\/[^/]+\/photo$/,
];

function allowsQueryToken(path) {
  return QUERY_TOKEN_PATTERNS.some(re => re.test(path));
}

function authMiddleware(req, res, next) {
  // Public routes and CORS preflight don't need auth
  if (req.method === 'OPTIONS' || isPublicPath(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const queryToken = allowsQueryToken(req.path) ? req.query?.token : undefined;
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
