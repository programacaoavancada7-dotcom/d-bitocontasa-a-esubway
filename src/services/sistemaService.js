/**
 * Reset do sistema (apaga todos os gastos).
 *
 * Isso substitui o mecanismo antigo, que era puramente decorativo:
 * o botão "Resetar" pedia duas vezes uma "senha de reset" fixa
 * ("blackout") **verificada só no JavaScript do navegador**. Qualquer
 * pessoa com acesso ao DevTools (F12) via visualizar o código-fonte e
 * ler a senha, e pior: a rota `DELETE /resetar-sistema` no servidor não
 * conferia senha nenhuma — bastava ter um token de admin (inclusive um
 * token roubado) para apagar os 444 gastos reais do sistema com uma
 * única requisição, sem confirmação de verdade e sem qualquer backup.
 *
 * Agora:
 *  1. O servidor exige a SENHA REAL da conta admin (conferida com bcrypt),
 *     não uma senha mágica separada visível no código-fonte.
 *  2. Exige também que o admin digite a frase exata "APAGAR TUDO", como
 *     segunda confirmação, para reduzir cliques acidentais/scripts.
 *  3. Antes de apagar, salva um backup em JSON de todos os gastos em
 *     backups/, com carimbo de data/hora — então mesmo um reset
 *     deliberado pode ser revertido manualmente lendo esse arquivo.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { run, get, all } = require('../db');
const AppError = require('../utils/AppError');

const BACKUPS_DIR = path.join(__dirname, '..', '..', 'backups');
const FRASE_CONFIRMACAO = 'APAGAR TUDO';

async function resetarGastos({ adminId, senha, confirmacao }) {
  if (confirmacao !== FRASE_CONFIRMACAO) {
    throw new AppError(400, `Digite exatamente "${FRASE_CONFIRMACAO}" para confirmar.`);
  }

  const admin = await get('SELECT * FROM users WHERE id = ? AND role = ?', [adminId, 'admin']);
  if (!admin) {
    throw new AppError(403, 'Acesso negado.');
  }

  const senhaOk = await bcrypt.compare(senha || '', admin.senha);
  if (!senhaOk) {
    throw new AppError(401, 'Senha incorreta.');
  }

  const gastos = await all('SELECT * FROM gastos');

  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const arquivo = path.join(
    BACKUPS_DIR,
    `gastos-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(arquivo, JSON.stringify(gastos, null, 2), 'utf-8');

  await run('DELETE FROM gastos');

  return { success: true, backup: path.basename(arquivo), registros: gastos.length };
}

module.exports = { resetarGastos, FRASE_CONFIRMACAO };
