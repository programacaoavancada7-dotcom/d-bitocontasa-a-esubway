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

  // '23505' = unique_violation no Postgres (ex: usuario duplicado).
  if (err && err.code === '23505') {
    return res.status(400).json({ error: 'Usuário já existe ou dado duplicado.' });
  }

  // '23503' = foreign_key_violation (ex: gasto apontando pra um
  // funcionario_id/entregador_id que nao existe mais).
  if (err && err.code === '23503') {
    return res.status(400).json({ error: 'Referência inválida: verifique se a pessoa selecionada ainda existe.' });
  }

  console.error('[erro não tratado]', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
}

function notFound(req, res) {
  res.status(404).json({ error: 'Rota não encontrada.' });
}

module.exports = { errorHandler, notFound };
