const express = require('express');
const { auth, admin, entregador } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const uploadComprovante = require('../middleware/uploadComprovante');
const criarRateLimiter = require('../middleware/rateLimiter');
const comprovanteService = require('../services/comprovanteService');
const pessoasService = require('../services/pessoasService');
const AppError = require('../utils/AppError');
const { pix } = require('../config/env');

const router = express.Router();

// Evita que um entregador (de propósito ou por engano, ex: clicando
// "enviar" várias vezes) sobrecarregue o pipeline de OCR — que é
// razoavelmente pesado (Tesseract + Sharp rodando na mesma instância
// que serve o resto do ERP). 6 envios a cada 15 minutos é folgado pro
// uso real (ninguém paga o próprio débito 6 vezes seguidas) e barra
// abuso/spam.
const comprovanteUploadRateLimiter = criarRateLimiter({
  janelaMs: 15 * 60 * 1000,
  max: 6,
  obterChave: (req) => `comprovante:${req.user.id}`,
  mensagem: 'Muitos envios de comprovante em pouco tempo. Aguarde alguns minutos e tente novamente.',
});

// Dados da chave PIX pra tela de pagamento — nunca hardcoded no
// frontend, assim trocar a chave é só mudar o .env.
router.get(
  '/entregador/pix',
  auth,
  entregador,
  asyncHandler(async (req, res) => {
    res.json(pix);
  })
);

router.get(
  '/entregador/financeiro/resumo',
  auth,
  entregador,
  asyncHandler(async (req, res) => {
    res.json(await comprovanteService.resumoFinanceiro(req.user.id));
  })
);

router.post(
  '/entregador/comprovantes',
  auth,
  entregador,
  comprovanteUploadRateLimiter,
  uploadComprovante,
  asyncHandler(async (req, res) => {
    // Telefone não vai no token (pode ser editado depois do login), então
    // busca o cadastro atualizado direto do banco.
    const entregador = await pessoasService.buscarPorId(req.user.id);

    const resultado = await comprovanteService.registrarComprovante({
      entregador,
      arquivo: req.file,
      ip: req.ip,
    });

    res.json(resultado);
  })
);

router.get(
  '/entregador/comprovantes',
  auth,
  entregador,
  asyncHandler(async (req, res) => {
    res.json(await comprovanteService.listarPorEntregador(req.user.id));
  })
);

// Só o próprio entregador vê seu comprovante (o painel admin, na Etapa
// 4, usa uma rota separada sem essa restrição de dono).
router.get(
  '/entregador/comprovantes/:id/arquivo',
  auth,
  entregador,
  asyncHandler(async (req, res) => {
    const { arquivo_dados: dados, arquivo_mime: mime } = await comprovanteService.buscarArquivo(req.params.id, req.user.id);
    res.setHeader('Content-Type', mime);
    res.send(dados);
  })
);

/* =========================================================
   PAINEL ADMINISTRATIVO
========================================================= */

router.get(
  '/admin/comprovantes',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await comprovanteService.listarTodosAdmin({ status: req.query.status }));
  })
);

router.get(
  '/admin/comprovantes/:id',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await comprovanteService.buscarDetalhesAdmin(req.params.id));
  })
);

// Sem restrição de dono — o admin pode ver o comprovante de qualquer entregador.
router.get(
  '/admin/comprovantes/:id/arquivo',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    const { arquivo_dados: dados, arquivo_mime: mime } = await comprovanteService.buscarArquivo(req.params.id);
    res.setHeader('Content-Type', mime);
    res.send(dados);
  })
);

router.post(
  '/admin/comprovantes/:id/aprovar',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await comprovanteService.aprovarManualmente(req.params.id, req.user.nome));
  })
);

router.post(
  '/admin/comprovantes/:id/rejeitar',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await comprovanteService.rejeitar(req.params.id, req.user.nome, req.body.motivo));
  })
);

router.post(
  '/admin/comprovantes/:id/reprocessar',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await comprovanteService.reprocessarOcr(req.params.id));
  })
);

router.post(
  '/admin/comprovantes/:id/solicitar-novo',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await comprovanteService.solicitarNovoComprovante(req.params.id));
  })
);

router.post(
  '/admin/entregadores/:id/mensagem',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    const { texto } = req.body;
    if (!texto || !texto.trim()) throw new AppError(400, 'Escreva uma mensagem antes de enviar.');
    res.json(await comprovanteService.enviarMensagemEntregador(req.params.id, texto));
  })
);

module.exports = router;
