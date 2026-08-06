/**
 * Criação de tabelas e índices no Postgres.
 *
 * Diferente da versão SQLite (onde recriar a tabela `gastos` pra
 * adicionar FOREIGN KEY de verdade arriscaria as 444 linhas reais), aqui
 * é um banco novo — então já nasce com as constraints corretas:
 * REFERENCES users(id) impede um gasto apontar pra um usuário que não
 * existe, e ON DELETE RESTRICT impede apagar um funcionário/entregador
 * que ainda tem gastos (a mesma regra que já existia em
 * pessoasService.js, agora também garantida pelo banco).
 *
 * `data`/`criado_em` continuam como TEXT no formato
 * 'YYYY-MM-DD HH24:MI:SS' — o mesmo formato que o SQLite sempre usou
 * (SQLite não tem um tipo DATETIME real, é só um apelido pra TEXT).
 * Isso evita qualquer mudança no frontend, que já sabe interpretar
 * esse formato exato.
 */

const { run } = require('./index');

async function migrate() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'funcionario',
      criado_em TEXT NOT NULL DEFAULT to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS')
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS gastos (
      id SERIAL PRIMARY KEY,
      funcionario_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      entregador_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      valor DOUBLE PRECISION NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      empresa TEXT NOT NULL DEFAULT 'Açaí no Grau',
      status TEXT NOT NULL DEFAULT 'pendente',
      data TEXT NOT NULL DEFAULT to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS')
    )
  `);

  await run('CREATE INDEX IF NOT EXISTS idx_gastos_funcionario ON gastos(funcionario_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_gastos_entregador ON gastos(entregador_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_gastos_status ON gastos(status)');
  await run('CREATE INDEX IF NOT EXISTS idx_gastos_data ON gastos(data)');
  await run('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
}

module.exports = { migrate };
