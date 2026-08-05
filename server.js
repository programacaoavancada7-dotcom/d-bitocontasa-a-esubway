/**
 * Ponto de entrada. Antes, este arquivo tinha ~850 linhas: conexão com o
 * banco, todas as rotas, middlewares e regras de negócio misturados num
 * arquivo só. Agora ele só faz três coisas: migrar o banco, criar o admin
 * padrão se não existir, e subir o servidor HTTP. Toda a lógica está em
 * src/ (config, db, middleware, services, routes) — ver README.md.
 */

const { port } = require('./src/config/env');
const { migrate } = require('./src/db/schema');
const { seedAdmin } = require('./src/db/seed');
const app = require('./src/app');

async function iniciar() {
  await migrate();
  await seedAdmin();

  app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${port}`);
  });
}

iniciar().catch((err) => {
  console.error('[boot] Falha ao iniciar o servidor:', err);
  process.exit(1);
});
