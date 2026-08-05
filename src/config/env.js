/**
 * Carrega e valida as variáveis de ambiente.
 *
 * Por quê: antes o server.js usava process.env.* direto em vários lugares
 * (PORT, JWT_SECRET, ADMIN_USER, ADMIN_PASSWORD) sem checar se existiam.
 * Se o .env estivesse incompleto, o servidor subia mesmo assim e falhava
 * de forma confusa (ex: jwt.sign com secret undefined, listen em porta
 * undefined). Agora falha rápido e com uma mensagem clara no boot.
 */

require('dotenv').config();

const required = ['JWT_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD'];
const missing = required.filter((key) => !process.env[key] || !String(process.env[key]).trim());

if (missing.length) {
  console.error(
    `[config] Variáveis de ambiente obrigatórias ausentes no .env: ${missing.join(', ')}`
  );
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 16) {
  console.error(
    '[config] JWT_SECRET é muito curto/fraco. Use um valor aleatório com pelo menos 32 caracteres.'
  );
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET,
  adminUser: process.env.ADMIN_USER,
  adminPassword: process.env.ADMIN_PASSWORD,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || null,
};
