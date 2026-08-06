/**
 * Regras de negócio de gastos (fiado).
 *
 * Mudanças em relação ao server.js original:
 * - `valor` e `descricao` agora são validados antes de gravar (ver
 *   utils/validate.js). Antes, qualquer coisa era aceita: hoje, 292 dos
 *   444 gastos reais no banco têm descrição em branco, e nada impedia
 *   um valor negativo ou "NaN" de ser salvo.
 * - `funcionario_id`/`entregador_id` agora são conferidos contra a
 *   tabela `users` (existe? tem o role certo?) antes do INSERT — o
 *   banco não tem FOREIGN KEY de verdade (ver src/db/schema.js para o
 *   porquê), então essa checagem em código é o que garante que um gasto
 *   nunca fique "órfão" apontando pra um usuário que não existe.
 */

const { run, get, all } = require('../db');
const AppError = require('../utils/AppError');
const { requireString, requireValidValor, normalizeEmpresa } = require('../utils/validate');

async function validarPessoa(funcionarioId, entregadorId) {
  if (!funcionarioId && !entregadorId) {
    throw new AppError(400, 'Selecione um funcionário ou entregador');
  }

  if (funcionarioId) {
    const pessoa = await get(
      "SELECT id FROM users WHERE id = ? AND role = 'funcionario'",
      [funcionarioId]
    );
    if (!pessoa) throw new AppError(400, 'Funcionário selecionado não existe.');
  }

  if (entregadorId) {
    const pessoa = await get(
      "SELECT id FROM users WHERE id = ? AND role = 'entregador'",
      [entregadorId]
    );
    if (!pessoa) throw new AppError(400, 'Entregador selecionado não existe.');
  }
}

async function criar({ funcionario_id, entregador_id, valor, descricao, empresa }) {
  await validarPessoa(funcionario_id || null, entregador_id || null);

  const valorValido = requireValidValor(valor);
  const descricaoValida = requireString(descricao, 'descrição', { min: 1, max: 500 });
  const empresaValida = normalizeEmpresa(empresa);

  const { lastID } = await run(
    `INSERT INTO gastos (funcionario_id, entregador_id, valor, descricao, empresa)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
    [funcionario_id || null, entregador_id || null, valorValido, descricaoValida, empresaValida]
  );

  return { id: lastID, success: true };
}

const SELECT_BASE = `
  SELECT
    gastos.*,
    CASE WHEN funcionarios.nome IS NOT NULL THEN funcionarios.nome ELSE entregadores.nome END AS nome,
    CASE WHEN funcionarios.nome IS NOT NULL THEN 'Funcionário' ELSE 'Entregador' END AS tipo
  FROM gastos
  LEFT JOIN users AS funcionarios ON funcionarios.id = gastos.funcionario_id
  LEFT JOIN users AS entregadores ON entregadores.id = gastos.entregador_id
`;

/**
 * @param {{ano?: number, mes?: number}} filtro - filtro opcional por
 * ANO+MÊS (não só mês — ver relatoriosService.js para o motivo).
 *
 * `data` é TEXT no formato 'YYYY-MM-DD HH24:MI:SS', então o ano é
 * sempre os 4 primeiros caracteres e o mês os 2 seguintes — dá pra
 * filtrar com substring em vez de precisar de um tipo de data real.
 */
function listarTodos(filtro = {}) {
  const condicoes = [];
  const params = [];

  if (filtro.ano) {
    condicoes.push('substring(gastos.data from 1 for 4) = ?');
    params.push(String(filtro.ano));
  }

  if (filtro.mes) {
    condicoes.push('substring(gastos.data from 6 for 2) = ?');
    params.push(String(filtro.mes).padStart(2, '0'));
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  return all(`${SELECT_BASE} ${where} ORDER BY gastos.id DESC`, params);
}

function listarPorUsuario(userId) {
  return all(
    `SELECT * FROM gastos WHERE funcionario_id = ? OR entregador_id = ? ORDER BY id DESC`,
    [userId, userId]
  );
}

async function totalPendenteDoUsuario(userId) {
  const row = await get(
    `SELECT SUM(valor) AS total FROM gastos WHERE (funcionario_id = ? OR entregador_id = ?) AND status = 'pendente'`,
    [userId, userId]
  );
  return row.total || 0;
}

async function marcarComoPago(id) {
  const resultado = await run(`UPDATE gastos SET status = 'pago' WHERE id = ?`, [id]);
  if (resultado.changes === 0) throw new AppError(404, 'Gasto não encontrado.');
  return { success: true };
}

/**
 * Marca todos os gastos pendentes de um entregador como pagos de uma
 * vez — usado quando um comprovante é confirmado (a mesma operação que
 * o botão "Marcar como pagos" já faz, só que disparada pelo sistema em
 * vez de um clique do admin).
 */
async function marcarTodosPagosDoEntregador(entregadorId) {
  const resultado = await run(
    `UPDATE gastos SET status = 'pago' WHERE entregador_id = ? AND status = 'pendente'`,
    [entregadorId]
  );
  return { quantidadeAtualizada: resultado.changes };
}

async function remover(id) {
  const resultado = await run('DELETE FROM gastos WHERE id = ?', [id]);
  if (resultado.changes === 0) throw new AppError(404, 'Gasto não encontrado.');
  return { success: true };
}

async function editar(id, { valor, descricao }) {
  const valorValido = requireValidValor(valor);
  const descricaoValida = requireString(descricao, 'descrição', { min: 1, max: 500 });

  const resultado = await run(
    `UPDATE gastos SET valor = ?, descricao = ? WHERE id = ?`,
    [valorValido, descricaoValida, id]
  );

  if (resultado.changes === 0) throw new AppError(404, 'Gasto não encontrado.');
  return { success: true };
}

module.exports = {
  criar,
  listarTodos,
  listarPorUsuario,
  totalPendenteDoUsuario,
  marcarComoPago,
  marcarTodosPagosDoEntregador,
  remover,
  editar,
};
