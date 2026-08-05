require('dotenv').config();

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./database.db');

db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      role TEXT DEFAULT 'funcionario',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funcionario_id INTEGER,
      entregador_id INTEGER,
      valor REAL NOT NULL,
      descricao TEXT NOT NULL,
      empresa TEXT DEFAULT 'Açaí no Grau',
      status TEXT DEFAULT 'pendente',
      data DATETIME DEFAULT (datetime('now', '-3 hours'))
    )
  `);

  db.all(`PRAGMA table_info(gastos)`, (err, columns) => {

    if (err) return;

    const nomes = columns.map(col => col.name);

    if (!nomes.includes('entregador_id')) {

      db.run(`
        ALTER TABLE gastos
        ADD COLUMN entregador_id INTEGER
      `);

      console.log('Coluna entregador_id adicionada');
    }

    if (!nomes.includes('empresa')) {

      db.run(`
        ALTER TABLE gastos
        ADD COLUMN empresa TEXT DEFAULT 'Açaí no Grau'
      `);

      console.log('Coluna empresa adicionada');
    }

  });

});

async function criarAdmin() {

  db.get(
    'SELECT * FROM users WHERE usuario=?',
    [process.env.ADMIN_USER],
    async (err, user) => {

      if (!user) {

        const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

        db.run(
          'INSERT INTO users (nome, usuario, senha, role) VALUES (?, ?, ?, ?)',
          [
            'Administrador',
            process.env.ADMIN_USER,
            hash,
            'admin'
          ]
        );

        console.log('Admin criado');
      }

    }
  );

}

criarAdmin();

function auth(req, res, next) {

  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: 'Token não enviado' });
  }

  try {

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    next();

  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }

}

function admin(req, res, next) {

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  next();

}

app.post('/login', (req, res) => {

  const { usuario, senha } = req.body;

  db.get(
    'SELECT * FROM users WHERE usuario=?',
    [usuario],
    async (err, user) => {

      if (!user) {
        return res.status(401).json({ error: 'Usuário inválido' });
      }

      const ok = await bcrypt.compare(senha, user.senha);

      if (!ok) {
        return res.status(401).json({ error: 'Senha inválida' });
      }

      const token = jwt.sign(
        {
          id: user.id,
          role: user.role,
          nome: user.nome
        },
        process.env.JWT_SECRET,
        {
          expiresIn: '7d'
        }
      );

      res.json({
        token,
        role: user.role,
        nome: user.nome
      });

    }
  );

});

/* =========================
   FUNCIONÁRIOS
========================= */

app.post('/funcionarios', auth, admin, async (req, res) => {

  const { nome, usuario, senha } = req.body;

  if (!nome || !usuario || !senha) {
    return res.status(400).json({ error: 'Preencha todos os campos' });
  }

  const hash = await bcrypt.hash(senha, 10);

  db.run(
    'INSERT INTO users (nome, usuario, senha, role) VALUES (?, ?, ?, ?)',
    [nome, usuario, hash, 'funcionario'],
    function(err) {

      if (err) {
        return res.status(500).json({ error: 'Usuário já existe' });
      }

      res.json({
        success: true
      });

    }
  );

});

app.get('/funcionarios', auth, admin, (req, res) => {

  db.all(
    `
    SELECT
      id,
      nome,
      usuario
    FROM users
    WHERE role='funcionario'
    ORDER BY nome ASC
    `,
    [],
    (err, rows) => {

      if (err) {
        return res.status(500).json({ error: 'Erro ao listar funcionários' });
      }

      res.json(rows);

    }
  );

});

app.put('/funcionarios/:id', auth, admin, async (req, res) => {

  const id = req.params.id;

  const {
    nome,
    usuario,
    senha
  } = req.body;

  if (!nome || !usuario) {
    return res.status(400).json({
      error: 'Nome e usuário são obrigatórios'
    });
  }

  try {

    db.get(
      `
      SELECT *
      FROM users
      WHERE usuario=?
      AND id != ?
      `,
      [usuario, id],
      async (err, userExistente) => {

        if (userExistente) {
          return res.status(400).json({
            error: 'Usuário já existe'
          });
        }

        if (senha && senha.trim() !== '') {

          const hash = await bcrypt.hash(senha, 10);

          db.run(
            `
            UPDATE users
            SET
              nome=?,
              usuario=?,
              senha=?
            WHERE id=?
            AND role='funcionario'
            `,
            [
              nome,
              usuario,
              hash,
              id
            ],
            function(err) {

              if (err) {
                return res.status(500).json({
                  error: 'Erro ao atualizar funcionário'
                });
              }

              res.json({
                success: true
              });

            }
          );

        } else {

          db.run(
            `
            UPDATE users
            SET
              nome=?,
              usuario=?
            WHERE id=?
            AND role='funcionario'
            `,
            [
              nome,
              usuario,
              id
            ],
            function(err) {

              if (err) {
                return res.status(500).json({
                  error: 'Erro ao atualizar funcionário'
                });
              }

              res.json({
                success: true
              });

            }
          );

        }

      }
    );

  } catch {

    res.status(500).json({
      error: 'Erro interno'
    });

  }

});

/* =========================
   ENTREGADORES
========================= */

app.post('/entregadores', auth, admin, async (req, res) => {

  const { nome, usuario, senha } = req.body;

  if (!nome || !usuario || !senha) {
    return res.status(400).json({ error: 'Preencha todos os campos' });
  }

  const hash = await bcrypt.hash(senha, 10);

  db.run(
    'INSERT INTO users (nome, usuario, senha, role) VALUES (?, ?, ?, ?)',
    [nome, usuario, hash, 'entregador'],
    function(err) {

      if (err) {
        return res.status(500).json({ error: 'Usuário já existe' });
      }

      res.json({
        success: true
      });

    }
  );

});

app.get('/entregadores', auth, admin, (req, res) => {

  db.all(
    `
    SELECT
      id,
      nome,
      usuario
    FROM users
    WHERE role='entregador'
    ORDER BY nome ASC
    `,
    [],
    (err, rows) => {

      if (err) {
        return res.status(500).json({ error: 'Erro ao listar entregadores' });
      }

      res.json(rows);

    }
  );

});

app.put('/entregadores/:id', auth, admin, async (req, res) => {

  const id = req.params.id;

  const {
    nome,
    usuario,
    senha
  } = req.body;

  if (!nome || !usuario) {
    return res.status(400).json({
      error: 'Nome e usuário são obrigatórios'
    });
  }

  try {

    db.get(
      `
      SELECT *
      FROM users
      WHERE usuario=?
      AND id != ?
      `,
      [usuario, id],
      async (err, userExistente) => {

        if (userExistente) {
          return res.status(400).json({
            error: 'Usuário já existe'
          });
        }

        if (senha && senha.trim() !== '') {

          const hash = await bcrypt.hash(senha, 10);

          db.run(
            `
            UPDATE users
            SET
              nome=?,
              usuario=?,
              senha=?
            WHERE id=?
            AND role='entregador'
            `,
            [
              nome,
              usuario,
              hash,
              id
            ],
            function(err) {

              if (err) {
                return res.status(500).json({
                  error: 'Erro ao atualizar entregador'
                });
              }

              res.json({
                success: true
              });

            }
          );

        } else {

          db.run(
            `
            UPDATE users
            SET
              nome=?,
              usuario=?
            WHERE id=?
            AND role='entregador'
            `,
            [
              nome,
              usuario,
              id
            ],
            function(err) {

              if (err) {
                return res.status(500).json({
                  error: 'Erro ao atualizar entregador'
                });
              }

              res.json({
                success: true
              });

            }
          );

        }

      }
    );

  } catch {

    res.status(500).json({
      error: 'Erro interno'
    });

  }

});

app.delete('/entregadores/:id', auth, admin, (req, res) => {

  const id = req.params.id;

  db.get(
    `SELECT COUNT(*) as total FROM gastos WHERE entregador_id=?`,
    [id],
    (err, row) => {

      if (row.total > 0) {
        return res.status(400).json({
          error: 'Entregador possui gastos cadastrados'
        });
      }

      db.run(
        `DELETE FROM users WHERE id=? AND role='entregador'`,
        [id],
        function(err) {

          if (err) {
            return res.status(500).json({ error: 'Erro ao excluir entregador' });
          }

          res.json({ success: true });

        }
      );

    }
  );

});

/* =========================
   GASTOS
========================= */

app.post('/gastos', auth, admin, (req, res) => {

  const {
    funcionario_id,
    entregador_id,
    valor,
    descricao,
    empresa
  } = req.body;

  if (!funcionario_id && !entregador_id) {
    return res.status(400).json({
      error: 'Selecione um funcionário ou entregador'
    });
  }

  db.run(
    `
    INSERT INTO gastos
    (
      funcionario_id,
      entregador_id,
      valor,
      descricao,
      empresa
    )
    VALUES (?, ?, ?, ?, ?)
    `,
    [
      funcionario_id || null,
      entregador_id || null,
      valor,
      descricao,
      empresa || 'Açaí no Grau'
    ],
    function(err) {

      if (err) {

        console.log(err);

        return res.status(500).json({
          error: 'Erro ao adicionar gasto'
        });
      }

      res.json({
        success: true
      });

    }
  );

});

app.get('/admin/gastos', auth, admin, (req, res) => {

  db.all(
    `
    SELECT
      gastos.*,

      CASE
        WHEN funcionarios.nome IS NOT NULL THEN funcionarios.nome
        ELSE entregadores.nome
      END AS nome,

      CASE
        WHEN funcionarios.nome IS NOT NULL THEN 'Funcionário'
        ELSE 'Entregador'
      END AS tipo

    FROM gastos

    LEFT JOIN users AS funcionarios
      ON funcionarios.id = gastos.funcionario_id

    LEFT JOIN users AS entregadores
      ON entregadores.id = gastos.entregador_id

    ORDER BY gastos.id DESC
    `,
    [],
    (err, rows) => {

      if (err) {
        return res.status(500).json({ error: 'Erro ao listar gastos' });
      }

      res.json(rows);

    }
  );

});

app.get('/meus-gastos', auth, (req, res) => {

  db.all(
    `
    SELECT *
    FROM gastos
    WHERE funcionario_id=?
    OR entregador_id=?
    ORDER BY id DESC
    `,
    [req.user.id, req.user.id],
    (err, rows) => {

      if (err) {
        return res.status(500).json({ error: 'Erro ao buscar gastos' });
      }

      res.json(rows);

    }
  );

});

/* =========================
   TOTAL FUNCIONÁRIO/ENTREGADOR
========================= */

app.get('/meu-total', auth, (req, res) => {

  db.get(
    `
    SELECT
      SUM(valor) AS total
    FROM gastos
    WHERE (
      funcionario_id=?
      OR entregador_id=?
    )
    AND status='pendente'
    `,
    [req.user.id, req.user.id],
    (err, row) => {

      if (err) {
        return res.status(500).json({
          error: 'Erro ao calcular total'
        });
      }

      res.json({
        total: row.total || 0
      });

    }
  );

});

app.put('/gastos/:id/pago', auth, admin, (req, res) => {

  db.run(
    `
    UPDATE gastos
    SET status='pago'
    WHERE id=?
    `,
    [req.params.id],
    function(err) {

      if (err) {
        return res.status(500).json({ error: 'Erro ao atualizar status' });
      }

      res.json({ success: true });

    }
  );

});

app.delete('/gastos/:id', auth, admin, (req, res) => {

  db.run(
    'DELETE FROM gastos WHERE id=?',
    [req.params.id],
    function(err) {

      if (err) {
        return res.status(500).json({ error: 'Erro ao remover gasto' });
      }

      res.json({ success: true });

    }
  );

});

app.put('/gastos/:id', auth, admin, (req, res) => {

  const { valor, descricao } = req.body;

  db.run(
    `UPDATE gastos SET valor=?, descricao=? WHERE id=?`,
    [valor, descricao, req.params.id],
    function(err) {

      if (err) {
        return res.status(500).json({ error: 'Erro ao editar gasto' });
      }

      res.json({ success: true });

    }
  );

});

/* =========================
   EXCLUIR FUNCIONÁRIO
========================= */

app.delete('/funcionarios/:id', auth, admin, (req, res) => {

  const id = req.params.id;

  db.get(
    `SELECT COUNT(*) as total FROM gastos WHERE funcionario_id=?`,
    [id],
    (err, row) => {

      if (row.total > 0) {
        return res.status(400).json({
          error: 'Funcionário possui gastos cadastrados'
        });
      }

      db.run(
        `DELETE FROM users WHERE id=? AND role='funcionario'`,
        [id],
        function(err) {

          if (err) {
            return res.status(500).json({ error: 'Erro ao excluir funcionário' });
          }

          res.json({ success: true });

        }
      );

    }
  );

});
/* =========================
   RESETAR SISTEMA
========================= */

app.delete('/resetar-sistema', auth, admin, (req, res) => {

  db.run(
    `DELETE FROM gastos`,
    function(err) {

      if (err) {

        console.log(err);

        return res.status(500).json({
          error: 'Erro ao resetar sistema'
        });

      }

      res.json({
        success: true,
        message: 'Todos os gastos foram apagados'
      });

    }
  );

});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(process.env.PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${process.env.PORT}`);
});