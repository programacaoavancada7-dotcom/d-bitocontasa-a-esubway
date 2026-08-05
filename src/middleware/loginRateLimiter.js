/**
 * Limitador de tentativas de login, em memória (sem dependência nova).
 *
 * Por quê: o /login original não tinha nenhum limite de tentativas.
 * Com usuário/senha simples (ex: "admin"/"admin123" de fábrica) isso
 * permite força bruta ilimitada. Aqui, cada combinação IP+usuário tem
 * no máximo 8 tentativas a cada 10 minutos; ao estourar, responde 429
 * sem nem consultar o banco.
 *
 * Isso é suficiente para o tamanho deste sistema. Se o app crescer para
 * múltiplos servidores/instâncias, isso precisaria virar um contador
 * compartilhado (ex: Redis) em vez de Map local.
 */

const JANELA_MS = 10 * 60 * 1000;
const MAX_TENTATIVAS = 8;

const tentativas = new Map();

function limpar() {
  const agora = Date.now();
  for (const [chave, registro] of tentativas) {
    if (agora - registro.inicio > JANELA_MS) {
      tentativas.delete(chave);
    }
  }
}

function loginRateLimiter(req, res, next) {
  limpar();

  const usuario = (req.body && req.body.usuario) || 'desconhecido';
  const chave = `${req.ip}:${usuario}`;
  const agora = Date.now();

  const registro = tentativas.get(chave) || { inicio: agora, contagem: 0 };

  if (agora - registro.inicio > JANELA_MS) {
    registro.inicio = agora;
    registro.contagem = 0;
  }

  registro.contagem += 1;
  tentativas.set(chave, registro);

  if (registro.contagem > MAX_TENTATIVAS) {
    return res.status(429).json({
      error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
    });
  }

  next();
}

module.exports = loginRateLimiter;
