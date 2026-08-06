/**
 * Serviço central do WhatsApp (Baileys): conecta, reconecta, envia
 * texto/imagem, expõe status e QR Code para o painel admin.
 *
 * Fluxo de conexão:
 *  1º boot (sem sessão salva) → gera QR Code → admin escaneia pelo
 *  painel (`GET /admin/whatsapp/status` mostra a imagem do QR) → sessão
 *  fica salva no Postgres (whatsappAuthStore.js) → nos próximos boots
 *  (inclusive redeploys no Render) reconecta sozinho, sem novo QR.
 *
 * Este módulo é resiliente de propósito: se o WhatsApp não conectar,
 * ou cair, o resto do ERP continua funcionando normalmente — nenhuma
 * rota do sistema principal depende do WhatsApp estar no ar.
 */

const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');

const { usePostgresAuthState, limparSessao } = require('./whatsappAuthStore');
const { resolverJidDoGrupo, GrupoNaoEncontradoError, GrupoAmbiguoError } = require('./whatsappGroupService');
const queue = require('./whatsappQueueService');
const logger = require('../utils/logger');
const { whatsapp: config } = require('../config/env');

let sock = null;
let status = 'desconectado'; // desconectado | conectando | aguardando_qr | conectado
let qrCodeDataUrl = null;
let ultimoErro = null;
let tentativaReconexao = null;

async function conectar() {
  if (!config.habilitado) {
    logger.info('Módulo WhatsApp desabilitado (WHATSAPP_HABILITADO=false)');
    return;
  }

  status = 'conectando';
  ultimoErro = null;

  try {
    const { state, saveCreds } = await usePostgresAuthState();
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: logger.child({ origem: 'baileys-interno' }, { level: 'warn' }),
      browser: ['ERP Fiado', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', aoAtualizarConexao);

    queue.configurarEnvio(executarEnvio);
  } catch (erro) {
    status = 'desconectado';
    ultimoErro = erro.message;
    logger.error({ erro: erro.message }, 'Falha ao iniciar conexão com o WhatsApp');
    agendarReconexao();
  }
}

async function aoAtualizarConexao(update) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    status = 'aguardando_qr';
    qrCodeDataUrl = await QRCode.toDataURL(qr);
    logger.info('QR Code do WhatsApp gerado — acesse o painel admin para escanear');
  }

  if (connection === 'open') {
    status = 'conectado';
    qrCodeDataUrl = null;
    ultimoErro = null;
    logger.info('WhatsApp conectado com sucesso');
    queue.retomarPendentes();
  }

  if (connection === 'close') {
    const codigoErro = lastDisconnect?.error?.output?.statusCode;
    const foiLogout = codigoErro === DisconnectReason.loggedOut;

    status = 'desconectado';
    logger.warn({ codigoErro, foiLogout }, 'Conexão do WhatsApp encerrada');

    if (foiLogout) {
      ultimoErro = 'Sessão desconectada pelo celular. É necessário escanear um novo QR Code.';
      await limparSessao();
      qrCodeDataUrl = null;
    } else {
      ultimoErro = 'Conexão perdida, tentando reconectar automaticamente.';
      agendarReconexao();
    }
  }
}

function agendarReconexao() {
  if (tentativaReconexao) return;
  tentativaReconexao = setTimeout(() => {
    tentativaReconexao = null;
    conectar();
  }, 8000);
}

async function executarEnvio(job) {
  if (!sock || status !== 'conectado') {
    throw new Error('WhatsApp não está conectado no momento.');
  }

  if (job.imagemBuffer) {
    return sock.sendMessage(job.destinoJid, {
      image: job.imagemBuffer,
      mimetype: job.imagemMimetype || 'image/jpeg',
      caption: job.texto || undefined,
    });
  }

  return sock.sendMessage(job.destinoJid, { text: job.texto });
}

/**
 * Envia texto (e, opcionalmente, uma imagem logo em seguida) para o
 * grupo configurado, pela fila.
 */
async function enviarParaGrupo({ texto, imagemBuffer, imagemMimetype, tipo, entregadorId, comprovanteId }) {
  if (!sock) throw new Error('WhatsApp não inicializado.');

  const jid = await resolverJidDoGrupo(sock, config.nomeGrupo);

  if (texto) {
    await queue.enfileirar({ tipo, destinoJid: jid, texto, velocidade: 'imediato', entregadorId, comprovanteId });
  }

  if (imagemBuffer) {
    await queue.enfileirar({
      tipo,
      destinoJid: jid,
      imagemBuffer,
      imagemMimetype,
      velocidade: 'imediato',
      entregadorId,
      comprovanteId,
    });
  }

  return jid;
}

/** Envia mensagem individual para o telefone de uma pessoa (lembretes). */
async function enviarParaTelefone({ telefone, texto, tipo, entregadorId, velocidade = 'lote' }) {
  const jid = telefone.replace(/\D/g, '') + '@s.whatsapp.net';
  return queue.enfileirar({ tipo, destinoJid: jid, texto, velocidade, entregadorId });
}

function obterStatus() {
  return {
    status,
    qrCodeDataUrl,
    ultimoErro,
    grupoConfigurado: config.nomeGrupo,
    habilitado: config.habilitado,
  };
}

async function reconectarManualmente() {
  if (sock) {
    try { sock.end(undefined); } catch { /* já pode estar fechado */ }
  }
  await conectar();
}

async function forcarNovoLogin() {
  if (sock) {
    try { sock.end(undefined); } catch { /* ignora */ }
  }
  await limparSessao();
  qrCodeDataUrl = null;
  await conectar();
}

module.exports = {
  conectar,
  enviarParaGrupo,
  enviarParaTelefone,
  obterStatus,
  reconectarManualmente,
  forcarNovoLogin,
  GrupoNaoEncontradoError,
  GrupoAmbiguoError,
};
