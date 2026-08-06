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

  await migrarModuloWhatsapp();
}

/**
 * Tabelas do módulo financeiro de entregadores + WhatsApp/OCR.
 *
 * Decisão importante: NÃO criei uma tabela "Débitos" separada como uma
 * leitura literal do pedido sugeriria. O sistema já tem `gastos` como
 * fonte única da verdade para débito de entregador (é o que alimenta o
 * dashboard, os relatórios e o financeiro por módulo). Duplicar esse
 * conceito numa tabela nova geraria duas fontes de verdade divergentes
 * — exatamente o problema que o relatoriosService.js já resolveu uma
 * vez neste projeto. Em vez disso, `comprovantes` referencia o
 * entregador e, ao ser confirmado, marca os `gastos` pendentes dele
 * como pagos (mesma operação que o botão "Marcar como pagos" já faz).
 */
async function migrarModuloWhatsapp() {
  // Sessão do Baileys (substitui os arquivos locais de auth_info_baileys,
  // que seriam apagados a cada deploy no Render — mesmo motivo da
  // migração do SQLite para Postgres).
  await run(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessao (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      atualizado_em TEXT NOT NULL DEFAULT to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS')
    )
  `);

  // JID do grupo "Açaí clts" (e de outros grupos, se um dia precisar).
  // resolvido_automaticamente=false significa que um admin fixou o JID
  // manualmente (ex: porque havia mais de um grupo com o mesmo nome) e
  // a busca automática não deve sobrescrever.
  await run(`
    CREATE TABLE IF NOT EXISTS whatsapp_grupo_config (
      nome TEXT PRIMARY KEY,
      jid TEXT,
      resolvido_automaticamente BOOLEAN NOT NULL DEFAULT true,
      atualizado_em TEXT NOT NULL DEFAULT to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS')
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS comprovantes (
      id SERIAL PRIMARY KEY,
      entregador_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      valor_debito DOUBLE PRECISION NOT NULL,
      arquivo_path TEXT NOT NULL,
      arquivo_mime TEXT NOT NULL,
      arquivo_tamanho INTEGER NOT NULL,
      ip_envio TEXT,
      status TEXT NOT NULL DEFAULT 'pendente',
      whatsapp_status TEXT NOT NULL DEFAULT 'pendente',
      whatsapp_message_id TEXT,
      whatsapp_grupo_jid TEXT,
      confirmado_em TEXT,
      confirmado_por TEXT,
      criado_em TEXT NOT NULL DEFAULT to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS')
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS comprovante_ocr (
      id SERIAL PRIMARY KEY,
      comprovante_id INTEGER NOT NULL REFERENCES comprovantes(id) ON DELETE CASCADE,
      valor_extraido DOUBLE PRECISION,
      cnpj_extraido TEXT,
      nome_favorecido TEXT,
      banco TEXT,
      instituicao TEXT,
      data_extraida TEXT,
      hora_extraida TEXT,
      tipo_transacao TEXT,
      codigo_transacao TEXT,
      texto_completo TEXT,
      confianca DOUBLE PRECISION,
      validacoes JSONB,
      criado_em TEXT NOT NULL DEFAULT to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS')
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
      id SERIAL PRIMARY KEY,
      tipo TEXT NOT NULL,
      destino_jid TEXT NOT NULL,
      entregador_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      comprovante_id INTEGER REFERENCES comprovantes(id) ON DELETE SET NULL,
      conteudo TEXT,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'pendente',
      erro TEXT,
      tentativas INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS'),
      enviado_em TEXT
    )
  `);

  await run('CREATE INDEX IF NOT EXISTS idx_comprovantes_entregador ON comprovantes(entregador_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_comprovantes_status ON comprovantes(status)');
  await run('CREATE INDEX IF NOT EXISTS idx_comprovante_ocr_comprovante ON comprovante_ocr(comprovante_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_status ON whatsapp_mensagens(status)');
  await run('CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_comprovante ON whatsapp_mensagens(comprovante_id)');
}

module.exports = { migrate };
