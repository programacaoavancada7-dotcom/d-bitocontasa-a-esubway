/**
 * Limitador de tentativas de login.
 *
 * Por quê: o /login original não tinha nenhum limite de tentativas.
 * Com usuário/senha simples (ex: "admin"/"admin123" de fábrica) isso
 * permite força bruta ilimitada. Aqui, cada combinação IP+usuário tem
 * no máximo 8 tentativas a cada 10 minutos; ao estourar, responde 429
 * sem nem consultar o banco.
 */

const criarRateLimiter = require('./rateLimiter');

const loginRateLimiter = criarRateLimiter({
  janelaMs: 10 * 60 * 1000,
  max: 8,
  obterChave: (req) => `${req.ip}:${(req.body && req.body.usuario) || 'desconhecido'}`,
  mensagem: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
});

module.exports = loginRateLimiter;
