/**
 * Cabeçalhos de segurança básicos, sem adicionar uma dependência nova
 * (equivalente a um "helmet" mínimo, escrito à mão).
 *
 * Não foi adicionado Content-Security-Policy: o frontend atual usa
 * atributos onclick="..." em HTML gerado dinamicamente, e uma CSP
 * estrita quebraria esses handlers. A correção de fundo (mover os
 * handlers para addEventListener) foi feita nos pontos que renderizam
 * dados do usuário — ver public/app.js — mas travar a CSP em cima de
 * todo o app é um passo maior, deixado como próxima melhoria (ver
 * relatório final).
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.removeHeader('X-Powered-By');
  next();
}

module.exports = securityHeaders;
