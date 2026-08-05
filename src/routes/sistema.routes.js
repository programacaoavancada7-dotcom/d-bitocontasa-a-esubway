const express = require('express');
const { auth, admin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const sistemaService = require('../services/sistemaService');

const router = express.Router();

// Ver src/services/sistemaService.js para o porquê desta rota agora
// exigir senha real + frase de confirmação, e gerar backup antes de apagar.
router.delete(
  '/resetar-sistema',
  auth,
  admin,
  asyncHandler(async (req, res) => {
    const { senha, confirmacao } = req.body;
    const resultado = await sistemaService.resetarGastos({
      adminId: req.user.id,
      senha,
      confirmacao,
    });
    res.json(resultado);
  })
);

module.exports = router;
