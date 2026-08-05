const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');

/**
 * Extrai o token tanto no formato antigo (`authorization: <token>`, usado
 * pelo frontend atual) quanto no padrão `Authorization: Bearer <token>`,
 * para não quebrar nada que já dependa do formato antigo enquanto
 * caminha para o padrão.
 */
function extractToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  return header.startsWith('Bearer ') ? header.slice(7) : header;
}

function auth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Token não enviado' });
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function admin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  next();
}

module.exports = { auth, admin };
