const path = require('path');
const express = require('express');
const cors = require('cors');

const { corsOrigin } = require('./config/env');
const securityHeaders = require('./middleware/securityHeaders');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const funcionariosRoutes = require('./routes/funcionarios.routes');
const entregadoresRoutes = require('./routes/entregadores.routes');
const gastosRoutes = require('./routes/gastos.routes');
const relatoriosRoutes = require('./routes/relatorios.routes');
const sistemaRoutes = require('./routes/sistema.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const comprovantesRoutes = require('./routes/comprovantes.routes');

const app = express();

app.use(securityHeaders);
// Se CORS_ORIGIN estiver definido no .env, restringe a esse domínio;
// caso contrário mantém o comportamento aberto original (útil em dev/ngrok).
app.use(cors(corsOrigin ? { origin: corsOrigin } : {}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(authRoutes);
app.use(funcionariosRoutes);
app.use(entregadoresRoutes);
app.use(gastosRoutes);
app.use(relatoriosRoutes);
app.use(sistemaRoutes);
app.use(whatsappRoutes);
app.use(comprovantesRoutes);

// Qualquer rota de API (prefixo conhecido) que não bateu em nada acima
// retorna 404 em JSON, em vez de silenciosamente devolver o index.html
// (o que antes tornava erros de digitação em chamadas de API confusos
// de depurar — parecia "deu certo" porque voltava HTML 200).
const PREFIXOS_API = ['/login', '/funcionarios', '/entregadores', '/gastos', '/admin', '/meus-gastos', '/meu-total', '/resetar-sistema', '/entregador'];
app.use((req, res, next) => {
  if (PREFIXOS_API.some((prefixo) => req.path.startsWith(prefixo))) {
    return notFound(req, res);
  }
  next();
});

// Fallback do SPA para qualquer outra rota (navegação direta por URL).
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);

module.exports = app;
