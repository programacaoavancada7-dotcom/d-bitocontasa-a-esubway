const AppError = require('../utils/AppError');

/**
 * Handler de erro central do Express (precisa ter 4 argumentos para o
 * Express reconhecer como error middleware). Toda rota agora lança
 * AppError para erros de validação/negócio, ou deixa erros inesperados
 * subirem — de qualquer forma, a resposta ao cliente é sempre um JSON
 * consistente, e o erro completo vai pro log do servidor (nunca pro
 * cliente, para não vazar detalhes internos/stack trace).
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err && err.code === 'SQLITE_CONSTRAINT') {
    return res.status(400).json({ error: 'Usuário já existe ou dado duplicado.' });
  }

  console.error('[erro não tratado]', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
}

function notFound(req, res) {
  res.status(404).json({ error: 'Rota não encontrada.' });
}

module.exports = { errorHandler, notFound };
