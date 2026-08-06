/**
 * Persiste a sessão de login do Baileys no Postgres em vez de arquivos
 * locais (o padrão `useMultiFileAuthState` da própria lib).
 *
 * Por quê: no Render o disco é efêmero — os arquivos de sessão seriam
 * apagados a cada deploy/restart, obrigando a escanear o QR Code de
 * novo toda vez. Isso segue o mesmo raciocínio da migração do banco
 * principal de SQLite para Postgres.
 *
 * A implementação espelha a forma como `useMultiFileAuthState` guarda
 * cada chave (credenciais + chaves de sessão/pré-chaves/sender-keys)
 * como um registro individual — aqui, uma linha por chave na tabela
 * `whatsapp_sessao`, em vez de um arquivo por chave.
 */

const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const { run, get } = require('../db');

async function lerChave(chave) {
  const row = await get('SELECT valor FROM whatsapp_sessao WHERE chave = ?', [chave]);
  if (!row) return null;

  try {
    return JSON.parse(row.valor, BufferJSON.reviver);
  } catch {
    return null;
  }
}

async function gravarChave(chave, valor) {
  const texto = JSON.stringify(valor, BufferJSON.replacer);

  await run(
    `INSERT INTO whatsapp_sessao (chave, valor, atualizado_em)
     VALUES (?, ?, to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = EXCLUDED.atualizado_em`,
    [chave, texto]
  );
}

async function removerChave(chave) {
  await run('DELETE FROM whatsapp_sessao WHERE chave = ?', [chave]);
}

/**
 * Apaga toda a sessão salva — usado quando o admin força um novo login
 * (ex: número foi desconectado do WhatsApp pelo celular).
 */
async function limparSessao() {
  await run('DELETE FROM whatsapp_sessao');
}

async function usePostgresAuthState() {
  const credsSalvas = await lerChave('creds');
  const creds = credsSalvas || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const dados = {};

          await Promise.all(
            ids.map(async (id) => {
              let valor = await lerChave(`${type}-${id}`);

              if (type === 'app-state-sync-key' && valor) {
                valor = proto.Message.AppStateSyncKeyData.fromObject(valor);
              }

              dados[id] = valor;
            })
          );

          return dados;
        },

        set: async (dados) => {
          const tarefas = [];

          for (const categoria of Object.keys(dados)) {
            for (const id of Object.keys(dados[categoria])) {
              const valor = dados[categoria][id];
              const chave = `${categoria}-${id}`;
              tarefas.push(valor ? gravarChave(chave, valor) : removerChave(chave));
            }
          }

          await Promise.all(tarefas);
        },
      },
    },

    saveCreds: () => gravarChave('creds', creds),
  };
}

module.exports = { usePostgresAuthState, limparSessao };
