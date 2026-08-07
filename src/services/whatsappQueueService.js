/**
 * Fila de envio de mensagens do WhatsApp.
 *
 * Por quê existe uma fila em vez de enviar direto: dois motivos.
 * 1) Confiabilidade — cada job vira uma linha em `whatsapp_mensagens`
 *    ANTES de tentar enviar, então se o processo cair no meio, o job
 *    fica com status 'pendente' no banco e é retomado no próximo boot
 *    (ver `retomarPendentes`), em vez de simplesmente desaparecer.
 * 2) Limite de envio — manda um de cada vez, com um intervalo entre
 *    mensagens. Para lembretes em lote (Etapa 4) o intervalo é maior e
 *    variável (60–240s, como pedido) para não sobrecarregar o número;
 *    para o encaminhamento do comprovante ao grupo (evento único, não
 *    é lote) o intervalo é curto, só o suficiente para não disparar
 *    duas mensagens coladas uma na outra.
 *
 * Importante: isso é limitação de envio por confiabilidade/operação,
 * não uma tentativa de "disfarçar" automação — ver a conversa que
 * definiu esse módulo.
 */

const { run, get, all } = require('../db');
const logger = require('../utils/logger');

const VELOCIDADE = {
  imediato: { min: 2000, max: 5000 },
  lote: { min: 60_000, max: 240_000 },
};

const MAX_TENTATIVAS = 3;
const LIMITE_POR_MINUTO = 8;

class WhatsappQueueService {
  constructor() {
    this.fila = [];
    this.processando = false;
    this.enviosRecentes = []; // timestamps, para o limite por minuto
    this.enviarFn = null; // injetado por whatsappService (evita dependência circular)
  }

  configurarEnvio(fn) {
    this.enviarFn = fn;
  }

  /**
   * @param {{tipo:string, destinoJid:string, texto?:string, imagemBuffer?:Buffer, imagemMimetype?:string, entregadorId?:number, comprovanteId?:number, velocidade?:'imediato'|'lote', prioridade?:boolean}} job
   *
   * `prioridade: true` (ex: admin clicou "Enviar cobrança agora" pra
   * UM entregador específico) entra no INÍCIO da fila em vez do fim —
   * assim não fica esperando atrás de um lote de lembretes em
   * andamento (que pode levar minutos, com 60–240s entre cada envio).
   * Continua passando pelo mesmo registro em `whatsapp_mensagens` e
   * pelo limite por minuto — isso é sobre ordem de prioridade, não
   * sobre pular as proteções de confiabilidade/limite de envio.
   */
  async enfileirar(job) {
    const { lastID } = await run(
      `INSERT INTO whatsapp_mensagens (tipo, destino_jid, entregador_id, comprovante_id, conteudo, status)
       VALUES (?, ?, ?, ?, ?, 'pendente') RETURNING id`,
      [job.tipo, job.destinoJid, job.entregadorId || null, job.comprovanteId || null, job.texto || null]
    );

    const item = { ...job, mensagemId: lastID, tentativas: 0 };
    if (job.prioridade) this.fila.unshift(item);
    else this.fila.push(item);

    this._processar();

    return lastID;
  }

  /** Recarrega jobs que ficaram 'pendente' no banco (ex: processo reiniciou no meio da fila). */
  async retomarPendentes() {
    const pendentes = await all("SELECT * FROM whatsapp_mensagens WHERE status = 'pendente' ORDER BY id ASC");

    if (!pendentes.length) return;

    logger.info({ quantidade: pendentes.length }, 'Retomando mensagens pendentes do WhatsApp após reinício');

    for (const msg of pendentes) {
      this.fila.push({
        mensagemId: msg.id,
        tipo: msg.tipo,
        destinoJid: msg.destino_jid,
        texto: msg.conteudo,
        entregadorId: msg.entregador_id,
        comprovanteId: msg.comprovante_id,
        velocidade: 'imediato',
        tentativas: msg.tentativas || 0,
        // imagemBuffer não é persistido (é grande demais pra guardar em texto);
        // jobs de comprovante com imagem perdida no restart precisam ser
        // reenviados manualmente pelo admin — texto simples é reenviado ok.
      });
    }

    this._processar();
  }

  _dentroDoLimite() {
    const agora = Date.now();
    this.enviosRecentes = this.enviosRecentes.filter((t) => agora - t < 60_000);
    return this.enviosRecentes.length < LIMITE_POR_MINUTO;
  }

  async _processar() {
    if (this.processando) return;
    this.processando = true;

    while (this.fila.length) {
      if (!this._dentroDoLimite()) {
        logger.warn('Limite de mensagens por minuto atingido, aguardando');
        await esperar(10_000);
        continue;
      }

      const job = this.fila.shift();
      await this._executarJob(job);

      const faixa = VELOCIDADE[job.velocidade || 'imediato'];
      const atraso = faixa.min + Math.random() * (faixa.max - faixa.min);
      await esperar(atraso);
    }

    this.processando = false;
  }

  async _executarJob(job) {
    if (!this.enviarFn) {
      logger.error('WhatsappQueueService sem função de envio configurada');
      return;
    }

    try {
      const resultado = await this.enviarFn(job);
      this.enviosRecentes.push(Date.now());

      await run(
        `UPDATE whatsapp_mensagens
         SET status = 'enviado', message_id = ?, enviado_em = to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS')
         WHERE id = ?`,
        [resultado && resultado.key ? resultado.key.id : null, job.mensagemId]
      );

      logger.info({ mensagemId: job.mensagemId, tipo: job.tipo, destino: job.destinoJid }, 'Mensagem WhatsApp enviada');
    } catch (erro) {
      const tentativas = (job.tentativas || 0) + 1;
      logger.error({ mensagemId: job.mensagemId, tentativas, erro: erro.message }, 'Falha ao enviar mensagem WhatsApp');

      if (tentativas < MAX_TENTATIVAS) {
        await run('UPDATE whatsapp_mensagens SET tentativas = ? WHERE id = ?', [tentativas, job.mensagemId]);
        this.fila.push({ ...job, tentativas });
      } else {
        await run(
          `UPDATE whatsapp_mensagens SET status = 'falhou', erro = ?, tentativas = ? WHERE id = ?`,
          [erro.message.slice(0, 500), tentativas, job.mensagemId]
        );
      }
    }
  }
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = new WhatsappQueueService();
