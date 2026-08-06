/**
 * Só confirma que dá pra conectar no Supabase antes de rodar a
 * migração de dados de verdade. Aceita DATABASE_URL (string única) ou
 * PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (campos separados — mais
 * seguro quando a senha tem caracteres especiais).
 *
 * Uso: npm run testar:conexao
 */

require('dotenv').config();
const { Pool } = require('pg');

function precisaSsl(hostOuUrl) {
  return !/localhost|127\.0\.0\.1/.test(hostOuUrl || '');
}

async function main() {
  const temCamposSeparados = !!(process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD);
  const temUrl = !!process.env.DATABASE_URL;

  if (!temCamposSeparados && !temUrl) {
    console.error('Configure DATABASE_URL ou PGHOST/PGUSER/PGPASSWORD no .env');
    process.exit(1);
  }

  const config = temCamposSeparados
    ? {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || 'postgres',
        ssl: precisaSsl(process.env.PGHOST) ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 10000,
      }
    : {
        connectionString: process.env.DATABASE_URL,
        ssl: precisaSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 10000,
      };

  console.log(`Usando: ${temCamposSeparados ? 'campos separados (PGHOST/PGUSER/...)' : 'DATABASE_URL'}`);

  const pool = new Pool(config);

  try {
    const resultado = await pool.query('SELECT version(), current_database(), now()');
    console.log('✅ Conectado com sucesso ao Postgres.');
    console.log('Banco:', resultado.rows[0].current_database);
    console.log('Versão:', resultado.rows[0].version.split(',')[0]);
    console.log('Hora do servidor:', resultado.rows[0].now);
  } catch (erro) {
    console.error('❌ Falha ao conectar:', erro.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
