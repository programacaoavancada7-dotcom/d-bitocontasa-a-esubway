/**
 * Validações compartilhadas.
 *
 * Por quê: o server.js original confiava cegamente no que vinha do
 * `req.body`. Isso permitia, por exemplo, cadastrar um gasto com valor
 * vazio/negativo/texto (virava `NaN` no banco) ou com descrição em
 * branco (o schema exige NOT NULL, mas uma string vazia '' satisfaz
 * essa regra — e é exatamente por isso que hoje 292 dos 444 gastos
 * reais no banco têm descrição em branco). Estas funções centralizam
 * a validação para todas as rotas.
 */

const AppError = require('./AppError');

function requireString(value, fieldName, { min = 1, max = 255 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw new AppError(400, `Campo "${fieldName}" é obrigatório.`);
  }
  if (value.trim().length > max) {
    throw new AppError(400, `Campo "${fieldName}" excede o tamanho máximo de ${max} caracteres.`);
  }
  return value.trim();
}

function requireValidValor(value) {
  const numero = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);

  if (!Number.isFinite(numero) || numero <= 0) {
    throw new AppError(400, 'Informe um valor numérico maior que zero.');
  }

  // Evita valores absurdos digitados por engano (ex: 100000000).
  if (numero > 1_000_000) {
    throw new AppError(400, 'Valor informado é maior que o permitido.');
  }

  return Math.round(numero * 100) / 100;
}

function requirePassword(value, fieldName = 'senha') {
  if (typeof value !== 'string' || value.length < 6) {
    throw new AppError(400, `Campo "${fieldName}" deve ter pelo menos 6 caracteres.`);
  }
  return value;
}

const EMPRESAS_PADRAO = ['Açaí no Grau', 'Subway'];

function normalizeEmpresa(value) {
  const texto = typeof value === 'string' ? value.trim() : '';
  return texto.length ? texto : EMPRESAS_PADRAO[0];
}

module.exports = {
  requireString,
  requireValidValor,
  requirePassword,
  normalizeEmpresa,
  EMPRESAS_PADRAO,
};
