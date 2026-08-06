/**
 * Logger estruturado (JSON) para o módulo de WhatsApp/OCR — mais fácil
 * de filtrar/pesquisar nos logs do Render do que `console.log` solto,
 * e cada linha já vem com timestamp e nível.
 */

const pino = require('pino');

// JSON puro por linha, sem dependência extra de formatação — o painel
// de logs do Render (e qualquer ferramenta de log) já sabe ler isso.
// Um "pino-pretty" para desenvolvimento local foi deixado de fora de
// propósito: transports do pino rodam em worker thread e, se o pacote
// não estivesse instalado, derrubaria o boot — não vale o risco por só
// deixar o log mais bonito localmente.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { modulo: 'whatsapp-financeiro' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
