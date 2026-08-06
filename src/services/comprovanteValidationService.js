/**
 * Regras de validação automática do comprovante.
 *
 * Regra de ouro pedida explicitamente: NUNCA aprovar automaticamente
 * quando houver qualquer dúvida. Isso está implementado de forma
 * literal — só existe aprovação automática se TODAS as checagens
 * obrigatórias passarem; qualquer falha (inclusive "não consegui ler
 * esse campo") joga para "em_analise", nunca para "rejeitado" sozinho
 * (rejeitar é sempre uma decisão de admin, não do sistema — ver Etapa 4).
 */

const { pix: pixConfig } = require('../config/env');

const TOLERANCIA_VALOR = 0.01; // arredondamento de centavos
const DIAS_RECENCIA_MAXIMA = 2; // comprovante não pode ser "antigo demais"
const CONFIANCA_OCR_MINIMA = 0.55;

function normalizarCnpj(valor) {
  return (valor || '').replace(/\D/g, '');
}

function dataEhRecente(dataIso) {
  if (!dataIso) return false;

  const dataComprovante = new Date(`${dataIso}T00:00:00`);
  if (Number.isNaN(dataComprovante.getTime())) return false;

  const diffDias = (Date.now() - dataComprovante.getTime()) / (1000 * 60 * 60 * 24);
  return diffDias >= -1 && diffDias <= DIAS_RECENCIA_MAXIMA; // -1 tolera fuso horário
}

/**
 * @param {ReturnType<typeof import('./ocrService').lerComprovante> extends Promise<infer T> ? T : never} ocr
 * @param {{valorEsperado: number}} contexto
 */
function validarComprovante(ocr, contexto) {
  const checks = {
    cnpjBate: normalizarCnpj(ocr.cnpj) === normalizarCnpj(pixConfig.chave),
    valorBate: ocr.valor !== null && Math.abs(ocr.valor - contexto.valorEsperado) <= TOLERANCIA_VALOR,
    dataRecente: dataEhRecente(ocr.data),
    estruturaPix: ocr.tipoTransacao === 'PIX' || /pix/i.test(ocr.textoCompleto || ''),
    temFavorecido: !!ocr.nomeFavorecido,
    confiancaOcrSuficiente: ocr.confiancaOcr >= CONFIANCA_OCR_MINIMA,
  };

  // Checagens obrigatórias pra aprovação automática. "temFavorecido" fica
  // de fora dessa lista — é um indício a mais, não bloqueante sozinho,
  // porque o Tesseract erra bastante nesse campo especificamente.
  const obrigatorias = ['cnpjBate', 'valorBate', 'dataRecente', 'estruturaPix', 'confiancaOcrSuficiente'];
  const aprovadoAutomaticamente = obrigatorias.every((chave) => checks[chave]);

  const motivosDuvida = obrigatorias.filter((chave) => !checks[chave]);

  return {
    aprovadoAutomaticamente,
    checks,
    motivosDuvida,
    confianca: ocr.confiancaOcr,
  };
}

module.exports = { validarComprovante };
