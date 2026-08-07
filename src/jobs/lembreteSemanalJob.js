/**
 * Lembrete automático de débito, toda quarta-feira.
 *
 * Regras seguidas à risca do pedido original:
 * - Nunca manda tudo de uma vez: cada mensagem passa pela fila
 *   (whatsappQueueService), que já espaça envios com atraso aleatório
 *   quando `velocidade: 'lote'` (60–240s) e limita quantidade por
 *   minuto — ver whatsappQueueService.js para o porquê disso ser
 *   tratado como limite operacional, não "disfarce" de automação.
 * - Só manda pra quem realmente tem débito pendente > 0.
 * - Entregador sem telefone cadastrado é pulado (logado como aviso,
 *   não como erro — é uma lacuna de cadastro, não uma falha do job).
 *
 * Fuso horário: o Render roda em UTC por padrão. "Toda quarta às 9h"
 * sem fixar o fuso disparia às 9h UTC = 6h no horário de Brasília, não
 * é isso que se quer — por isso `timezone: 'America/Sao_Paulo'` explícito.
 */

const cron = require('node-cron');
const { get, all } = require('../db');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const gastosService = require('../services/gastosService');
const { whatsapp: whatsappConfig } = require('../config/env');

function montarMensagem(nome, valor) {
  return [
    `Olá, ${nome}.`,
    '',
    `Identificamos um débito pendente no valor de R$ ${valor.toFixed(2)}.`,
    '',
    'Acesse o sistema para efetuar o pagamento via PIX.',
    'Após o pagamento envie o comprovante pelo sistema.',
    '',
    'Obrigado.',
  ].join('\n');
}

/**
 * Checa se o módulo está pronto pra enviar (habilitado + conectado) uma
 * única vez, compartilhado pelo job semanal e pelos envios manuais da
 * lista de envio — evita enfileirar mensagens que vão só acumular
 * tentativas e falhar 8s depois porque o WhatsApp está desconectado.
 */
function garantirWhatsappPronto() {
  if (!whatsappConfig.habilitado) {
    throw new AppError(400, 'Módulo do WhatsApp está desabilitado (WHATSAPP_HABILITADO=false).');
  }

  // Requerido aqui dentro pra evitar dependência circular no boot
  // (whatsappService também pode, no futuro, precisar de algo daqui).
  const whatsappService = require('../services/whatsappService'); // eslint-disable-line global-require

  const statusAtual = whatsappService.obterStatus();
  if (statusAtual.status !== 'conectado') {
    throw new AppError(400, 'WhatsApp não está conectado no momento.');
  }

  return whatsappService;
}

/**
 * Envia a cobrança de débito pendente pra uma pessoa específica.
 * Não lança erro em caso de "sem débito"/"sem telefone" — devolve o
 * motivo pra quem chamou decidir o que fazer (o job semanal só conta
 * pra log; o envio individual vira um erro amigável pro admin).
 */
async function enviarCobrancaParaPessoa(pessoa, { velocidade = 'lote', tipo = 'lembrete', whatsappService, prioridade = false } = {}) {
  const total = await gastosService.totalPendenteDoUsuario(pessoa.id);
  if (total <= 0) return { enviado: false, motivo: 'sem_debito' };
  if (!pessoa.telefone) return { enviado: false, motivo: 'sem_telefone' };

  await whatsappService.enviarParaTelefone({
    telefone: pessoa.telefone,
    texto: montarMensagem(pessoa.nome, total),
    tipo,
    entregadorId: pessoa.id,
    velocidade,
    prioridade,
  });

  return { enviado: true, valor: total };
}

async function executarLembretes() {
  let whatsappService;
  try {
    whatsappService = garantirWhatsappPronto();
  } catch (erro) {
    logger.info({ motivo: erro.message }, 'Lembrete semanal ignorado');
    return { enviados: 0, ignorados: true, motivo: whatsappConfig.habilitado ? 'whatsapp_desconectado' : undefined };
  }

  const entregadores = await all(`SELECT id, nome, telefone FROM users WHERE role = 'entregador'`);

  let enviados = 0;
  let semTelefone = 0;
  let semDebito = 0;

  for (const pessoa of entregadores) {
    const resultado = await enviarCobrancaParaPessoa(pessoa, { velocidade: 'lote', tipo: 'lembrete', whatsappService });

    if (!resultado.enviado) {
      if (resultado.motivo === 'sem_debito') semDebito += 1;
      else {
        semTelefone += 1;
        logger.warn({ entregadorId: pessoa.id, nome: pessoa.nome }, 'Entregador com débito pendente mas sem telefone cadastrado — lembrete não enviado');
      }
      continue;
    }

    enviados += 1;
  }

  logger.info(
    { enviados, semTelefone, semDebito, totalEntregadores: entregadores.length },
    'Lembrete semanal de débito processado (entram na fila, envio real é gradual)'
  );

  return { enviados, semTelefone, semDebito };
}

/* =========================================================
   LISTA DE ENVIO (painel admin)
   Mesma régua de cobrança do job semanal, mas sob demanda: o admin vê
   cada entregador com o débito atual e o status do último envio, e
   dispara pra um só ou para vários selecionados.
========================================================= */

/**
 * @returns lista de entregadores com débito pendente e o status do
 * envio de cobrança/lembrete mais recente (se houver algum).
 */
function listarListaEnvio() {
  return all(`
    SELECT
      u.id, u.nome, u.telefone,
      COALESCE(deb.total, 0) AS debito_pendente,
      msg.tipo AS ultimo_envio_tipo,
      msg.status AS ultimo_envio_status,
      msg.criado_em AS ultimo_envio_em
    FROM users u
    LEFT JOIN (
      SELECT entregador_id, SUM(valor) AS total
      FROM gastos
      WHERE status = 'pendente' AND entregador_id IS NOT NULL
      GROUP BY entregador_id
    ) deb ON deb.entregador_id = u.id
    LEFT JOIN LATERAL (
      SELECT tipo, status, criado_em
      FROM whatsapp_mensagens m
      WHERE m.entregador_id = u.id AND m.tipo IN ('lembrete', 'cobranca')
      ORDER BY m.id DESC
      LIMIT 1
    ) msg ON true
    WHERE u.role = 'entregador'
    ORDER BY debito_pendente DESC, u.nome ASC
  `);
}

async function enviarCobrancaIndividual(entregadorId) {
  const whatsappService = garantirWhatsappPronto();

  const pessoa = await get(`SELECT id, nome, telefone FROM users WHERE id = ? AND role = 'entregador'`, [entregadorId]);
  if (!pessoa) throw new AppError(404, 'Entregador não encontrado.');

  // prioridade: true — é um clique único do admin pra UM entregador
  // específico ("Enviar cobrança agora"), não deve esperar atrás de um
  // lote de lembretes em andamento (ver whatsappQueueService.js).
  const resultado = await enviarCobrancaParaPessoa(pessoa, { velocidade: 'imediato', tipo: 'cobranca', whatsappService, prioridade: true });

  if (!resultado.enviado) {
    throw new AppError(
      400,
      resultado.motivo === 'sem_debito'
        ? 'Este entregador não possui débito pendente.'
        : 'Este entregador não tem telefone cadastrado.'
    );
  }

  logger.info({ entregadorId }, 'Cobrança individual enviada pela lista de envio');
  return { success: true, valor: resultado.valor };
}

async function enviarCobrancaLote(ids) {
  const whatsappService = garantirWhatsappPronto();

  let enviados = 0;
  let semDebito = 0;
  let semTelefone = 0;

  for (const id of ids) {
    const pessoa = await get(`SELECT id, nome, telefone FROM users WHERE id = ? AND role = 'entregador'`, [id]);
    if (!pessoa) continue;

    const resultado = await enviarCobrancaParaPessoa(pessoa, { velocidade: 'lote', tipo: 'cobranca', whatsappService });

    if (!resultado.enviado) {
      if (resultado.motivo === 'sem_debito') semDebito += 1;
      else semTelefone += 1;
      continue;
    }

    enviados += 1;
  }

  logger.info({ enviados, semDebito, semTelefone, solicitados: ids.length }, 'Cobrança em lote enviada pela lista de envio');
  return { enviados, semDebito, semTelefone };
}

function iniciar() {
  const expressao = process.env.LEMBRETE_CRON || '0 9 * * 3'; // quarta-feira, 9h

  cron.schedule(
    expressao,
    () => {
      executarLembretes().catch((erro) => logger.error({ erro: erro.message }, 'Falha ao executar o job de lembrete semanal'));
    },
    { timezone: 'America/Sao_Paulo' }
  );

  logger.info({ expressao, timezone: 'America/Sao_Paulo' }, 'Job de lembrete semanal agendado');
}

module.exports = {
  iniciar,
  executarLembretes,
  listarListaEnvio,
  enviarCobrancaIndividual,
  enviarCobrancaLote,
};
