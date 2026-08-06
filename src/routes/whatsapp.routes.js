const express = require('express');
const { auth, admin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const whatsappService = require('../services/whatsappService');
const groupService = require('../services/whatsappGroupService');
const { executarLembretes } = require('../jobs/lembreteSemanalJob');
const AppError = require('../utils/AppError');
const { whatsapp: whatsappConfig } = require('../config/env');

const router = express.Router();

// Status da conexão + QR Code (em base64) pra escanear pelo próprio painel,
// sem precisar abrir os logs do Render.
router.get(
  '/admin/whatsapp/status',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(whatsappService.obterStatus());
  })
);

router.post(
  '/admin/whatsapp/reconectar',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    await whatsappService.reconectarManualmente();
    res.json({ success: true });
  })
);

// Força um novo QR Code (ex: número foi desconectado do WhatsApp e a
// reconexão automática não resolve sozinha).
router.post(
  '/admin/whatsapp/novo-login',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    await whatsappService.forcarNovoLogin();
    res.json({ success: true });
  })
);

// Fixa manualmente o JID do grupo — usado quando existe mais de um
// grupo com o mesmo nome e a busca automática não pode decidir sozinha.
router.put(
  '/admin/whatsapp/grupo',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    const { nome, jid } = req.body;

    if (!nome || !jid) {
      throw new AppError(400, 'Informe "nome" e "jid".');
    }

    await groupService.definirJidManualmente(nome, jid);
    res.json({ success: true });
  })
);

router.get(
  '/admin/whatsapp/grupo',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    const atual = await groupService.buscarConfig(whatsappConfig.nomeGrupo);
    res.json(atual || { nome: whatsappConfig.nomeGrupo, jid: null });
  })
);

// Dispara o lembrete semanal na hora, sem esperar quarta-feira — útil
// pra testar e pra mandar um lembrete extra fora do horário fixo.
router.post(
  '/admin/lembretes/executar',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await executarLembretes());
  })
);

module.exports = router;
