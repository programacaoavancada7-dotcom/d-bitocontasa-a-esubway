
# ERP Fiado Empresarial

Sistema de controle de fiado (gastos a prazo) de funcionários e
entregadores, com painel administrativo, rankings e relatórios em PDF.

## Instalação

```bash
npm install
```

---

## Rodar o sistema

```bash
npm run dev
```

---

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
- Cadastro de funcionários e entregadores
- Controle de fiado por pessoa e por empresa
- Totais, rankings e relatórios em PDF (financeiro completo e por funcionário)
- Filtro de histórico por ano e mês
- Reset de sistema protegido por senha real + confirmação, com backup automático

---

# Estrutura do projeto

```
server.js              # ponto de entrada: migra o banco, cria o admin, sobe o servidor
src/
  config/env.js        # carrega e valida variáveis de ambiente
  db/
    index.js           # conexão SQLite + wrappers em Promise
    schema.js           # criação de tabelas, migrações leves, índices
    seed.js              # cria o usuário admin padrão
  middleware/
    auth.js              # autenticação (JWT) e checagem de admin
    asyncHandler.js       # evita repetir try/catch e evita crash do processo
    errorHandler.js        # resposta de erro padronizada
    loginRateLimiter.js     # limita tentativas de login
    securityHeaders.js       # cabeçalhos de segurança básicos
  services/               # regras de negócio (pessoas, gastos, relatórios, reset)
  routes/                  # rotas HTTP, finas, delegam para os services
public/
  index.html, app.js, style.css   # frontend (sem build step)
backups/                            # backups gerados pelo reset do sistema (não versionado)
```

Cada pasta em `src/` tem comentários explicando o "porquê" das decisões
tomadas na última revisão — não só o "o quê".
