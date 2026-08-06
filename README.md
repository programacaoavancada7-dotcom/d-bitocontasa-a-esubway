
# ERP Fiado Empresarial

Sistema de controle de fiado (gastos a prazo) de funcionários e
entregadores, com painel administrativo, desempenho e relatórios em PDF.

Banco de dados: **Postgres via Supabase** (não usa mais SQLite — ver
seção "Banco de dados" abaixo para o motivo).

## Instalação

```bash
npm install
```

---

## Configurar o `.env`

Copie `.env.example` para `.env` e preencha:

- `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD` — como antes.
- Dados de conexão do Supabase — **prefira os campos separados**
  (`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`) em vez de um
  `DATABASE_URL` único. Se a senha do banco tiver caractere especial
  (`#`, `@`, `%`, `/`, `:`), colar tudo numa única URL costuma quebrar a
  conexão de forma confusa ("password authentication failed" mesmo com a
  senha certa) — foi exatamente isso que aconteceu ao configurar este
  projeto, e os campos separados resolveram.
- Use o host do **"Transaction pooler"** do Supabase (Project Settings →
  Database → Connection parameters), não o "Direct connection" — o
  direct connection só responde em IPv6 e falha em redes sem suporte a
  IPv6 (erro `ENOTFOUND`).

## Rodar o sistema

```bash
npm run dev
```

## Abrir no navegador

```txt
http://localhost:3000
```

---

# Login Admin

Usuário e senha ficam no `.env` (`ADMIN_USER` / `ADMIN_PASSWORD`) e o
usuário admin é criado automaticamente na primeira vez que o servidor
sobe, caso ainda não exista.

---

# Recursos

- Login admin / funcionários / entregadores (JWT + bcrypt)
- Cadastro de funcionários e entregadores, em seções separadas
- Controle de fiado por pessoa e por empresa
- Totais, desempenho e relatórios em PDF (financeiro completo, por
  funcionário e por entregador)
- Filtro de histórico por ano e mês
- Reset de sistema protegido por senha real + confirmação, com backup
  automático em JSON antes de apagar

---

# Banco de dados

O projeto foi migrado de SQLite para **Postgres (Supabase)** porque vai
rodar no Render, que usa **disco efêmero**: qualquer arquivo escrito em
tempo de execução (como seria o `database.db` do SQLite) é apagado a
cada deploy ou reinício do serviço. Hospedando o banco no Supabase, os
dados sobrevivem a qualquer deploy/restart do Render.

### Migrar dados de um `database.db` antigo (se existir)

```bash
npm run migrar:supabase
```

Copia todos os `users` e `gastos` do SQLite local para o Postgres
configurado no `.env`, preservando os ids (histórico intacto). Seguro
rodar mais de uma vez — registros já migrados não duplicam.

### Testar só a conexão

```bash
npm run testar:conexao
```

---

# Deploy no Render

1. Suba este repositório para o GitHub (já feito, se você seguiu os
   passos do projeto).
2. No Render, **New → Blueprint**, aponte para o repositório — ele lê o
   `render.yaml` deste projeto automaticamente.
3. Preencha os valores marcados como secretos no painel do Render
   (`JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD`, `PGHOST`, `PGPORT`,
   `PGUSER`, `PGPASSWORD`, `PGDATABASE`) — os mesmos do seu `.env`.
4. **Sobre ficar 24h ligado**: o `render.yaml` está com `plan: free`.
   Nesse plano o Render derruba o serviço após ~15 min sem tráfego.
   Para evitar isso sem pagar, configure um bot de uptime (ex:
   [UptimeRobot](https://uptimerobot.com), gratuito) pingando a URL do
   serviço a cada 5 minutos — menos que o limite de 15 min, então o
   serviço nunca chega a dormir. Isso não é um "sempre ligado" oficial
   da Render (é um workaround comum, não uma garantia contratual): se
   o bot cair, ou a conta passar do teto de ~750h/mês do plano free,
   o serviço pode ficar indisponível por um tempo — nenhum dado é
   perdido nesse caso, só fica fora do ar até voltar. Para uma garantia
   de verdade, troque `plan: free` por `plan: starter` no
   `render.yaml` (pago, ~US$7/mês).

---

# Estrutura do projeto

```
server.js              # ponto de entrada: migra o banco, cria o admin, sobe o servidor
src/
  config/env.js        # carrega e valida variáveis de ambiente
  db/
    index.js           # conexão Postgres (pg.Pool) + wrappers em Promise
    schema.js           # criação de tabelas, índices, foreign keys
    seed.js              # cria o usuário admin padrão
  middleware/
    auth.js              # autenticação (JWT) e checagem de admin
    asyncHandler.js       # evita repetir try/catch e evita crash do processo
    errorHandler.js        # resposta de erro padronizada
    loginRateLimiter.js     # limita tentativas de login
    securityHeaders.js       # cabeçalhos de segurança básicos
  services/               # regras de negócio (pessoas, gastos, relatórios, reset)
  routes/                  # rotas HTTP, finas, delegam para os services
scripts/
  migrar-sqlite-para-postgres.js   # migração única de dados
  testar-conexao-postgres.js       # smoke test da conexão
public/
  index.html, app.js, style.css   # frontend (sem build step)
backups/                            # backups gerados pelo reset do sistema (não versionado)
render.yaml                           # config de deploy no Render
```

Cada pasta em `src/` tem comentários explicando o "porquê" das decisões
tomadas — não só o "o quê".
