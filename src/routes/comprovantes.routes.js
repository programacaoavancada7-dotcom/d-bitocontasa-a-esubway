const express = require('express');
const { auth, entregador } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const uploadComprovante = require('../middleware/uploadComprovante');
const comprovanteService = require('../services/comprovanteService');
const pessoasService = require('../services/pessoasService');
const { pix } = require('../config/env');

const router = express.Router();

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

module.exports = router;
