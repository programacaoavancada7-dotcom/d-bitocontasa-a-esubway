/**
 * Fábrica de limitador de taxa em memória, genérica — usada tanto pelo
 * /login quanto pelo upload de comprovante (cada um com sua própria
 * janela/limite, ver loginRateLimiter.js e o uso em comprovantes.routes.js).
 *
 * Em memória é suficiente pro tamanho deste sistema (um único processo
 * no Render). Se um dia rodar mais de uma instância, isso precisaria
 * virar um contador compartilhado (ex: Redis).
 */

function criarRateLimiter({ janelaMs, max, obterChave, mensagem }) {
  const registros = new Map();

  function limpar() {
    const agora = Date.now();
    for (const [chave, registro] of registros) {
      if (agora - registro.inicio > janelaMs) registros.delete(chave);
    }
  }

  return function rateLimiter(req, res, next) {
    limpar();

    const chave = obterChave(req);
    const agora = Date.now();
    const registro = registros.get(chave) || { inicio: agora, contagem: 0 };

    if (agora - registro.inicio > janelaMs) {
      registro.inicio = agora;
      registro.contagem = 0;
    }

    registro.contagem += 1;
    registros.set(chave, registro);

    if (registro.contagem > max) {
      return res.status(429).json({ error: mensagem });
    }

    next();
  };
}

module.exports = criarRateLimiter;
