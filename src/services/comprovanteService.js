/**
 * Orquestra o fluxo completo de um comprovante enviado pelo entregador:
 * salva o arquivo, encaminha pro grupo do WhatsApp, roda OCR, valida e
 * decide o status — nunca aprovando automaticamente na dúvida.
 */

const { run, get, all } = require('../db');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const gastosService = require('./gastosService');
const ocrService = require('./ocrService');
const { validarComprovante } = require('./comprovanteValidationService');
const { whatsapp: whatsappConfig } = require('../config/env');

function montarMensagemGrupo({ nome, id, telefone, valor, data, hora }) {
  return [
    'Comprovante de Pagamento de Débito',
    '',
    'Entregador:',
    nome,
    '',
    'ID:',
    String(id),
    '',
    'Telefone:',
    telefone || 'Não informado',
    '',
    'Valor do Débito:',
    `R$ ${valor.toFixed(2)}`,
    '',
    'Data:',
    data,
    '',
    'Hora:',
    hora,
    '',
    'Status:',
    'Aguardando validação automática.',
  ].join('\n');
}

async function enviarParaGrupoWhatsapp(comprovante, entregador, arquivo) {
  if (!whatsappConfig.habilitado) return;

  // Requer aqui dentro (não no topo do arquivo) para evitar dependência
  // circular: whatsappService -> whatsappQueueService -> ... não precisa
  // conhecer comprovanteService, mas o inverso é útil.
  const whatsappService = require('./whatsappService'); // eslint-disable-line global-require

  const agora = new Date();

  const texto = montarMensagemGrupo({
    nome: entregador.nome,
    id: entregador.id,
    telefone: entregador.telefone,
    valor: comprovante.valor_debito,
    data: agora.toLocaleDateString('pt-BR'),
    hora: agora.toLocaleTimeString('pt-BR'),
  });

  try {
    const jid = await whatsappService.enviarParaGrupo({
      texto,
      imagemBuffer: arquivo.mimetype === 'application/pdf' ? undefined : arquivo.buffer,
      imagemMimetype: arquivo.mimetype,
      tipo: 'comprovante',
      entregadorId: entregador.id,
      comprovanteId: comprovante.id,
    });

    await run(
      `UPDATE comprovantes SET whatsapp_status = 'enviado', whatsapp_grupo_jid = ? WHERE id = ?`,
      [jid, comprovante.id]
    );
  } catch (erro) {
    logger.error({ comprovanteId: comprovante.id, erro: erro.message }, 'Falha ao encaminhar comprovante para o grupo do WhatsApp');
    await run(`UPDATE comprovantes SET whatsapp_status = 'falhou' WHERE id = ?`, [comprovante.id]);
    // Não relança: falha no WhatsApp não deve impedir o registro/validação do comprovante.
  }
}

async function processarOcr(comprovante, arquivo) {
  if (arquivo.mimetype === 'application/pdf') {
    // Tesseract.js lê imagem, não PDF diretamente. Em vez de arriscar uma
    // lib extra de conversão PDF->imagem (mais um ponto de falha de
    // deploy), PDF sempre cai em revisão manual — mais seguro que
    // simplesmente não converter e "chutar" o conteúdo.
    return { status: 'em_analise', motivo: 'Comprovante em PDF: leitura automática não suportada, revisão manual necessária.' };
  }

  const ocr = await ocrService.lerComprovante(arquivo.buffer);
  const validacao = validarComprovante(ocr, { valorEsperado: comprovante.valor_debito });

  await run(
    `INSERT INTO comprovante_ocr
      (comprovante_id, valor_extraido, cnpj_extraido, nome_favorecido, banco, instituicao, data_extraida, hora_extraida, tipo_transacao, codigo_transacao, texto_completo, confianca, validacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      comprovante.id,
      ocr.valor,
      ocr.cnpj,
      ocr.nomeFavorecido,
      ocr.banco,
      ocr.instituicao,
      ocr.data,
      ocr.hora,
      ocr.tipoTransacao,
      ocr.codigoTransacao,
      ocr.textoCompleto,
      validacao.confianca,
      JSON.stringify(validacao.checks),
    ]
  );

  if (validacao.aprovadoAutomaticamente) {
    await gastosService.marcarTodosPagosDoEntregador(comprovante.entregador_id);

    await run(
      `UPDATE comprovantes
       SET status = 'confirmado', confirmado_em = to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS'), confirmado_por = 'sistema'
       WHERE id = ?`,
      [comprovante.id]
    );

    logger.info({ comprovanteId: comprovante.id, confianca: validacao.confianca }, 'Comprovante confirmado automaticamente');
    return { status: 'confirmado', confianca: validacao.confianca };
  }

  await run(`UPDATE comprovantes SET status = 'em_analise' WHERE id = ?`, [comprovante.id]);

  logger.info(
    { comprovanteId: comprovante.id, motivos: validacao.motivosDuvida },
    'Comprovante ficou em análise (não passou em todas as checagens automáticas)'
  );

  return { status: 'em_analise', motivosDuvida: validacao.motivosDuvida, confianca: validacao.confianca };
}

async function registrarComprovante({ entregador, arquivo, ip }) {
  const valorDebito = await gastosService.totalPendenteDoUsuario(entregador.id);

  if (valorDebito <= 0) {
    throw new AppError(400, 'Você não possui débito pendente no momento.');
  }

  const { lastID: comprovanteId } = await run(
    `INSERT INTO comprovantes (entregador_id, valor_debito, arquivo_dados, arquivo_mime, arquivo_tamanho, ip_envio, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pendente') RETURNING id`,
    [entregador.id, valorDebito, arquivo.buffer, arquivo.mimetype, arquivo.size, ip]
  );

  const comprovante = { id: comprovanteId, entregador_id: entregador.id, valor_debito: valorDebito };

  // Encaminhamento pro WhatsApp roda em paralelo, sem travar a resposta
  // por causa dele — se o WhatsApp estiver fora do ar, o comprovante já
  // foi salvo e a validação segue normalmente.
  enviarParaGrupoWhatsapp(comprovante, entregador, arquivo);

  let resultado;
  try {
    resultado = await processarOcr(comprovante, arquivo);
  } catch (erro) {
    logger.error({ comprovanteId, erro: erro.message }, 'Falha inesperada ao processar OCR');
    await run(`UPDATE comprovantes SET status = 'em_analise' WHERE id = ?`, [comprovanteId]);
    resultado = { status: 'em_analise', motivo: 'Não foi possível processar automaticamente — um admin vai revisar.' };
  }

  return { comprovanteId, valorDebito, ...resultado };
}

function listarPorEntregador(entregadorId) {
  return all(
    `SELECT id, valor_debito, arquivo_mime, status, whatsapp_status, confirmado_em, criado_em
     FROM comprovantes WHERE entregador_id = ? ORDER BY id DESC`,
    [entregadorId]
  );
}

async function buscarArquivo(comprovanteId, entregadorId) {
  const condicaoDono = entregadorId ? 'AND entregador_id = ?' : '';
  const params = entregadorId ? [comprovanteId, entregadorId] : [comprovanteId];

  const linha = await get(
    `SELECT arquivo_dados, arquivo_mime FROM comprovantes WHERE id = ? ${condicaoDono}`,
    params
  );

  if (!linha) throw new AppError(404, 'Comprovante não encontrado.');
  return linha;
}

/** Dados pra tela "Financeiro" do entregador: débito, histórico, situação. */
async function resumoFinanceiro(entregadorId) {
  const gastos = await gastosService.listarPorUsuario(entregadorId);
  const pendentes = gastos.filter((g) => g.status === 'pendente');
  const pagos = gastos.filter((g) => g.status === 'pago');
  const debitoAtual = pendentes.reduce((soma, g) => soma + Number(g.valor), 0);

  return {
    debitoAtual,
    situacao: debitoAtual > 0 ? 'pendente' : 'em_dia',
    // gastos já vêm ordenados por id decrescente (mais recente primeiro).
    ultimoPagamento: pagos[0]
      ? { valor: pagos[0].valor, data: pagos[0].data, descricao: pagos[0].descricao, empresa: pagos[0].empresa }
      : null,
    historicoDebitos: pendentes,
    historicoPagamentos: pagos,
  };
}

module.exports = {
  registrarComprovante,
  listarPorEntregador,
  buscarArquivo,
  resumoFinanceiro,
};
