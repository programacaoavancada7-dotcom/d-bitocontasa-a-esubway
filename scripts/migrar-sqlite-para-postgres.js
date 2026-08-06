/**
 * Migração única: copia todos os dados do database.db (SQLite) para o
 * Postgres (Supabase) configurado no .env.
 *
 * O que faz, em ordem:
 *  1. Garante que as tabelas existem no Postgres (roda a mesma
 *     migração de schema usada no boot do servidor).
 *  2. Copia todos os `users`, preservando o `id` original (importante:
 *     os gastos referenciam esses ids via funcionario_id/entregador_id).
 *  3. Copia todos os `gastos`, também preservando o `id`.
 *  4. Ajusta as sequências do Postgres (SERIAL) para continuarem do
 *     maior id copiado — sem isso, o próximo INSERT tentaria usar um id
 *     que já existe e falharia.
 *  5. Confere as contagens antes/depois pra garantir que nada ficou
 *     pra trás.
 *
 * É seguro rodar mais de uma vez: usa "ON CONFLICT (id) DO NOTHING",
 * então registros já migrados não são duplicados.
 *
 * Uso: npm run migrar:supabase
 */

require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrate } = require('../src/db/schema');
const db = require('../src/db');

const SQLITE_PATH = path.join(__dirname, '..', 'database.db');

function abrirSqlite() {
  return new Promise((resolve, reject) => {
    const conexao = new sqlite3.Database(SQLITE_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
      resolve(conexao);
    });
  });
}

function todosSqlite(conexao, sql) {
  return new Promise((resolve, reject) => {
    conexao.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function main() {
  console.log(`Lendo banco antigo em: ${SQLITE_PATH}`);
  const sqlite = await abrirSqlite();

  const users = await todosSqlite(sqlite, 'SELECT * FROM users');
  const gastos = await todosSqlite(sqlite, 'SELECT * FROM gastos');
  sqlite.close();

  console.log(`Encontrados no SQLite: ${users.length} usuários, ${gastos.length} gastos.`);

  console.log('Garantindo schema no Postgres...');
  await migrate();

  console.log('Copiando usuários...');
  for (const u of users) {
    await db.run(
      `INSERT INTO users (id, nome, usuario, senha, role, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.nome, u.usuario, u.senha, u.role, u.criado_em]
    );
  }

  console.log('Copiando gastos...');
  for (const g of gastos) {
    await db.run(
      `INSERT INTO gastos (id, funcionario_id, entregador_id, valor, descricao, empresa, status, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [g.id, g.funcionario_id, g.entregador_id, g.valor, g.descricao, g.empresa, g.status, g.data]
    );
  }

  console.log('Ajustando sequências (SERIAL) para continuar após o maior id migrado...');
  await db.run("SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1))");
  await db.run("SELECT setval(pg_get_serial_sequence('gastos', 'id'), COALESCE((SELECT MAX(id) FROM gastos), 1))");

  const [{ total: totalUsersPg }] = await db.all('SELECT COUNT(*)::int as total FROM users');
  const [{ total: totalGastosPg }] = await db.all('SELECT COUNT(*)::int as total FROM gastos');

  console.log('--- Conferência ---');
  console.log(`users:  SQLite=${users.length}  Postgres=${totalUsersPg}`);
  console.log(`gastos: SQLite=${gastos.length}  Postgres=${totalGastosPg}`);

  if (totalUsersPg < users.length || totalGastosPg < gastos.length) {
    console.warn('⚠️  A contagem no Postgres é menor que no SQLite. Confira manualmente antes de trocar o servidor de banco.');
    process.exitCode = 1;
  } else {
    console.log('✅ Migração concluída.');
  }

  await db.pool.end();
}

main().catch((erro) => {
  console.error('❌ Falha na migração:', erro);
  process.exitCode = 1;
});
