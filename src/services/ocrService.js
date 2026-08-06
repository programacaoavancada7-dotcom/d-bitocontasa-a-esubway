/**
 * OCR gratuito e self-hosted: Tesseract.js (WASM — sem precisar instalar
 * binário no servidor, funciona no Render sem imagem Docker customizada)
 * + Sharp para pré-processar a imagem antes de ler (faz o papel que
 * OpenCV faria: escala de cinza, contraste, nitidez — mas com uma lib
 * que tem build confiável em qualquer ambiente de deploy).
 *
 * Importante sobre qualidade: Tesseract é sensivelmente mais fraco que
 * IA visual (GPT-4 Vision/Google Vision) pra ler foto/print de celular
 * com fontes variadas, logos de banco, marca d'água etc. Isso é
 * esperado e aceitável aqui porque a validação nunca aprova
 * automaticamente na dúvida (ver comprovanteValidationService.js) — na
 * prática, boa parte dos comprovantes deve cair em "em análise" pra
 * revisão manual, especialmente no início.
 */

const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { analisarComprovante } = require('../utils/comprovanteParser');
const logger = require('../utils/logger');

async function preprocessarImagem(buffer) {
  return sharp(buffer)
    .rotate() // corrige orientação EXIF (fotos de celular vêm rotacionadas)
    .resize({ width: 1600, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen()
    .toBuffer();
}

/**
 * @param {Buffer} buffer - imagem original (JPEG/PNG/WEBP). PDF não
 * passa por aqui — ver observação no comprovanteService.js.
 */
async function lerComprovante(buffer) {
  const imagemProcessada = await preprocessarImagem(buffer);

  const { data } = await Tesseract.recognize(imagemProcessada, 'por', {
    logger: () => {}, // silencia o progresso verboso do Tesseract nos logs
  });

  const confiancaOcr = (data.confidence || 0) / 100;
  const campos = analisarComprovante(data.text);

  logger.info(
    { confiancaOcr, temValor: !!campos.valor, temCnpj: !!campos.cnpj },
    'OCR do comprovante concluído'
  );

  return { ...campos, confiancaOcr };
}

module.exports = { lerComprovante, preprocessarImagem };
