/**
 * Extrai campos estruturados do texto bruto lido pelo OCR.
 *
 * Isso é heurística baseada em regex/palavras-chave, não IA — o
 * Tesseract só devolve texto solto, sem estrutura. Layouts de
 * comprovante PIX variam muito entre bancos, então nem todo campo é
 * encontrado em todo comprovante; os que não forem encontrados voltam
 * como `null`, e a validação (comprovanteValidationService.js) já leva
 * isso em conta — campo ausente nunca vira aprovação automática.
 */

function normalizarTexto(texto) {
  return (texto || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
}

/**
 * O Tesseract às vezes insere um espaço espúrio no meio de uma sequência
 * numérica (ex.: "37.937 .310/0001-47" em vez de "37.937.310/0001-47").
 * Isso quebraria qualquer regex de CNPJ/valor que exija os dígitos
 * colados — remove só esses espaços "no meio de número", sem mexer no
 * espaçamento normal entre palavras.
 */
function corrigirEspacosEmNumeros(texto) {
  return texto.replace(/(\d)\s+(?=[.\-/]?\d)/g, '$1');
}

function extrairValor(texto) {
  // Ex: "R$ 150,00", "R$150.00", "Valor: R$ 1.234,56"
  const match = corrigirEspacosEmNumeros(texto).match(/R\$\s*([\d.,]+)/i);
  if (!match) return null;

  const bruto = match[1];
  // Formato brasileiro: ponto de milhar, vírgula decimal.
  const normalizado = bruto.includes(',')
    ? bruto.replace(/\./g, '').replace(',', '.')
    : bruto;

  const numero = parseFloat(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function extrairCnpj(texto) {
  const limpo = corrigirEspacosEmNumeros(texto);

  // Preferência 1: formato pontuado (XX.XXX.XXX/XXXX-XX) — é como um
  // CNPJ impresso quase sempre aparece, e evita confundir com outro
  // número longo do comprovante (ex.: um código de transação que, por
  // coincidência, também tem 14 dígitos seguidos).
  const comPontuacao = limpo.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  if (comPontuacao) return comPontuacao[0].replace(/\D/g, '');

  // Preferência 2 (mais permissiva): só aceita um número "parecido com
  // CNPJ" sem pontuação se estiver logo depois da palavra "CNPJ" —
  // nunca varre o texto inteiro atrás de 14 dígitos soltos, porque isso
  // é exatamente o que causou o falso positivo acima.
  const pertoDoRotulo = limpo.match(/CNPJ\s*[:\-]?\s*(\d{14})\b/i);
  if (pertoDoRotulo) return pertoDoRotulo[1];

  return null;
}

function extrairData(texto) {
  // dd/mm/aaaa ou dd/mm/aa
  const match = corrigirEspacosEmNumeros(texto).match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!match) return null;

  let [, dia, mes, ano] = match;
  if (ano.length === 2) ano = `20${ano}`;

  return `${ano}-${mes}-${dia}`;
}

function extrairHora(texto) {
  const match = corrigirEspacosEmNumeros(texto).match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  return match ? match[0] : null;
}

function extrairCampoPorRotulo(texto, rotulos) {
  for (const rotulo of rotulos) {
    const regex = new RegExp(`${rotulo}\\s*[:\\-]?\\s*([^\\n]{2,60})`, 'i');
    const match = texto.match(regex);
    if (match) return match[1].trim();
  }
  return null;
}

function extrairTipoTransacao(texto) {
  if (/pix/i.test(texto)) return 'PIX';
  if (/ted/i.test(texto)) return 'TED';
  if (/doc/i.test(texto)) return 'DOC';
  return null;
}

function extrairCodigoTransacao(texto) {
  return extrairCampoPorRotulo(texto, ['id da transa[çc][ãa]o', 'c[oó]digo(?: da opera[çc][ãa]o)?', 'identificador', 'e2e']);
}

function analisarComprovante(textoOcr) {
  const texto = normalizarTexto(textoOcr);

  return {
    valor: extrairValor(texto),
    cnpj: extrairCnpj(texto),
    data: extrairData(texto),
    hora: extrairHora(texto),
    banco: extrairCampoPorRotulo(texto, ['banco']),
    instituicao: extrairCampoPorRotulo(texto, ['institui[çc][ãa]o']),
    nomeFavorecido: extrairCampoPorRotulo(texto, ['favorecido', 'beneficiário', 'recebedor', 'destinat[áa]rio']),
    tipoTransacao: extrairTipoTransacao(texto),
    codigoTransacao: extrairCodigoTransacao(texto),
    textoCompleto: texto,
  };
}

module.exports = { analisarComprovante };
