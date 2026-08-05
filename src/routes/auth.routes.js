const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { get } = require('../db');
const { jwtSecret } = require('../config/env');
const asyncHandler = require('../middleware/asyncHandler');
const loginRateLimiter = require('../middleware/loginRateLimiter');
const AppError = require('../utils/AppError');

const router = express.Router();

router.post(
  '/login',
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
      throw new AppError(400, 'Informe usuário e senha.');
    }

    const user = await get('SELECT * FROM users WHERE usuario = ?', [usuario]);

    // Mensagem genérica de propósito (não revela se o usuário existe ou não).
    if (!user || !(await bcrypt.compare(senha, user.senha))) {
      throw new AppError(401, 'Usuário ou senha inválidos');
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, nome: user.nome },
      jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({ token, role: user.role, nome: user.nome });
  })
);

module.exports = router;
