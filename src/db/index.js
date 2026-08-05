/**
 * Conexão com o SQLite + wrappers em Promise.
 *
 * Por quê mudou:
 * - Antes: `new sqlite3.Database('./database.db')` usa caminho RELATIVO ao
 *   diretório de onde o processo foi iniciado (cwd), não à pasta do projeto.
 *   Se alguém iniciar o servidor de outra pasta (outro atalho, outro script,
 *   pm2, etc.) o Node cria um banco NOVO E VAZIO nesse lugar, silenciosamente.
 *   Isso já causou um banco "fantasma" fora da pasta do projeto neste
 *   histórico do sistema. Agora o caminho é sempre absoluto, baseado em
 *   __dirname, então o banco usado é sempre o mesmo, não importa de onde
 *   o `node` é chamado.
 * - Antes: toda query usava callback (`db.run(sql, params, (err, row) => {...})`)
 *   e vários lugares no server.js não verificavam `err` antes de usar o
 *   resultado (ex: DELETE /funcionarios/:id e /entregadores/:id liam
 *   `row.total` sem checar erro — se a query falhasse, `row` seria
 *   `undefined` e o acesso a `row.total` derrubava o processo inteiro,
 *   tirando o sistema do ar para todo mundo). Os wrappers abaixo sempre
 *   rejeitam a Promise em caso de erro, então isso é tratado de forma
 *   centralizada pelo middleware de erro (ver src/middleware/errorHandler.js).
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '..', '..', 'database.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[db] Falha ao abrir o banco de dados:', err.message);
    process.exit(1);
  }
});

// Garante integridade referencial nas checagens em nível de aplicação
// e ativa o enforcement nativo do SQLite para tabelas futuras.
db.run('PRAGMA foreign_keys = ON');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function callback(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = { db, run, get, all, exec, DB_PATH };
