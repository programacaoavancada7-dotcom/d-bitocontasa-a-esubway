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
const { all } = require('../db');
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

async function executarLembretes() {
  if (!whatsappConfig.habilitado) {
    logger.info('Lembrete semanal ignorado: módulo WhatsApp desabilitado (WHATSAPP_HABILITADO=false)');
    return { enviados: 0, ignorados: true };
  }

  // Requerido aqui dentro pra evitar dependência circular no boot
  // (whatsappService também pode, no futuro, precisar de algo daqui).
  const whatsappService = require('../services/whatsappService'); // eslint-disable-line global-require

  const statusAtual = whatsappService.obterStatus();
  if (statusAtual.status !== 'conectado') {
    logger.warn({ status: statusAtual.status }, 'Lembrete semanal ignorado: WhatsApp não está conectado no momento');
    return { enviados: 0, ignorados: true, motivo: 'whatsapp_desconectado' };
  }

  const entregadores = await all(`SELECT id, nome, telefone FROM users WHERE role = 'entregador'`);

  let enviados = 0;
  let semTelefone = 0;
  let semDebito = 0;

  for (const pessoa of entregadores) {
    const total = await gastosService.totalPendenteDoUsuario(pessoa.id);

    if (total <= 0) {
      semDebito += 1;
      continue;
    }

    if (!pessoa.telefone) {
      semTelefone += 1;
      logger.warn({ entregadorId: pessoa.id, nome: pessoa.nome }, 'Entregador com débito pendente mas sem telefone cadastrado — lembrete não enviado');
      continue;
    }

    await whatsappService.enviarParaTelefone({
      telefone: pessoa.telefone,
      texto: montarMensagem(pessoa.nome, total),
      tipo: 'lembrete',
      entregadorId: pessoa.id,
      velocidade: 'lote',
    });

    enviados += 1;
  }

  logger.info(
    { enviados, semTelefone, semDebito, totalEntregadores: entregadores.length },
    'Lembrete semanal de débito processado (entram na fila, envio real é gradual)'
  );

  return { enviados, semTelefone, semDebito };
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

module.exports = { iniciar, executarLembretes };
