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

/* =========================================================
   PAINEL ADMINISTRATIVO
========================================================= */

/** @param {{status?: string}} filtro */
async function listarTodosAdmin({ status } = {}) {
  const condicoes = [];
  const params = [];

  if (status) {
    condicoes.push('c.status = ?');
    params.push(status);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  // DISTINCT ON (c.id) + "ORDER BY c.id DESC, ocr.id DESC" pega só a
  // tentativa de OCR mais recente de cada comprovante — sem isso, um
  // comprovante reprocessado (que gera uma nova linha em
  // comprovante_ocr a cada tentativa, de propósito, pra manter
  // histórico) apareceria duplicado na listagem.
  return all(
    `
    SELECT DISTINCT ON (c.id)
      c.id, c.entregador_id, c.valor_debito, c.status, c.whatsapp_status,
      c.confirmado_em, c.confirmado_por, c.motivo_rejeicao, c.criado_em,
      u.nome AS entregador_nome, u.telefone AS entregador_telefone,
      ocr.confianca
    FROM comprovantes c
    JOIN users u ON u.id = c.entregador_id
    LEFT JOIN comprovante_ocr ocr ON ocr.comprovante_id = c.id
    ${where}
    ORDER BY c.id DESC, ocr.id DESC
    `,
    params
  );
}

async function buscarDetalhesAdmin(id) {
  const comprovante = await get(
    `
    SELECT
      c.id, c.entregador_id, c.valor_debito, c.arquivo_mime, c.arquivo_tamanho, c.ip_envio,
      c.status, c.whatsapp_status, c.whatsapp_message_id, c.whatsapp_grupo_jid,
      c.confirmado_em, c.confirmado_por, c.motivo_rejeicao, c.criado_em,
      u.nome AS entregador_nome, u.telefone AS entregador_telefone, u.usuario AS entregador_usuario
    FROM comprovantes c
    JOIN users u ON u.id = c.entregador_id
    WHERE c.id = ?
    `,
    [id]
  );

  if (!comprovante) throw new AppError(404, 'Comprovante não encontrado.');

  const ocrHistorico = await all(
    'SELECT * FROM comprovante_ocr WHERE comprovante_id = ? ORDER BY id DESC',
    [id]
  );

  return { ...comprovante, ocrHistorico };
}

async function aprovarManualmente(id, adminNome) {
  const comprovante = await get('SELECT * FROM comprovantes WHERE id = ?', [id]);
  if (!comprovante) throw new AppError(404, 'Comprovante não encontrado.');
  if (comprovante.status === 'confirmado') throw new AppError(400, 'Este comprovante já está confirmado.');

  await gastosService.marcarTodosPagosDoEntregador(comprovante.entregador_id);

  await run(
    `UPDATE comprovantes
     SET status = 'confirmado', confirmado_em = to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS'), confirmado_por = ?, motivo_rejeicao = NULL
     WHERE id = ?`,
    [adminNome, id]
  );

  logger.info({ comprovanteId: id, admin: adminNome }, 'Comprovante aprovado manualmente por admin');
  return { success: true };
}

async function rejeitar(id, adminNome, motivo) {
  const comprovante = await get('SELECT * FROM comprovantes WHERE id = ?', [id]);
  if (!comprovante) throw new AppError(404, 'Comprovante não encontrado.');

  if (comprovante.status === 'confirmado') {
    throw new AppError(400, 'Este comprovante já foi confirmado (o débito já foi marcado como pago) — não é possível rejeitar depois.');
  }

  await run(
    `UPDATE comprovantes
     SET status = 'rejeitado', confirmado_em = to_char(now() - interval '3 hours', 'YYYY-MM-DD HH24:MI:SS'), confirmado_por = ?, motivo_rejeicao = ?
     WHERE id = ?`,
    [adminNome, motivo || null, id]
  );

  logger.info({ comprovanteId: id, admin: adminNome, motivo }, 'Comprovante rejeitado por admin');
  return { success: true };
}

async function reprocessarOcr(id) {
  const comprovante = await get(
    'SELECT id, entregador_id, valor_debito, arquivo_dados, arquivo_mime FROM comprovantes WHERE id = ?',
    [id]
  );

  if (!comprovante) throw new AppError(404, 'Comprovante não encontrado.');
  if (!comprovante.arquivo_dados) {
    throw new AppError(400, 'Este comprovante não tem uma imagem armazenada para reprocessar (provavelmente é um PDF).');
  }

  const resultado = await processarOcr(comprovante, { buffer: comprovante.arquivo_dados, mimetype: comprovante.arquivo_mime });
  logger.info({ comprovanteId: id }, 'OCR reprocessado manualmente por admin');
  return resultado;
}

async function enviarMensagemEntregador(entregadorId, texto) {
  const entregador = await get(`SELECT id, nome, telefone FROM users WHERE id = ? AND role = 'entregador'`, [entregadorId]);
  if (!entregador) throw new AppError(404, 'Entregador não encontrado.');
  if (!entregador.telefone) throw new AppError(400, 'Este entregador não tem telefone cadastrado.');

  const whatsappService = require('./whatsappService'); // eslint-disable-line global-require
  await whatsappService.enviarParaTelefone({
    telefone: entregador.telefone,
    texto,
    tipo: 'admin_mensagem',
    entregadorId,
    velocidade: 'imediato',
  });

  return { success: true };
}

async function solicitarNovoComprovante(comprovanteId) {
  const comprovante = await get('SELECT entregador_id FROM comprovantes WHERE id = ?', [comprovanteId]);
  if (!comprovante) throw new AppError(404, 'Comprovante não encontrado.');

  return enviarMensagemEntregador(
    comprovante.entregador_id,
    'Seu comprovante enviado não pôde ser validado. Por favor, acesse o sistema e envie um novo comprovante de pagamento.'
  );
}

module.exports = {
  registrarComprovante,
  listarPorEntregador,
  buscarArquivo,
  resumoFinanceiro,
  listarTodosAdmin,
  buscarDetalhesAdmin,
  aprovarManualmente,
  rejeitar,
  reprocessarOcr,
  enviarMensagemEntregador,
  solicitarNovoComprovante,
};
