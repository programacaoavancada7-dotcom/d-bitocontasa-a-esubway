/**
 * Upload do comprovante de pagamento.
 *
 * Segurança aplicada aqui:
 * - `memoryStorage`: o arquivo nunca toca o disco do servidor (que é
 *   efêmero no Render de qualquer forma) — vai direto pra memória e
 *   depois pro Postgres como BYTEA.
 * - Limite de tamanho (8 MB) — evita upload gigante travando o processo.
 * - Whitelist de mimetype DECLARADO pelo cliente (primeira barreira,
 *   fácil de falsificar) *e* verificação da assinatura binária real do
 *   arquivo (magic bytes) depois do upload — a parte que realmente
 *   importa, porque o Content-Type do multipart é só o que o navegador
 *   disse que é, não uma garantia.
 */

const multer = require('multer');
const AppError = require('../utils/AppError');

const TAMANHO_MAXIMO = 8 * 1024 * 1024; // 8 MB

const MIME_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO, files: 1 },
  fileFilter(req, file, cb) {
    if (!MIME_PERMITIDOS.has(file.mimetype)) {
      return cb(new AppError(400, 'Formato não aceito. Envie JPG, PNG, WEBP ou PDF.'));
    }
    cb(null, true);
  },
});

/** Assinaturas binárias (magic bytes) dos formatos aceitos. */
const ASSINATURAS = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

function bateAssinatura(buffer, assinatura) {
  if (buffer.length < assinatura.bytes.length) return false;
  return assinatura.bytes.every((byte, i) => buffer[i] === byte);
}

function ehWebpValido(buffer) {
  // RIFF <4 bytes tamanho> WEBP
  return buffer.length > 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
}

function validarAssinaturaReal(buffer, mimeDeclarado) {
  if (mimeDeclarado === 'image/webp') return ehWebpValido(buffer);
  const assinatura = ASSINATURAS.find((a) => a.mime === mimeDeclarado);
  return assinatura ? bateAssinatura(buffer, assinatura) : false;
}

/**
 * Middleware combinado: recebe o campo "comprovante" e já valida a
 * assinatura real do arquivo, rejeitando qualquer coisa cujo conteúdo
 * não bata com o tipo declarado (ex: um .exe renomeado pra .jpg).
 */
function uploadComprovante(req, res, next) {
  upload.single('comprovante')(req, res, (erro) => {
    if (erro instanceof multer.MulterError) {
      if (erro.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(400, 'Arquivo muito grande (máximo 8 MB).'));
      }
      return next(new AppError(400, `Erro no upload: ${erro.message}`));
    }
    if (erro) return next(erro);

    if (!req.file) {
      return next(new AppError(400, 'Nenhum arquivo enviado.'));
    }

    if (!validarAssinaturaReal(req.file.buffer, req.file.mimetype)) {
      return next(new AppError(400, 'O conteúdo do arquivo não corresponde a um comprovante válido.'));
    }

    next();
  });
}

module.exports = uploadComprovante;
