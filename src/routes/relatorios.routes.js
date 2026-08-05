const express = require('express');
const { auth, admin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const relatoriosService = require('../services/relatoriosService');

const router = express.Router();

// GET /admin/relatorios/resumo?ano=2026&mes=8
// Única fonte de cálculo de totais/ranking — ver relatoriosService.js.
router.get(
  '/admin/relatorios/resumo',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    const ano = req.query.ano ? Number(req.query.ano) : undefined;
    const mes = req.query.mes ? Number(req.query.mes) : undefined;
    res.json(await relatoriosService.getResumo({ ano, mes }));
  })
);

module.exports = router;
