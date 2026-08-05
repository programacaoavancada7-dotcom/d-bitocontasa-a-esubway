/**
 * Evita repetir try/catch em toda rota async e, principalmente, evita o
 * bug de crash do servidor: no server.js original, callbacks do sqlite3
 * que não checavam `err` (ex: DELETE /funcionarios/:id e
 * /entregadores/:id) podiam lançar uma exceção não tratada dentro do
 * callback e derrubar o processo Node inteiro — tirando o sistema do ar
 * para TODOS os usuários por causa de um único erro de banco. Com as
 * rotas em async/await + este wrapper, qualquer erro (esperado ou não)
 * cai no errorHandler central em vez de explodir o processo.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
