/* =========================================================
   ESTADO GLOBAL
========================================================= */

let token = localStorage.getItem('token');
let role = localStorage.getItem('role');
let nomeUsuario = localStorage.getItem('nomeUsuario');

let gastosSelecionados = [];
let filtro = { ano: 0, mes: 0 };
let cacheGastos = [];
let logoAtual = 'acai';

/* =========================================================
   HELPER DE DOM SEGURO
   Por quê: a versão antiga montava HTML por concatenação de string
   (`lista.innerHTML += \`...${gasto.descricao}...\``) com dados digitados
   por gente (nome, descrição, usuário). Duas consequências reais:
   1) XSS — um valor como <img src=x onerror=alert(1)> vira HTML de
      verdade.
   2) Quebra de tela — os botões usavam
      onclick="editarGasto(1, 10, '${descricao}')"; qualquer aspas simples
      na descrição (comum em texto livre) quebra o atributo e o item some
      ou passa a executar algo diferente do esperado.
   `el()` cria elementos reais e usa textContent para dado do usuário, e
   os "onclick" viram addEventListener de verdade — nenhum dado do
   usuário entra em uma string de HTML ou de atributo.
========================================================= */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value; // conteúdo visível (nunca vira atributo)
    else if (key === 'html') node.innerHTML = value; // só para markup estático, nunca dado de usuário
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }

  const lista = Array.isArray(children) ? children : [children];
  for (const filho of lista) {
    if (filho === null || filho === undefined || filho === false) continue;
    node.appendChild(typeof filho === 'string' || typeof filho === 'number' ? document.createTextNode(filho) : filho);
  }

  return node;
}

function limparEPreencher(container, filhos) {
  if (!container) return;
  container.innerHTML = '';
  filhos.forEach((filho) => container.appendChild(filho));
}

function estadoVazio(mensagem) {
  return el('div', { class: 'empty-state' }, mensagem);
}

function formatarMoeda(valor) {
  return `R$ ${(Number(valor) || 0).toFixed(2)}`;
}

function formatarData(dataSql) {
  const dataParte = (dataSql || '').split(' ')[0];
  const partes = dataParte.split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : dataParte;
}

/* =========================================================
   TOAST (substitui alert())
========================================================= */

const Toast = {
  show(mensagem, tipo = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = el('div', { class: `toast ${tipo}` }, mensagem);
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('saindo');
      setTimeout(() => toast.remove(), 200);
    }, 3600);
  },
  sucesso(msg) { this.show(msg, 'sucesso'); },
  erro(msg) { this.show(msg, 'erro'); },
};

/* =========================================================
   MODAL (substitui confirm()/prompt())
========================================================= */

const Modal = {
  overlay: null,
  box: null,

  init() {
    this.overlay = document.getElementById('modalOverlay');
    this.box = document.getElementById('modalBox');
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.fechar();
    });
  },

  abrir(conteudoNode) {
    limparEPreencher(this.box, [conteudoNode]);
    this.overlay.classList.remove('hidden');
  },

  fechar() {
    this.overlay.classList.add('hidden');
    this.box.innerHTML = '';
  },

  confirmar({ titulo, mensagem, textoConfirmar = 'Confirmar', perigo = false }) {
    return new Promise((resolve) => {
      const encerrar = (resultado) => {
        this.fechar();
        resolve(resultado);
      };

      const conteudo = el('div', {}, [
        el('h3', { text: titulo }),
        el('p', { text: mensagem }),
        el('div', { class: 'modal-acoes' }, [
          el('button', { class: 'btn-secundario', onclick: () => encerrar(false), text: 'Cancelar' }),
          el('button', {
            class: perigo ? 'excluir-btn' : '',
            onclick: () => encerrar(true),
            text: textoConfirmar,
          }),
        ]),
      ]);

      this.abrir(conteudo);
    });
  },

  /**
   * Formulário genérico com N campos de texto, substitui as cadeias de
   * `prompt()` usadas antes para editar funcionário/entregador/gasto.
   * @param {{titulo:string, campos:{nome:string,label:string,valor?:string,tipo?:string}[], textoConfirmar?:string}} opcoes
   * @returns {Promise<Record<string,string>|null>} null se cancelado
   */
  formulario({ titulo, campos, textoConfirmar = 'Salvar', avisoPerigo = null }) {
    return new Promise((resolve) => {
      const inputsPorCampo = {};

      const encerrar = (resultado) => {
        this.fechar();
        resolve(resultado);
      };

      const camposNode = campos.map((campo) => {
        const input = el('input', {
          type: campo.tipo || 'text',
          value: campo.valor || '',
          placeholder: campo.label,
          autocomplete: campo.tipo === 'password' ? 'new-password' : 'off',
        });
        inputsPorCampo[campo.nome] = input;

        return el('div', { class: 'form-group' }, [
          el('label', { text: campo.label }),
          input,
        ]);
      });

      const conteudo = el('div', {}, [
        el('h3', { text: titulo }),
        ...camposNode,
        avisoPerigo ? el('div', { class: 'modal-aviso', text: avisoPerigo }) : null,
        el('div', { class: 'modal-acoes' }, [
          el('button', { class: 'btn-secundario', onclick: () => encerrar(null), text: 'Cancelar' }),
          el('button', {
            onclick: () => {
              const valores = {};
              for (const [nome, input] of Object.entries(inputsPorCampo)) {
                valores[nome] = input.value;
              }
              encerrar(valores);
            },
            text: textoConfirmar,
          }),
        ]),
      ]);

      this.abrir(conteudo);
      const primeiroInput = Object.values(inputsPorCampo)[0];
      if (primeiroInput) setTimeout(() => primeiroInput.focus(), 30);
    });
  },
};

/* =========================================================
   API — wrapper único para fetch + token + tratamento de erro
   Por quê: antes cada função repetia `headers: { authorization: token }`
   e cada uma decidia na sua própria forma como ler `data.error`. Agora
   isso está num só lugar.
========================================================= */

const Api = {
  async chamar(caminho, { method = 'GET', body } = {}) {
    const headers = { authorization: token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const resposta = await fetch(caminho, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let dados = null;
    try {
      dados = await resposta.json();
    } catch {
      dados = null;
    }

    if (!resposta.ok) {
      const mensagem = (dados && dados.error) || 'Erro inesperado. Tente novamente.';
      throw new Error(mensagem);
    }

    return dados;
  },

  get(caminho) { return this.chamar(caminho); },
  post(caminho, body) { return this.chamar(caminho, { method: 'POST', body }); },
  put(caminho, body) { return this.chamar(caminho, { method: 'PUT', body: body || {} }); },
  del(caminho, body) { return this.chamar(caminho, { method: 'DELETE', body }); },
};

function queryStringFiltro() {
  const params = new URLSearchParams();
  if (filtro.ano) params.set('ano', filtro.ano);
  if (filtro.mes) params.set('mes', filtro.mes);
  const texto = params.toString();
  return texto ? `?${texto}` : '';
}

/* =========================================================
   LOGIN / SESSÃO
========================================================= */

if (token && role) {
  iniciarPainel();
}

async function login() {
  const usuario = document.getElementById('usuario').value.trim();
  const senha = document.getElementById('senha').value;
  const erroEl = document.getElementById('erro');
  erroEl.innerText = '';

  if (!usuario || !senha) {
    erroEl.innerText = 'Informe usuário e senha.';
    return;
  }

  try {
    const dados = await Api.post('/login', { usuario, senha });

    token = dados.token;
    role = dados.role;
    nomeUsuario = dados.nome || usuario;

    localStorage.setItem('token', token);
    localStorage.setItem('role', role);
    localStorage.setItem('nomeUsuario', nomeUsuario);

    iniciarPainel();
  } catch (erro) {
    erroEl.innerText = erro.message;
  }
}

function iniciarPainel() {
  document.getElementById('loginBox').classList.add('hidden');

  const mensagem = `Bem-vindo${nomeUsuario ? ', ' + nomeUsuario : ''} ao seu controle de gastos.`;
  const boasVindasAdmin = document.getElementById('boasVindasAdmin');
  const boasVindasFuncionario = document.getElementById('boasVindasFuncionario');
  if (boasVindasAdmin) boasVindasAdmin.innerText = mensagem;
  if (boasVindasFuncionario) boasVindasFuncionario.innerText = mensagem;

  if (role === 'admin') {
    document.getElementById('adminPanel').classList.remove('hidden');

    // carregarFuncionarios() limpa e preenche o <select> de pessoas;
    // carregarEntregadores() só ADICIONA opções nele depois. Se as duas
    // rodassem em paralelo sem ordem garantida (como antes), uma resposta
    // de rede mais rápida da segunda podia fazer a primeira apagar as
    // opções de entregador já inseridas. Por isso aqui elas são
    // sequenciais; carregarGastos() não mexe no <select>, então continua
    // podendo rodar em paralelo.
    (async () => {
      await carregarFuncionarios();
      await carregarEntregadores();
    })();

    carregarGastos();
  } else {
    document.getElementById('funcionarioPanel').classList.remove('hidden');
    carregarMeusGastos();
    carregarMeuTotal();
  }
}

function logout() {
  localStorage.clear();
  location.reload();
}

/* =========================================================
   RESET DO SISTEMA
   Antes: dois prompt() comparando com a string fixa "blackout" (visível
   no código-fonte do navegador) e a rota no servidor não conferia nada
   além do token de admin. Agora o modal pede a SENHA REAL da conta e a
   frase de confirmação, e o servidor valida os dois (ver
   src/services/sistemaService.js) além de gravar um backup antes de apagar.
========================================================= */

async function resetarSistema() {
  const FRASE = 'APAGAR TUDO';

  const valores = await Modal.formulario({
    titulo: '⚠️ Resetar sistema',
    avisoPerigo: `Isso apaga TODOS os gastos cadastrados (${cacheGastos.length} registros). Um backup em JSON é salvo no servidor antes de apagar, mas a ação não pode ser desfeita pela tela.`,
    campos: [
      { nome: 'senha', label: 'Sua senha de admin', tipo: 'password' },
      { nome: 'confirmacao', label: `Digite "${FRASE}" para confirmar` },
    ],
    textoConfirmar: 'Apagar tudo',
  });

  if (!valores) return;

  try {
    const resultado = await Api.del('/resetar-sistema', valores);
    Toast.sucesso(`Sistema resetado. Backup salvo em backups/${resultado.backup}.`);
    carregarGastos();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

/* =========================================================
   FUNCIONÁRIOS
========================================================= */

async function cadastrarFuncionario() {
  const nome = document.getElementById('nomeFuncionario').value;
  const usuario = document.getElementById('usuarioFuncionario').value;
  const senha = document.getElementById('senhaFuncionario').value;

  try {
    await Api.post('/funcionarios', { nome, usuario, senha });

    Toast.sucesso('Funcionário cadastrado.');
    document.getElementById('nomeFuncionario').value = '';
    document.getElementById('usuarioFuncionario').value = '';
    document.getElementById('senhaFuncionario').value = '';

    carregarFuncionarios();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function editarFuncionario(funcionario) {
  const valores = await Modal.formulario({
    titulo: 'Editar funcionário',
    campos: [
      { nome: 'nome', label: 'Nome', valor: funcionario.nome },
      { nome: 'usuario', label: 'Usuário', valor: funcionario.usuario },
      { nome: 'senha', label: 'Nova senha (deixe em branco para manter)', tipo: 'password' },
    ],
  });

  if (!valores) return;

  try {
    await Api.put(`/funcionarios/${funcionario.id}`, valores);
    Toast.sucesso('Funcionário atualizado.');
    carregarFuncionarios();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function excluirFuncionario(funcionario) {
  const ok = await Modal.confirmar({
    titulo: 'Excluir funcionário',
    mensagem: `Deseja excluir "${funcionario.nome}"? Isso só é possível se não houver gastos vinculados a ele.`,
    textoConfirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  try {
    await Api.del(`/funcionarios/${funcionario.id}`);
    Toast.sucesso('Funcionário excluído.');
    carregarFuncionarios();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

let cacheFuncionarios = [];

async function carregarFuncionarios() {
  const dados = await Api.get('/funcionarios');
  cacheFuncionarios = dados;

  renderizarListaFuncionarios(dados);
  renderizarSelectFuncionarios(dados);

  const totalFunc = document.getElementById('totalFuncionarios');
  if (totalFunc) totalFunc.innerText = dados.length;
}

// Só a lista (<ul>) — usada também pelo filtro de busca. Importante:
// o <select> de "Adicionar Gasto" é populado à parte (ver
// renderizarSelectFuncionarios) e nunca deve refletir o filtro de busca,
// senão digitar no campo de busca faria funcionários "somem" do
// formulário de lançar gasto.
function renderizarListaFuncionarios(dados) {
  const lista = document.getElementById('listaFuncionarios');
  if (!lista) return;

  if (!dados.length) {
    limparEPreencher(lista, [estadoVazio('Nenhum funcionário encontrado.')]);
    return;
  }

  limparEPreencher(lista, dados.map((funcionario) => el('li', {}, [
    `${funcionario.nome} - @${funcionario.usuario}`,
    el('div', { class: 'acoes-botoes' }, [
      el('button', { onclick: () => editarFuncionario(funcionario), text: 'Editar' }),
      el('button', { onclick: () => excluirFuncionario(funcionario), text: 'Excluir' }),
    ]),
  ])));
}

function renderizarSelectFuncionarios(dados) {
  const select = document.getElementById('funcionarioSelect');
  if (!select) return;

  limparEPreencher(select, dados.map((funcionario) =>
    el('option', { value: funcionario.id, text: `Funcionário - ${funcionario.nome}` })
  ));
  // Entregadores são adicionados em seguida por carregarEntregadores().
}

function filtrarFuncionarios() {
  const termo = (document.getElementById('buscarFuncionario').value || '').toLowerCase();
  const filtrados = cacheFuncionarios.filter((f) => f.nome.toLowerCase().includes(termo) || f.usuario.toLowerCase().includes(termo));
  renderizarListaFuncionarios(filtrados);
}

/* =========================================================
   ENTREGADORES
========================================================= */

async function cadastrarEntregador() {
  const nome = document.getElementById('nomeEntregador').value;
  const usuario = document.getElementById('usuarioEntregador').value;
  const senha = document.getElementById('senhaEntregador').value;

  try {
    await Api.post('/entregadores', { nome, usuario, senha });

    Toast.sucesso('Entregador cadastrado.');
    document.getElementById('nomeEntregador').value = '';
    document.getElementById('usuarioEntregador').value = '';
    document.getElementById('senhaEntregador').value = '';

    carregarEntregadores();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function editarEntregador(entregador) {
  const valores = await Modal.formulario({
    titulo: 'Editar entregador',
    campos: [
      { nome: 'nome', label: 'Nome', valor: entregador.nome },
      { nome: 'usuario', label: 'Usuário', valor: entregador.usuario },
      { nome: 'senha', label: 'Nova senha (deixe em branco para manter)', tipo: 'password' },
    ],
  });

  if (!valores) return;

  try {
    await Api.put(`/entregadores/${entregador.id}`, valores);
    Toast.sucesso('Entregador atualizado.');
    carregarEntregadores();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function excluirEntregador(entregador) {
  const ok = await Modal.confirmar({
    titulo: 'Excluir entregador',
    mensagem: `Deseja excluir "${entregador.nome}"? Isso só é possível se não houver gastos vinculados a ele.`,
    textoConfirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  try {
    await Api.del(`/entregadores/${entregador.id}`);
    Toast.sucesso('Entregador excluído.');
    carregarEntregadores();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function carregarEntregadores() {
  const dados = await Api.get('/entregadores');
  const lista = document.getElementById('listaEntregadores');
  const select = document.getElementById('funcionarioSelect');

  if (lista) {
    if (!dados.length) {
      limparEPreencher(lista, [estadoVazio('Nenhum entregador cadastrado ainda.')]);
    } else {
      limparEPreencher(lista, dados.map((entregador) => el('li', {}, [
        `${entregador.nome} - @${entregador.usuario}`,
        el('div', { class: 'acoes-botoes' }, [
          el('button', { onclick: () => editarEntregador(entregador), text: 'Editar' }),
          el('button', { onclick: () => excluirEntregador(entregador), text: 'Excluir' }),
        ]),
      ])));
    }
  }

  if (select) {
    dados.forEach((entregador) => {
      select.appendChild(el('option', { value: `entregador-${entregador.id}`, text: `Entregador - ${entregador.nome}` }));
    });
  }
}

/* =========================================================
   GASTOS
========================================================= */

async function adicionarGasto() {
  const selecionado = document.getElementById('funcionarioSelect').value;
  let funcionario_id = null;
  let entregador_id = null;

  if (selecionado.includes('entregador-')) {
    entregador_id = selecionado.replace('entregador-', '');
  } else {
    funcionario_id = selecionado;
  }

  const valor = document.getElementById('valorGasto').value;
  const descricao = document.getElementById('descricaoGasto').value;
  const empresa = document.getElementById('empresaGasto').value;

  try {
    await Api.post('/gastos', { funcionario_id, entregador_id, valor, descricao, empresa });

    Toast.sucesso('Gasto adicionado.');
    document.getElementById('valorGasto').value = '';
    document.getElementById('descricaoGasto').value = '';

    carregarGastos();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function editarGasto(gasto) {
  const valores = await Modal.formulario({
    titulo: 'Editar gasto',
    campos: [
      { nome: 'valor', label: 'Valor', valor: String(gasto.valor), tipo: 'number' },
      { nome: 'descricao', label: 'Descrição', valor: gasto.descricao },
    ],
  });

  if (!valores) return;

  try {
    await Api.put(`/gastos/${gasto.id}`, valores);
    Toast.sucesso('Gasto atualizado.');
    carregarGastos();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function marcarPago(id) {
  try {
    await Api.put(`/gastos/${id}/pago`);
    carregarGastos();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function removerGasto(id) {
  const ok = await Modal.confirmar({
    titulo: 'Excluir gasto',
    mensagem: 'Deseja excluir este gasto? Essa ação não pode ser desfeita.',
    textoConfirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  try {
    await Api.del(`/gastos/${id}`);
    carregarGastos();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

/* ---------- Seleção em lote ---------- */

function toggleSelecionarGasto(id) {
  const index = gastosSelecionados.indexOf(id);
  if (index > -1) gastosSelecionados.splice(index, 1);
  else gastosSelecionados.push(id);
  atualizarInterfaceSelecao();
}

function atualizarInterfaceSelecao() {
  const contador = document.getElementById('contadorSelecionados');
  const acoes = document.getElementById('acoesLote');
  const selecionarTodos = document.getElementById('selecionarTodos');

  if (contador) contador.innerText = `${gastosSelecionados.length} selecionado(s)`;
  if (acoes) acoes.classList.toggle('hidden', gastosSelecionados.length === 0);

  const checkboxes = document.querySelectorAll('.gasto-checkbox');
  if (selecionarTodos) {
    selecionarTodos.checked = checkboxes.length > 0 && gastosSelecionados.length === checkboxes.length;
  }

  document.querySelectorAll('.gasto-item').forEach((item) => {
    const id = Number(item.getAttribute('data-id'));
    item.classList.toggle('gasto-selecionado', gastosSelecionados.includes(id));
  });
}

function toggleSelecionarTodos() {
  const checkboxes = document.querySelectorAll('.gasto-checkbox');
  const selecionarTodos = document.getElementById('selecionarTodos');

  if (selecionarTodos.checked) {
    gastosSelecionados = Array.from(checkboxes, (cb) => Number(cb.value));
    checkboxes.forEach((cb) => { cb.checked = true; });
  } else {
    checkboxes.forEach((cb) => { cb.checked = false; });
    gastosSelecionados = [];
  }

  atualizarInterfaceSelecao();
}

async function marcarSelecionadosComoPagos() {
  if (!gastosSelecionados.length) return;

  const ok = await Modal.confirmar({
    titulo: 'Marcar como pagos',
    mensagem: `Deseja marcar ${gastosSelecionados.length} gasto(s) como pagos?`,
    textoConfirmar: 'Marcar como pagos',
  });
  if (!ok) return;

  await Promise.all(gastosSelecionados.map((id) => Api.put(`/gastos/${id}/pago`)));

  gastosSelecionados = [];
  carregarGastos();
  Toast.sucesso('Gastos marcados como pagos.');
}

async function excluirSelecionados() {
  if (!gastosSelecionados.length) return;

  const ok = await Modal.confirmar({
    titulo: 'Excluir gastos selecionados',
    mensagem: `Deseja excluir ${gastosSelecionados.length} gasto(s)? Essa ação não pode ser desfeita.`,
    textoConfirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  await Promise.all(gastosSelecionados.map((id) => Api.del(`/gastos/${id}`)));

  gastosSelecionados = [];
  carregarGastos();
  Toast.sucesso('Gastos excluídos.');
}

/* ---------- Listagem / dashboard ---------- */

function popularSeletorDeAno(gastos) {
  const select = document.getElementById('filtroAno');
  if (!select || select.dataset.preenchido) return;

  const anos = new Set(gastos.map((g) => (g.data || '').slice(0, 4)).filter(Boolean));
  Array.from(anos).sort().reverse().forEach((ano) => {
    select.appendChild(el('option', { value: ano, text: ano }));
  });

  select.dataset.preenchido = '1';
}

function renderizarSkeleton(container, quantidade = 4) {
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < quantidade; i += 1) {
    container.appendChild(el('div', { class: 'skeleton' }));
  }
}

async function carregarGastos() {
  gastosSelecionados = [];

  const lista = document.getElementById('listaGastos');
  renderizarSkeleton(lista);

  const [gastosSemFiltro, resumo] = await Promise.all([
    // usado só para descobrir quais anos existem e popular o seletor
    cacheGastos.length ? Promise.resolve(cacheGastos) : Api.get('/admin/gastos'),
    Api.get(`/admin/relatorios/resumo${queryStringFiltro()}`),
  ]);

  cacheGastos = gastosSemFiltro;
  popularSeletorDeAno(gastosSemFiltro);

  const gastosFiltrados = await Api.get(`/admin/gastos${queryStringFiltro()}`);

  renderizarListaGastos(gastosFiltrados);
  renderizarDashboardAdmin(resumo);
  renderizarRankings(resumo);
}

function renderizarListaGastos(gastos) {
  const lista = document.getElementById('listaGastos');
  if (!lista) return;

  if (!gastos.length) {
    limparEPreencher(lista, [estadoVazio('Nenhum gasto encontrado para este período.')]);
    atualizarInterfaceSelecao();
    return;
  }

  limparEPreencher(lista, gastos.map((gasto) => {
    const valor = Number(gasto.valor) || 0;

    const checkbox = el('input', {
      type: 'checkbox',
      class: 'gasto-checkbox',
      value: gasto.id,
      onchange: () => toggleSelecionarGasto(gasto.id),
    });

    const botoes = [];
    if (gasto.status === 'pendente') {
      botoes.push(el('button', { class: 'action-btn', onclick: () => marcarPago(gasto.id), text: 'Marcar Pago' }));
    }
    botoes.push(el('button', { class: 'action-btn', onclick: () => editarGasto(gasto), text: 'Editar' }));
    botoes.push(el('button', { class: 'action-btn', onclick: () => removerGasto(gasto.id), text: 'Excluir' }));

    return el('li', { class: 'gasto-item', 'data-id': gasto.id, 'data-nome': gasto.nome.toLowerCase() }, [
      el('div', { class: 'gasto-checkbox-area' }, [
        checkbox,
        el('div', { class: 'gasto-conteudo' }, [
          el('div', { class: 'gasto-topo' }, [
            el('div', {}, [
              el('strong', { text: gasto.nome }),
              el('div', { class: 'gasto-info', text: `${gasto.tipo || 'Funcionário'} • ${gasto.empresa || 'Açaí no Grau'}` }),
            ]),
            el('span', { class: `status ${gasto.status}`, text: gasto.status }),
          ]),
          el('div', { class: 'gasto-valor', text: formatarMoeda(valor) }),
          el('div', { class: 'gasto-descricao', text: gasto.descricao || '(sem descrição)' }),
          el('div', { class: 'gasto-data', text: formatarData(gasto.data) }),
          el('div', { class: 'gasto-acoes' }, botoes),
        ]),
      ]),
    ]);
  }));

  atualizarInterfaceSelecao();
}

function renderizarDashboardAdmin(resumo) {
  const totalGeral = document.getElementById('totalGeral');
  const totalPagoEl = document.getElementById('totalPago');
  const totalMovimentadoEl = document.getElementById('totalMovimentado');

  if (totalGeral) totalGeral.innerText = formatarMoeda(resumo.totalPendente);
  if (totalPagoEl) totalPagoEl.innerText = formatarMoeda(resumo.totalPago);
  if (totalMovimentadoEl) totalMovimentadoEl.innerText = formatarMoeda(resumo.totalMovimentado);
}

function cardRanking(item) {
  const empresas = Object.entries(item.porEmpresa).map(([empresa, valor]) =>
    el('div', { class: 'empresa-divida' }, [
      el('span', { class: 'empresa-titulo', text: empresa }),
      el('span', { class: 'empresa-valor', text: formatarMoeda(valor) }),
    ])
  );

  return el('div', { class: 'ranking-entregador-card' }, [
    el('div', { class: 'ranking-entregador-topo' }, [
      el('div', { class: 'ranking-entregador-nome', text: item.nome }),
      el('div', { class: 'ranking-entregador-total', text: `Total: ${formatarMoeda(item.total)}` }),
    ]),
    el('div', { class: 'ranking-entregador-empresas' }, empresas),
  ]);
}

function renderizarRankings(resumo) {
  const listaRanking = document.getElementById('ranking');
  const listaRankingEntregadores = document.getElementById('rankingEntregadores');

  if (listaRanking) {
    limparEPreencher(
      listaRanking,
      resumo.rankingFuncionarios.length
        ? resumo.rankingFuncionarios.map(cardRanking)
        : [estadoVazio('Nenhuma pendência de funcionário neste período.')]
    );
  }

  if (listaRankingEntregadores) {
    limparEPreencher(
      listaRankingEntregadores,
      resumo.rankingEntregadores.length
        ? resumo.rankingEntregadores.map(cardRanking)
        : [estadoVazio('Nenhuma pendência de entregador neste período.')]
    );
  }
}

function filtrarGastos() {
  const texto = (document.getElementById('buscarGasto').value || '').toLowerCase();
  document.querySelectorAll('.gasto-item').forEach((item) => {
    const nome = item.getAttribute('data-nome');
    item.style.display = nome.includes(texto) ? 'flex' : 'none';
  });
}

/* =========================================================
   FILTRO DE PERÍODO (ano + mês)
========================================================= */

function filtrarMes(mes, event) {
  filtro.mes = mes;

  document.querySelectorAll('.mes-btn').forEach((btn) => btn.classList.remove('active'));
  if (event && event.target) event.target.classList.add('active');

  carregarGastos();
}

function filtrarAno(ano) {
  filtro.ano = Number(ano);
  carregarGastos();
}

/* =========================================================
   PDF
========================================================= */

async function gerarPDF() {
  const escolha = await Modal.confirmar({
    titulo: 'Relatório em PDF',
    mensagem: 'Gerar o relatório financeiro completo (todas as pessoas e empresas) para o período selecionado?',
    textoConfirmar: 'Gerar financeiro completo',
  });

  if (escolha) return gerarRelatorioFinanceiroCompleto();

  const escolhaFuncionarios = await Modal.confirmar({
    titulo: 'Relatório de funcionários',
    mensagem: 'Deseja gerar o resumo apenas de funcionários (sem entregadores) para o período selecionado?',
    textoConfirmar: 'Gerar resumo de funcionários',
  });

  if (escolhaFuncionarios) return gerarRelatorioFuncionarios();
}

async function gerarRelatorioFinanceiroCompleto() {
  const [gastos, resumo] = await Promise.all([
    Api.get(`/admin/gastos${queryStringFiltro()}`),
    Api.get(`/admin/relatorios/resumo${queryStringFiltro()}`),
  ]);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });

  const rows = gastos.map((g) => [
    g.nome,
    g.tipo || 'Funcionário',
    g.empresa || 'Açaí no Grau',
    formatarMoeda(g.valor),
    g.descricao || '—',
    g.status.toUpperCase(),
    formatarData(g.data),
  ]);

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 300, 35, 'F');
  doc.setTextColor(255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('RELATÓRIO FINANCEIRO', 14, 22);
  doc.setFontSize(10);
  doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 220, 22);

  doc.setFillColor(239, 68, 68);
  doc.roundedRect(14, 45, 80, 28, 4, 4, 'F');
  doc.setTextColor(255);
  doc.setFontSize(12);
  doc.text('TOTAL PENDENTE', 20, 57);
  doc.setFontSize(18);
  doc.text(formatarMoeda(resumo.totalPendente), 20, 67);

  doc.setFillColor(34, 197, 94);
  doc.roundedRect(105, 45, 80, 28, 4, 4, 'F');
  doc.setFontSize(12);
  doc.text('TOTAL PAGO', 112, 57);
  doc.setFontSize(18);
  doc.text(formatarMoeda(resumo.totalPago), 112, 67);

  doc.setFillColor(59, 130, 246);
  doc.roundedRect(196, 45, 80, 28, 4, 4, 'F');
  doc.setFontSize(12);
  doc.text('TOTAL GERAL', 203, 57);
  doc.setFontSize(18);
  doc.text(formatarMoeda(resumo.totalMovimentado), 203, 67);

  doc.setTextColor(30);
  doc.setFontSize(12);
  doc.text('RESUMO POR EMPRESA (pendente)', 14, 85);
  doc.setFontSize(11);

  let y = 92;
  Object.entries(resumo.totalPorEmpresa).forEach(([empresa, valor]) => {
    doc.text(`${empresa}: ${formatarMoeda(valor)}`, 14, y);
    y += 7;
  });

  doc.autoTable({
    startY: y + 8,
    head: [['Nome', 'Tipo', 'Empresa', 'Valor', 'Descrição', 'Status', 'Data']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', halign: 'center' },
    columnStyles: { 3: { halign: 'right' }, 5: { halign: 'center' }, 6: { halign: 'center' } },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 5) {
        data.cell.styles.textColor = data.cell.raw === 'PENDENTE' ? [220, 38, 38] : [22, 163, 74];
      }
    },
  });

  const paginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= paginas; i += 1) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${paginas}`, 250, 200);
    doc.text('Sistema Financeiro • Açaí no Grau', 14, 200);
  }

  doc.save('relatorio-financeiro.pdf');
}

async function gerarRelatorioFuncionarios() {
  const resumo = await Api.get(`/admin/relatorios/resumo${queryStringFiltro()}`);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('RELATÓRIO DE FUNCIONÁRIOS', 14, 20);

  let y = 45;
  doc.setTextColor(0);
  doc.setFontSize(11);

  if (!resumo.rankingFuncionarios.length) {
    doc.text('Nenhuma pendência de funcionário neste período.', 14, y);
  }

  resumo.rankingFuncionarios.forEach((item) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.text(item.nome, 14, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    Object.entries(item.porEmpresa).forEach(([empresa, valor]) => {
      doc.text(`${empresa}: ${formatarMoeda(valor)}`, 20, y);
      y += 6;
    });

    doc.setFont('helvetica', 'bold');
    doc.text(`Total: ${formatarMoeda(item.total)}`, 20, y);
    y += 12;
  });

  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, 285);

  doc.save('relatorio-funcionarios.pdf');
}

/* =========================================================
   PAINEL DO FUNCIONÁRIO / ENTREGADOR
========================================================= */

async function carregarMeusGastos() {
  const lista = document.getElementById('meusGastos');
  renderizarSkeleton(lista, 3);

  const dados = await Api.get('/meus-gastos');

  if (!dados.length) {
    limparEPreencher(lista, [estadoVazio('Você ainda não tem gastos registrados.')]);
    return;
  }

  limparEPreencher(lista, dados.map((gasto) => el('li', {}, [
    el('div', { class: 'gasto-topo' }, [
      el('strong', { text: gasto.empresa || 'Açaí no Grau' }),
      el('span', { class: `status ${gasto.status}`, text: gasto.status }),
    ]),
    el('div', { class: 'gasto-valor', text: formatarMoeda(gasto.valor) }),
    el('div', { class: 'gasto-descricao', text: gasto.descricao || '(sem descrição)' }),
    el('div', { class: 'gasto-data', text: formatarData(gasto.data) }),
  ])));
}

async function carregarMeuTotal() {
  const dados = await Api.get('/meus-gastos');

  let totalAcai = 0;
  let totalSubway = 0;
  let totalOutros = 0;

  dados.forEach((gasto) => {
    if (gasto.status !== 'pendente') return;
    const valor = Number(gasto.valor) || 0;
    const empresa = (gasto.empresa || '').toLowerCase().trim();

    if (empresa.includes('açaí') || empresa.includes('acai')) totalAcai += valor;
    else if (empresa.includes('subway')) totalSubway += valor;
    else totalOutros += valor;
  });

  const totalGeral = totalAcai + totalSubway + totalOutros;

  const totalAcaiEl = document.getElementById('totalAcai');
  const totalSubwayEl = document.getElementById('totalSubway');
  const totalGeralEl = document.getElementById('meuTotal');

  if (totalAcaiEl) totalAcaiEl.innerText = formatarMoeda(totalAcai);
  if (totalSubwayEl) totalSubwayEl.innerText = formatarMoeda(totalSubway);
  if (totalGeralEl) totalGeralEl.innerText = formatarMoeda(totalGeral);
}

/* =========================================================
   NAVEGAÇÃO / VISUAL
========================================================= */

function trocarLogo() {
  const logo = document.getElementById('logoEmpresa');
  const titulo = document.querySelector('.logo-topo span');

  if (logoAtual === 'acai') {
    logo.src = 'subway.png';
    titulo.innerText = 'Subway';
    logoAtual = 'subway';
  } else {
    logo.src = 'logo.png';
    titulo.innerText = 'Açaí no Grau';
    logoAtual = 'acai';
  }
}

function trocarSecaoAdmin(secaoId, botaoClicado) {
  document.querySelectorAll('.admin-section').forEach((secao) => secao.classList.remove('active-section'));
  const secao = document.getElementById(secaoId);
  if (secao) secao.classList.add('active-section');

  document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.remove('active'));
  if (botaoClicado) botaoClicado.classList.add('active');
}

/* =========================================================
   BOOT
========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  Modal.init();
});
