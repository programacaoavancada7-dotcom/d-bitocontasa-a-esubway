const express = require('express');
const { auth, admin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const pessoasService = require('../services/pessoasService');

const router = express.Router();
const ROLE = 'entregador';

router.post(
  '/entregadores',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    await pessoasService.criar(ROLE, req.body);
    res.json({ success: true });
  })
);

router.get(
  '/entregadores',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await pessoasService.listar(ROLE));
  })
);

router.put(
  '/entregadores/:id',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await pessoasService.atualizar(ROLE, req.params.id, req.body));
  })
);

router.delete(
  '/entregadores/:id',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    res.json(await pessoasService.remover(ROLE, req.params.id));
  })
);

module.exports = router;
