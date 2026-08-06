/**
 * CRUD compartilhado para funcionários e entregadores.
 *
 * Por quê: no server.js original, as rotas de /funcionarios e
 * /entregadores eram cópias quase idênticas uma da outra (criar, listar,
 * editar e excluir), mudando só a string do `role`. Isso é ~250 linhas
 * duplicadas: qualquer correção (ex: a validação de senha que adicionamos
 * agora) tinha que ser feita duas vezes, e era fácil corrigir um lado e
 * esquecer o outro. Este serviço é parametrizado por `role` e usado pelos
 * dois conjuntos de rotas.
 */

const bcrypt = require('bcrypt');
const { run, get, all } = require('../db');
const AppError = require('../utils/AppError');
const { requireString, requirePassword } = require('../utils/validate');

const ROTULOS = {
  funcionario: 'Funcionário',
  entregador: 'Entregador',
};

function normalizarTelefone(telefone) {
  if (!telefone) return null;
  const digitos = telefone.replace(/\D/g, '');
  return digitos.length ? digitos : null;
}

async function criar(role, { nome, usuario, senha, telefone }) {
  const nomeValido = requireString(nome, 'nome');
  const usuarioValido = requireString(usuario, 'usuário');
  requirePassword(senha);

  const existente = await get('SELECT id FROM users WHERE usuario = ?', [usuarioValido]);
  if (existente) {
    throw new AppError(400, 'Usuário já existe');
  }

  const hash = await bcrypt.hash(senha, 10);
  const telefoneValido = normalizarTelefone(telefone);

  const { lastID } = await run(
    'INSERT INTO users (nome, usuario, senha, role, telefone) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [nomeValido, usuarioValido, hash, role, telefoneValido]
  );

  return { id: lastID, nome: nomeValido, usuario: usuarioValido, role, telefone: telefoneValido };
}

function listar(role) {
  return all(
    `SELECT id, nome, usuario, telefone FROM users WHERE role = ? ORDER BY nome ASC`,
    [role]
  );
}

async function atualizar(role, id, { nome, usuario, senha, telefone }) {
  const nomeValido = requireString(nome, 'nome');
  const usuarioValido = requireString(usuario, 'usuário');
  const telefoneValido = normalizarTelefone(telefone);

  const duplicado = await get(
    'SELECT id FROM users WHERE usuario = ? AND id != ?',
    [usuarioValido, id]
  );

  if (duplicado) {
    throw new AppError(400, 'Usuário já existe');
  }

  const alvo = await get('SELECT id FROM users WHERE id = ? AND role = ?', [id, role]);
  if (!alvo) {
    throw new AppError(404, `${ROTULOS[role]} não encontrado.`);
  }

  if (senha && senha.trim() !== '') {
    requirePassword(senha);
    const hash = await bcrypt.hash(senha, 10);

    await run(
      `UPDATE users SET nome=?, usuario=?, senha=?, telefone=? WHERE id=? AND role=?`,
      [nomeValido, usuarioValido, hash, telefoneValido, id, role]
    );
  } else {
    await run(
      `UPDATE users SET nome=?, usuario=?, telefone=? WHERE id=? AND role=?`,
      [nomeValido, usuarioValido, telefoneValido, id, role]
    );
  }

  return { success: true };
}

async function remover(role, id) {
  const totalGastos = await get(
    `SELECT COUNT(*) as total FROM gastos WHERE ${role === 'funcionario' ? 'funcionario_id' : 'entregador_id'} = ?`,
    [id]
  );

  if (totalGastos.total > 0) {
    throw new AppError(400, `${ROTULOS[role]} possui gastos cadastrados`);
  }

  const resultado = await run(`DELETE FROM users WHERE id = ? AND role = ?`, [id, role]);

  if (resultado.changes === 0) {
    throw new AppError(404, `${ROTULOS[role]} não encontrado.`);
  }

  return { success: true };
}

function buscarPorId(id) {
  return get('SELECT id, nome, usuario, role, telefone FROM users WHERE id = ?', [id]);
}

module.exports = { criar, listar, atualizar, remover, buscarPorId };
