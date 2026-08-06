/**
 * Localiza o grupo do WhatsApp pelo nome e resolve/guarda o JID.
 *
 * Regra pedida: se existir mais de um grupo com o mesmo nome, o sistema
 * não deve "adivinhar" qual usar — usa o JID que já estiver configurado
 * (`whatsapp_grupo_config`). Por isso:
 *  - 1 grupo encontrado com esse nome → resolve e guarda sozinho.
 *  - 0 grupos encontrados → erro registrado, admin precisa ser avisado.
 *  - 2+ grupos encontrados → NÃO escolhe automaticamente; loga um aviso
 *    listando os candidatos e exige que um admin fixe o JID manualmente
 *    (ver PUT /admin/whatsapp/grupo em whatsapp.routes.js).
 */

const { run, get } = require('../db');
const logger = require('../utils/logger');

class GrupoNaoEncontradoError extends Error {
  constructor(nome) {
    super(`Grupo do WhatsApp "${nome}" não foi encontrado entre os grupos participados pelo número conectado.`);
    this.name = 'GrupoNaoEncontradoError';
  }
}

class GrupoAmbiguoError extends Error {
  constructor(nome, candidatos) {
    super(`Existem ${candidatos.length} grupos chamados "${nome}". Configure manualmente qual usar.`);
    this.name = 'GrupoAmbiguoError';
    this.candidatos = candidatos;
  }
}

async function buscarConfig(nome) {
  return get('SELECT * FROM whatsapp_grupo_config WHERE nome = ?', [nome]);
}

async function salvarConfig(nome, jid, resolvidoAutomaticamente) {
  await run(
    `INSERT INTO whatsapp_grupo_config (nome, jid, resolvido_automaticamente, atualizado_em)
     VALUES (?, ?, ?, to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (nome) DO UPDATE SET jid = EXCLUDED.jid, resolvido_automaticamente = EXCLUDED.resolvido_automaticamente, atualizado_em = EXCLUDED.atualizado_em`,
    [nome, jid, resolvidoAutomaticamente]
  );
}

/**
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} nomeGrupo
 * @param {{ forcarBusca?: boolean }} opcoes - ignora o cache e busca de novo
 */
async function resolverJidDoGrupo(sock, nomeGrupo, { forcarBusca = false } = {}) {
  const config = await buscarConfig(nomeGrupo);

  // Se um admin já fixou manualmente, sempre respeita isso — nunca
  // sobrescreve automaticamente (é exatamente pra isso que existe).
  if (config && config.jid && !config.resolvido_automaticamente) {
    return config.jid;
  }

  if (config && config.jid && !forcarBusca) {
    return config.jid;
  }

  const grupos = await sock.groupFetchAllParticipating();
  const candidatos = Object.values(grupos).filter((g) => g.subject === nomeGrupo);

  if (candidatos.length === 0) {
    logger.error({ nomeGrupo }, 'Grupo do WhatsApp não encontrado');
    throw new GrupoNaoEncontradoError(nomeGrupo);
  }

  if (candidatos.length > 1) {
    logger.warn(
      { nomeGrupo, candidatos: candidatos.map((g) => g.id) },
      'Mais de um grupo com o mesmo nome — configuração manual necessária'
    );
    throw new GrupoAmbiguoError(nomeGrupo, candidatos.map((g) => ({ jid: g.id, participantes: g.participants?.length || 0 })));
  }

  const jid = candidatos[0].id;
  await salvarConfig(nomeGrupo, jid, true);
  logger.info({ nomeGrupo, jid }, 'Grupo do WhatsApp resolvido e salvo em cache');

  return jid;
}

async function definirJidManualmente(nomeGrupo, jid) {
  await salvarConfig(nomeGrupo, jid, false);
}

module.exports = {
  resolverJidDoGrupo,
  definirJidManualmente,
  buscarConfig,
  GrupoNaoEncontradoError,
  GrupoAmbiguoError,
};
