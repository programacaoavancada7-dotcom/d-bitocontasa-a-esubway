/**
 * Criação de tabelas, migrações leves e índices.
 *
 * Importante: este banco já está em produção (dezenas de usuários e
 * centenas de gastos reais). Por isso as mudanças aqui são estritamente
 * ADITIVAS e seguras de rodar em cima dos dados existentes:
 *   - CREATE TABLE IF NOT EXISTS: não recria nem apaga tabelas existentes.
 *   - CREATE INDEX IF NOT EXISTS: só acelera consultas, não move dados.
 *   - ALTER TABLE ... ADD COLUMN: só roda se a coluna ainda não existir.
 *
 * O que NÃO foi feito aqui, de propósito: recriar a tabela `gastos` para
 * adicionar FOREIGN KEY de verdade (REFERENCES users(id)). O SQLite não
 * permite adicionar essa constraint a uma tabela existente sem recriá-la
 * (criar tabela nova, copiar as 444 linhas, apagar a antiga, renomear).
 * Em vez de arriscar os dados reais numa migração assim, a integridade
 * referencial (funcionario_id/entregador_id têm que apontar para um
 * usuário existente com o papel certo) passou a ser validada em
 * src/services/gastosService.js antes de qualquer INSERT/UPDATE.
 */

const { run, all } = require('./index');

async function ensureColumn(table, column, definition) {
  const columns = await all(`PRAGMA table_info(${table})`);
  const exists = columns.some((col) => col.name === column);

  if (!exists) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db] Coluna ${column} adicionada em ${table}`);
  }
}

async function migrate() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'funcionario',
      criado_em DATETIME DEFAULT (datetime('now', '-3 hours'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funcionario_id INTEGER,
      entregador_id INTEGER,
      valor REAL NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      empresa TEXT NOT NULL DEFAULT 'Açaí no Grau',
      status TEXT NOT NULL DEFAULT 'pendente',
      data DATETIME DEFAULT (datetime('now', '-3 hours'))
    )
  `);

  // Migrações leves para bancos antigos que ainda não tinham essas colunas.
  await ensureColumn('gastos', 'entregador_id', 'INTEGER');
  await ensureColumn('gastos', 'empresa', "TEXT DEFAULT 'Açaí no Grau'");

  // Índices: antes não existia nenhum. Toda consulta em /admin/gastos,
  // /meus-gastos, /meu-total e os relatórios fazem WHERE por
  // funcionario_id, entregador_id ou status — sem índice isso é uma
  // varredura completa da tabela a cada request. Hoje são ~450 linhas
  // (imperceptível), mas o custo de adicionar o índice é zero e evita
  // que o sistema fique lento conforme o histórico cresce.
  await run('CREATE INDEX IF NOT EXISTS idx_gastos_funcionario ON gastos(funcionario_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_gastos_entregador ON gastos(entregador_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_gastos_status ON gastos(status)');
  await run('CREATE INDEX IF NOT EXISTS idx_gastos_data ON gastos(data)');
  await run('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
}

module.exports = { migrate };
