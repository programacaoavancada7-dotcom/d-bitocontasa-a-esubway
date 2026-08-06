/**
 * Cálculos de relatórios e rankings — fonte única da verdade.
 *
 * Por quê este arquivo existe: no frontend antigo (public/app.js), a
 * mesma lógica de "somar gastos pendentes por empresa" estava
 * implementada de forma independente em pelo menos 4 lugares:
 * carregarGastos() (ranking da tela), carregarMeuTotal() (painel do
 * funcionário), gerarRelatorioFinanceiroCompleto() (PDF) e
 * gerarRelatorioFuncionarios() (outro PDF) — cada um reconstruindo o
 * mesmo agrupamento na mão. Duas dessas cópias já haviam divergido
 * sutilmente: o ranking da tela tratava "acai" sem acento como Açaí,
 * mas o PDF financeiro completo não, jogando esses casos em "Outros".
 * Hoje isso não afeta nenhum registro real (os dados usam sempre o
 * texto exato do <select>), mas é uma inconsistência esperando para
 * acontecer. Agora existe UM único lugar que soma isso, usado pela tela
 * e pelos dois PDFs — corrigir ou estender essa regra passa a ser uma
 * mudança em um só arquivo.
 *
 * Também: em vez de "Açaí" e "Subway" fixos no código, o agrupamento é
 * por empresa (o valor exato salvo no gasto). Isso significa que, se um
 * dia existir uma terceira empresa, o ranking já aparece corretamente
 * sem precisar mexer em código.
 */

const { all } = require('../db');

function novoAcumulador() {
  return { total: 0, porEmpresa: {} };
}

function acumular(mapa, chave, empresa, valor) {
  if (!mapa[chave]) mapa[chave] = novoAcumulador();
  mapa[chave].total += valor;
  mapa[chave].porEmpresa[empresa] = (mapa[chave].porEmpresa[empresa] || 0) + valor;
}

function paraLista(mapa) {
  return Object.entries(mapa)
    .map(([nome, dados]) => ({ nome, total: dados.total, porEmpresa: dados.porEmpresa }))
    .sort((a, b) => b.total - a.total);
}

/**
 * @param {{ano?: number, mes?: number}} filtro
 */
async function getResumo(filtro = {}) {
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

  const linhas = await all(
    `
    SELECT
      gastos.valor,
      gastos.status,
      gastos.empresa,
      gastos.data,
      gastos.descricao,
      CASE WHEN funcionarios.nome IS NOT NULL THEN funcionarios.nome ELSE entregadores.nome END AS nome,
      CASE WHEN funcionarios.nome IS NOT NULL THEN 'Funcionário' ELSE 'Entregador' END AS tipo
    FROM gastos
    LEFT JOIN users AS funcionarios ON funcionarios.id = gastos.funcionario_id
    LEFT JOIN users AS entregadores ON entregadores.id = gastos.entregador_id
    ${where}
    `,
    params
  );

  let totalPendente = 0;
  let totalPago = 0;
  const totalPorEmpresa = {};
  const rankingFuncionariosMapa = {};
  const rankingEntregadoresMapa = {};

  for (const linha of linhas) {
    const valor = Number(linha.valor) || 0;
    const empresa = linha.empresa || 'Não informado';

    if (linha.status === 'pendente') {
      totalPendente += valor;
      totalPorEmpresa[empresa] = (totalPorEmpresa[empresa] || 0) + valor;

      const mapa = linha.tipo === 'Entregador' ? rankingEntregadoresMapa : rankingFuncionariosMapa;
      acumular(mapa, linha.nome, empresa, valor);
    } else {
      totalPago += valor;
    }
  }

  // Atenção: o Postgres deixa em minúsculas qualquer alias de coluna sem
  // aspas (`AS totalFuncionarios` viraria `totalfuncionarios` na linha
  // retornada). Por isso os aliases abaixo são citados entre aspas —
  // sem isso, a desestruturação abaixo receberia `undefined`.
  const [{ totalFuncionarios } = {}, { totalEntregadores } = {}] = await Promise.all([
    all('SELECT COUNT(*)::int as "totalFuncionarios" FROM users WHERE role=\'funcionario\''),
    all('SELECT COUNT(*)::int as "totalEntregadores" FROM users WHERE role=\'entregador\''),
  ]).then(([a, b]) => [a[0], b[0]]);

  return {
    totalPendente,
    totalPago,
    totalMovimentado: totalPendente + totalPago,
    totalFuncionarios,
    totalEntregadores,
    totalPorEmpresa,
    rankingFuncionarios: paraLista(rankingFuncionariosMapa),
    rankingEntregadores: paraLista(rankingEntregadoresMapa),
  };
}

module.exports = { getResumo };
