const bcrypt = require('bcrypt');
const { run, get } = require('./index');
const { adminUser, adminPassword } = require('../config/env');

async function seedAdmin() {
  const existente = await get('SELECT id FROM users WHERE usuario = ?', [adminUser]);
  if (existente) return;

  const hash = await bcrypt.hash(adminPassword, 10);

  await run(
    'INSERT INTO users (nome, usuario, senha, role) VALUES (?, ?, ?, ?)',
    ['Administrador', adminUser, hash, 'admin']
  );

  console.log(`[db] Usuário admin "${adminUser}" criado.`);
}

module.exports = { seedAdmin };
