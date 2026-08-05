const express = require('express');
const { auth, admin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const gastosService = require('../services/gastosService');

const router = express.Router();

router.post(
  '/gastos',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await gastosService.criar(req.body));
  })
);

// Aceita ?ano=2026&mes=8 (opcionais) para filtrar o histórico — usado
// tanto pela tela quanto pelos relatórios em PDF, ver relatoriosService.js.
router.get(
  '/admin/gastos',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    const ano = req.query.ano ? Number(req.query.ano) : undefined;
    const mes = req.query.mes ? Number(req.query.mes) : undefined;
    res.json(await gastosService.listarTodos({ ano, mes }));
  })
);

router.get(
  '/meus-gastos',
  auth,
  asyncHandler(async (req, res) => {
    res.json(await gastosService.listarPorUsuario(req.user.id));
  })
);

router.get(
  '/meu-total',
  auth,
  asyncHandler(async (req, res) => {
    res.json({ total: await gastosService.totalPendenteDoUsuario(req.user.id) });
  })
);

router.put(
  '/gastos/:id/pago',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await gastosService.marcarComoPago(req.params.id));
  })
);

router.put(
  '/gastos/:id',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await gastosService.editar(req.params.id, req.body));
  })
);

router.delete(
  '/gastos/:id',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await gastosService.remover(req.params.id));
  })
);

module.exports = router;
