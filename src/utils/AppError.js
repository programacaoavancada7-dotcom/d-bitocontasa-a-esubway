/**
 * Erro "esperado" (regra de negócio / validação) com status HTTP definido.
 * Deixa as rotas lançarem `throw new AppError(400, 'mensagem')` em vez de
 * cada uma decidir na mão como formatar a resposta de erro — isso elimina
 * a repetição de `res.status(...).json({ error: ... })` espalhada pelo
 * server.js original e garante um formato único de erro para o frontend.
 */
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expected = true;
  }
}

module.exports = AppError;
