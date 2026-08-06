/**
 * Conexão com o Postgres (Supabase) + wrappers em Promise.
 *
 * Migrado de SQLite para Postgres porque o Render (onde este projeto
 * será hospedado) usa disco efêmero: um arquivo `database.db` seria
 * apagado a cada deploy/reinício do serviço. O Supabase hospeda o
 * banco fora do Render, então os dados sobrevivem a qualquer deploy.
 *
 * Para minimizar mudança de código, `run/get/all` mantêm a mesma
 * assinatura de antes (sql com `?` como placeholder posicional) — a
 * conversão para o formato `$1, $2...` do Postgres acontece aqui,
 * escondida dos services/rotas que já usavam essa API.
 */

const { Pool } = require('pg');
const { databaseUrl, pg: pgConfig } = require('../config/env');

function precisaSsl(hostOuUrl) {
  return !/localhost|127\.0\.0\.1/.test(hostOuUrl || '');
}

// Prioriza campos separados (PGHOST/PGUSER/PGPASSWORD/...) quando
// configurados — evita todo o risco de caracteres especiais na senha
// quebrarem o parsing de uma DATABASE_URL única. Ver src/config/env.js.
const pool = pgConfig
  ? new Pool({ ...pgConfig, ssl: precisaSsl(pgConfig.host) ? { rejectUnauthorized: false } : false })
  : new Pool({
      connectionString: databaseUrl,
      ssl: precisaSsl(databaseUrl) ? { rejectUnauthorized: false } : false,
    });

pool.on('error', (err) => {
  // Erros em clientes ociosos do pool não devem derrubar o processo
  // (mesmo espírito do asyncHandler: nunca deixar um erro de banco
  // virar um crash não tratado do servidor inteiro).
  console.error('[db] Erro inesperado no pool do Postgres:', err.message);
});

function converterPlaceholders(sql) {
  let indice = 0;
  return sql.replace(/\?/g, () => `$${(indice += 1)}`);
}

async function run(sql, params = []) {
  const resultado = await pool.query(converterPlaceholders(sql), params);
  return {
    lastID: resultado.rows[0] ? resultado.rows[0].id : undefined,
    changes: resultado.rowCount,
  };
}

async function get(sql, params = []) {
  const resultado = await pool.query(converterPlaceholders(sql), params);
  return resultado.rows[0];
}

async function all(sql, params = []) {
  const resultado = await pool.query(converterPlaceholders(sql), params);
  return resultado.rows;
}

async function exec(sql) {
  await pool.query(sql);
}

module.exports = { pool, run, get, all, exec };
