/* =========================================================
   ESTADO GLOBAL
========================================================= */

let token = localStorage.getItem('token');
let role = localStorage.getItem('role');
let nomeUsuario = localStorage.getItem('nomeUsuario');

let filtro = { ano: 0, mes: 0 };
let logoAtual = 'acai';

// Seleção em lote agora é por módulo (funcionário/entregador), já que o
// financeiro de cada um vive numa tela separada — ver missão de UX.
let selecao = { funcionario: [], entregador: [] };

// Seleção em lote da lista de envio de cobranças (WhatsApp) — módulo à
// parte, não usa a estrutura `selecao` acima porque não é uma lista de
// gastos, é uma lista de pessoas.
let selecaoListaEnvio = [];

// Cache da última carga, para não refazer requisições ao só trocar de aba.
let cache = { funcionarios: [], entregadores: [], gastos: [], resumo: null };

/* =========================================================
   HELPER DE DOM SEGURO
========================================================= */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // só para markup estático
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

function estadoVazio(mensagem, icone = '🗂️') {
  return el('div', { class: 'empty-state' }, [
    el('span', { class: 'empty-state-icon', text: icone }),
    mensagem,
  ]);
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
   TOAST
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
   MODAL
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

  abrir(conteudoNode, { largo = false } = {}) {
    this.box.classList.toggle('modal-wide', largo);
    limparEPreencher(this.box, [conteudoNode]);
    this.overlay.classList.remove('hidden');
  },

  fechar() {
    this.overlay.classList.add('hidden');
    this.box.innerHTML = '';
  },

  confirmar({ titulo, mensagem, textoConfirmar = 'Confirmar', perigo = false }) {
    return new Promise((resolve) => {
      const encerrar = (resultado) => { this.fechar(); resolve(resultado); };

      this.abrir(el('div', {}, [
        el('h3', { text: titulo }),
        el('p', { text: mensagem, style: 'margin-top:8px' }),
        el('div', { class: 'modal-acoes' }, [
          el('button', { class: 'btn btn-secondary', onclick: () => encerrar(false), text: 'Cancelar' }),
          el('button', { class: perigo ? 'btn btn-danger' : 'btn btn-primary', onclick: () => encerrar(true), text: textoConfirmar }),
        ]),
      ]));
    });
  },

  /**
   * Formulário genérico com validação inline simples (campo obrigatório
   * fica com borda vermelha + mensagem se enviado em branco).
   */
  formulario({ titulo, subtitulo, campos, textoConfirmar = 'Salvar', avisoPerigo = null }) {
    return new Promise((resolve) => {
      const inputsPorCampo = {};
      const errosPorCampo = {};

      const encerrar = (resultado) => { this.fechar(); resolve(resultado); };

      function validar() {
        let ok = true;
        campos.forEach((campo) => {
          if (!campo.obrigatorio) return;
          const input = inputsPorCampo[campo.nome];
          const valido = input.value.trim().length > 0;
          input.classList.toggle('invalid', !valido);
          errosPorCampo[campo.nome].classList.toggle('hidden', valido);
          if (!valido) ok = false;
        });
        return ok;
      }

      const camposNode = campos.map((campo) => {
        const input = campo.tipo === 'textarea'
          ? el('textarea', { placeholder: campo.placeholder || campo.label, text: campo.valor || '' })
          : el('input', {
              type: campo.tipo || 'text',
              value: campo.valor || '',
              placeholder: campo.placeholder || campo.label,
              autocomplete: campo.tipo === 'password' ? 'new-password' : 'off',
            });
        inputsPorCampo[campo.nome] = input;

        const erro = el('div', { class: 'field-error hidden', text: 'Campo obrigatório.' });
        errosPorCampo[campo.nome] = erro;

        return el('div', { class: 'field', style: 'margin-top:14px' }, [
          el('label', { class: campo.obrigatorio ? 'field-required' : '', text: campo.label }),
          input,
          erro,
          campo.dica ? el('div', { class: 'field-hint', text: campo.dica }) : null,
        ]);
      });

      this.abrir(el('div', {}, [
        el('h3', { text: titulo }),
        subtitulo ? el('p', { class: 'modal-subtitle', text: subtitulo }) : null,
        ...camposNode,
        avisoPerigo ? el('div', { class: 'modal-aviso', text: avisoPerigo }) : null,
        el('div', { class: 'modal-acoes' }, [
          el('button', { class: 'btn btn-secondary', onclick: () => encerrar(null), text: 'Cancelar' }),
          el('button', {
            class: 'btn btn-primary',
            onclick: () => {
              if (!validar()) return;
              const valores = {};
              for (const [nome, input] of Object.entries(inputsPorCampo)) valores[nome] = input.value;
              encerrar(valores);
            },
            text: textoConfirmar,
          }),
        ]),
      ]));

      const primeiroInput = Object.values(inputsPorCampo)[0];
      if (primeiroInput) setTimeout(() => primeiroInput.focus(), 30);
    });
  },
};

/* =========================================================
   API
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
    try { dados = await resposta.json(); } catch { dados = null; }

    if (!resposta.ok) {
      throw new Error((dados && dados.error) || 'Erro inesperado. Tente novamente.');
    }
    return dados;
  },

  get(caminho) { return this.chamar(caminho); },
  post(caminho, body) { return this.chamar(caminho, { method: 'POST', body }); },
  put(caminho, body) { return this.chamar(caminho, { method: 'PUT', body: body || {} }); },
  del(caminho, body) { return this.chamar(caminho, { method: 'DELETE', body }); },

  /**
   * Upload de arquivo (multipart/form-data) — não usa `chamar()` porque
   * ali o Content-Type é sempre "application/json"; aqui o navegador
   * precisa definir o Content-Type sozinho (com o boundary do multipart).
   */
  async upload(caminho, formData) {
    const resposta = await fetch(caminho, {
      method: 'POST',
      headers: { authorization: token },
      body: formData,
    });

    let dados = null;
    try { dados = await resposta.json(); } catch { dados = null; }

    if (!resposta.ok) {
      throw new Error((dados && dados.error) || 'Erro inesperado. Tente novamente.');
    }
    return dados;
  },
};

function queryStringFiltro() {
  const params = new URLSearchParams();
  if (filtro.ano) params.set('ano', filtro.ano);
  if (filtro.mes) params.set('mes', filtro.mes);
  const texto = params.toString();
  return texto ? `?${texto}` : '';
}

/* =========================================================
   TABELA (busca + ordenação + paginação + ações agrupadas)
   Componente único reutilizado em funcionários, entregadores e nos dois
   financeiros — antes cada lista tinha sua própria função de render.
========================================================= */

function criarTabela({ container, colunas, porPagina = 8, vazio = 'Nenhum registro encontrado.', iconeVazio = '🗂️' }) {
  let dadosCompletos = [];
  let dadosFiltrados = [];
  let pagina = 1;
  let ordenacao = { coluna: null, direcao: 1 };

  function ordenar(lista) {
    if (!ordenacao.coluna) return lista;
    const col = colunas.find((c) => c.chave === ordenacao.coluna);
    const copia = [...lista];
    copia.sort((a, b) => {
      const va = col.valorOrdenacao ? col.valorOrdenacao(a) : a[ordenacao.coluna];
      const vb = col.valorOrdenacao ? col.valorOrdenacao(b) : b[ordenacao.coluna];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * ordenacao.direcao;
      return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR') * ordenacao.direcao;
    });
    return copia;
  }

  function renderPaginacao(totalPaginas) {
    const controles = el('div', { class: 'table-pagination-controls' });

    controles.appendChild(el('button', {
      class: 'page-btn', disabled: pagina === 1 || undefined,
      onclick: () => { pagina -= 1; render(); }, text: '‹',
    }));

    for (let p = 1; p <= totalPaginas; p += 1) {
      controles.appendChild(el('button', {
        class: `page-btn ${p === pagina ? 'active' : ''}`,
        onclick: () => { pagina = p; render(); },
        text: String(p),
      }));
    }

    controles.appendChild(el('button', {
      class: 'page-btn', disabled: pagina === totalPaginas || undefined,
      onclick: () => { pagina += 1; render(); }, text: '›',
    }));

    return el('div', { class: 'table-pagination' }, [
      el('span', { class: 'table-pagination-info', text: `${dadosFiltrados.length} registro(s)` }),
      controles,
    ]);
  }

  function render() {
    const ordenados = ordenar(dadosFiltrados);
    const totalPaginas = Math.max(1, Math.ceil(ordenados.length / porPagina));
    if (pagina > totalPaginas) pagina = totalPaginas;
    const pageItems = ordenados.slice((pagina - 1) * porPagina, (pagina - 1) * porPagina + porPagina);

    container.innerHTML = '';

    if (!dadosCompletos.length) {
      container.appendChild(estadoVazio(vazio, iconeVazio));
      return;
    }

    if (!ordenados.length) {
      container.appendChild(estadoVazio('Nada encontrado para essa busca/filtro.', '🔍'));
      return;
    }

    const headRow = el('tr', {}, colunas.map((col) => el('th', {
      class: col.sortavel ? 'sortable' : '',
      onclick: col.sortavel ? () => {
        ordenacao = ordenacao.coluna === col.chave ? { coluna: col.chave, direcao: ordenacao.direcao * -1 } : { coluna: col.chave, direcao: 1 };
        render();
      } : undefined,
    }, [
      col.titulo,
      col.sortavel ? el('span', {
        class: `sort-arrow ${ordenacao.coluna === col.chave ? 'active' : ''}`,
        text: ordenacao.coluna === col.chave ? (ordenacao.direcao === 1 ? '▲' : '▼') : '↕',
      }) : null,
    ])));

    const tbody = el('tbody', {}, pageItems.map((item) => el('tr', {}, colunas.map((col) => col.render(item)))));

    const table = el('table', { class: 'data-table' }, [el('thead', {}, headRow), tbody]);
    container.appendChild(el('div', { class: 'table-wrapper' }, table));

    if (totalPaginas > 1) container.appendChild(renderPaginacao(totalPaginas));
  }

  return {
    setDados(lista) { dadosCompletos = lista; dadosFiltrados = lista; pagina = 1; render(); },
    filtrar(fn) { dadosFiltrados = dadosCompletos.filter(fn); pagina = 1; render(); },
    // Usado por "Selecionar todos": precisa saber quem está filtrado
    // agora (resultado da busca), não a lista completa sem filtro.
    obterFiltrados() { return dadosFiltrados; },
    // Redesenha com o filtro/página atuais intactos (ex: depois de
    // marcar "Selecionar todos", só pra atualizar os checkboxes na
    // tela) — diferente de setDados(), que reaplicaria a lista inteira
    // e perderia a busca ativa.
    rerender() { render(); },
  };
}

function colunaTexto(chave, titulo, { sortavel = true, classe = '' } = {}) {
  return { chave, titulo, sortavel, render: (item) => el('td', { class: classe, text: String(item[chave] ?? '') }) };
}

function colunaStatus(chave = 'status') {
  return {
    chave, titulo: 'Status', sortavel: true,
    render: (item) => el('td', {}, el('span', { class: `status-badge ${item[chave]}`, text: item[chave] })),
  };
}

function colunaAcoes(gerarItens) {
  return {
    chave: '_acoes', titulo: '', sortavel: false,
    render: (item) => {
      const td = el('td');
      const wrapper = el('div', { class: 'row-actions' });
      const btn = el('button', { class: 'kebab-btn', text: '⋮' });
      wrapper.appendChild(btn);

      let menuAberto = null;
      function fechar() {
        if (menuAberto) { menuAberto.remove(); menuAberto = null; document.removeEventListener('click', aoClicarFora); }
      }
      function aoClicarFora(evento) {
        if (!wrapper.contains(evento.target)) fechar();
      }

      btn.addEventListener('click', (evento) => {
        evento.stopPropagation();
        if (menuAberto) { fechar(); return; }
        menuAberto = el('div', { class: 'kebab-menu' }, gerarItens(item).map((acao) => el('button', {
          class: acao.perigo ? 'danger' : '',
          onclick: () => { fechar(); acao.onClick(); },
          text: acao.label,
        })));
        wrapper.appendChild(menuAberto);
        document.addEventListener('click', aoClicarFora);
      });

      td.appendChild(wrapper);
      return td;
    },
  };
}

function ligarBusca(inputId, aoDigitar) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', () => aoDigitar(input.value.trim().toLowerCase()));
}

/* =========================================================
   LOGIN / SESSÃO
========================================================= */

if (token && role) iniciarPainel();

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

function logout() {
  localStorage.clear();
  location.reload();
}

async function iniciarPainel() {
  document.getElementById('loginBox').classList.add('hidden');

  const mensagem = `Bem-vindo${nomeUsuario ? ', ' + nomeUsuario : ''} ao seu controle de gastos.`;
  const boasVindasAdmin = document.getElementById('boasVindasAdmin');
  const boasVindasFuncionario = document.getElementById('boasVindasFuncionario');
  if (boasVindasAdmin) boasVindasAdmin.innerText = mensagem;
  if (boasVindasFuncionario) boasVindasFuncionario.innerText = mensagem;

  if (role === 'admin') {
    document.getElementById('adminPanel').classList.remove('hidden');
    inicializarBuscas();
    await carregarTudo();
  } else if (role === 'entregador') {
    document.getElementById('funcionarioPanel').classList.remove('hidden');
    document.getElementById('areaLabel').innerText = 'Área do entregador';
    document.getElementById('tituloArea').innerText = 'Financeiro';
    document.getElementById('financeiroEntregador').classList.remove('hidden');
    document.getElementById('gastosFuncionarioSimples').classList.add('hidden');
    await carregarFinanceiroEntregador();
  } else {
    document.getElementById('funcionarioPanel').classList.remove('hidden');
    await carregarPainelFuncionario();
  }
}

/* =========================================================
   SIDEBAR / NAVEGAÇÃO
========================================================= */

function alternarSidebar() {
  const layout = document.getElementById('adminPanel');
  layout.classList.toggle('sidebar-collapsed');
}

const secoesComCargaSobDemanda = new Set();

function mudarSecao(secaoId, botaoClicado) {
  document.querySelectorAll('.admin-section').forEach((secao) => secao.classList.remove('active-section'));
  const secao = document.getElementById(secaoId);
  if (secao) secao.classList.add('active-section');

  document.querySelectorAll('.side-nav-item').forEach((btn) => btn.classList.remove('active'));
  if (botaoClicado) botaoClicado.classList.add('active');
}

function mudarSubTab(moduloId, subTabId, botaoClicado) {
  const modulo = document.getElementById(moduloId);
  modulo.querySelectorAll('.module-panel').forEach((p) => p.classList.remove('active-panel'));
  document.getElementById(subTabId).classList.add('active-panel');

  modulo.querySelectorAll('.tab-pill').forEach((btn) => btn.classList.remove('active'));
  if (botaoClicado) botaoClicado.classList.add('active');
}

function inicializarBuscas() {
  ligarBusca('buscarFuncionario', (termo) => tabelaFuncionarios.filtrar((f) => f.nome.toLowerCase().includes(termo) || f.usuario.toLowerCase().includes(termo)));
  ligarBusca('buscarEntregador', (termo) => tabelaEntregadores.filtrar((e) => e.nome.toLowerCase().includes(termo) || e.usuario.toLowerCase().includes(termo)));
  ligarBusca('buscarGastoFuncionario', (termo) => {
    tabelasGastos.funcionario.filtrar((g) => g.nome.toLowerCase().includes(termo));
    atualizarInterfaceSelecao('funcionario');
  });
  ligarBusca('buscarGastoEntregador', (termo) => {
    tabelasGastos.entregador.filtrar((g) => g.nome.toLowerCase().includes(termo));
    atualizarInterfaceSelecao('entregador');
  });
  ligarBusca('buscarComprovanteAdmin', (termo) => tabelaComprovantesAdmin.filtrar((c) => c.entregador_nome.toLowerCase().includes(termo)));
  ligarBusca('buscarListaEnvio', (termo) => {
    tabelaListaEnvio.filtrar((p) => p.nome.toLowerCase().includes(termo));
    atualizarInterfaceSelecaoListaEnvio();
  });
}

/* =========================================================
   CARGA GERAL (admin)
========================================================= */

async function carregarTudo() {
  const [funcionarios, entregadores, gastos, resumo] = await Promise.all([
    Api.get('/funcionarios'),
    Api.get('/entregadores'),
    Api.get(`/admin/gastos${queryStringFiltro()}`),
    Api.get(`/admin/relatorios/resumo${queryStringFiltro()}`),
  ]);

  cache = { funcionarios, entregadores, gastos, resumo };

  renderizarDashboard();
  renderizarFuncionarios();
  renderizarEntregadores();
  renderizarGastosPorTipo('funcionario');
  renderizarGastosPorTipo('entregador');
  renderizarRanking('funcionario');
  renderizarRanking('entregador');
  renderizarSelectPessoas();
  popularSeletorDeAno();

  // Independentes do Promise.all acima de propósito: se o WhatsApp
  // estiver indisponível, isso não deve impedir o resto do painel
  // administrativo de carregar.
  carregarComprovantesAdmin().catch((erro) => Toast.erro(erro.message));
  carregarListaEnvio().catch((erro) => Toast.erro(erro.message));
  atualizarStatusWhatsapp().catch(() => {});
}

async function recarregarGastosEResumo() {
  const [gastos, resumo] = await Promise.all([
    Api.get(`/admin/gastos${queryStringFiltro()}`),
    Api.get(`/admin/relatorios/resumo${queryStringFiltro()}`),
  ]);
  cache.gastos = gastos;
  cache.resumo = resumo;

  renderizarDashboard();
  renderizarGastosPorTipo('funcionario');
  renderizarGastosPorTipo('entregador');
  renderizarRanking('funcionario');
  renderizarRanking('entregador');
}

function popularSeletorDeAno() {
  const select = document.getElementById('filtroAno');
  if (select.dataset.preenchido) return;
  const anos = new Set(cache.gastos.map((g) => (g.data || '').slice(0, 4)).filter(Boolean));
  Array.from(anos).sort().reverse().forEach((ano) => select.appendChild(el('option', { value: ano, text: ano })));
  select.dataset.preenchido = '1';
}

function filtrarAno(valor) {
  filtro.ano = Number(valor);
  recarregarGastosEResumo();
}

function filtrarMesSelect(valor) {
  filtro.mes = Number(valor);
  recarregarGastosEResumo();
}

/* =========================================================
   DASHBOARD (Visão Geral)
========================================================= */

function kpiCard({ icone, tom, rotulo, valor, descricao }) {
  return el('div', { class: 'kpi-card' }, [
    el('div', { class: `kpi-icon tone-${tom}`, text: icone }),
    el('span', { class: 'kpi-label', text: rotulo }),
    el('div', { class: 'kpi-value', text: valor }),
    descricao ? el('div', { class: 'kpi-desc', text: descricao }) : null,
  ]);
}

function renderizarKpis(containerId, resumo) {
  const container = document.getElementById(containerId);
  if (!container) return;

  limparEPreencher(container, [
    kpiCard({ icone: '⚠️', tom: 'danger', rotulo: 'Total pendente', valor: formatarMoeda(resumo.totalPendente), descricao: 'Valores em aberto' }),
    kpiCard({ icone: '✅', tom: 'success', rotulo: 'Total pago', valor: formatarMoeda(resumo.totalPago), descricao: 'Valores quitados' }),
    kpiCard({ icone: '💰', tom: 'accent', rotulo: 'Total movimentado', valor: formatarMoeda(resumo.totalMovimentado), descricao: 'Pago + pendente' }),
    kpiCard({ icone: '🧑‍💼', tom: 'neutral', rotulo: 'Funcionários ativos', valor: String(resumo.totalFuncionarios), descricao: 'Cadastrados no sistema' }),
    kpiCard({ icone: '🛵', tom: 'neutral', rotulo: 'Entregadores ativos', valor: String(resumo.totalEntregadores), descricao: 'Cadastrados no sistema' }),
  ]);
}

// Empresas que sempre existem no sistema (ver os <select> de gasto em
// index.html) — mantidas aqui só para SEMPRE mostrar as duas no
// gráfico, mesmo quando uma delas está zerada no período (em vez de
// simplesmente sumir da lista, o que deixava o card vazio demais e
// escondia informação real: "essa empresa está em dia"). Qualquer
// empresa nova que apareça em `resumo.totalPorEmpresa` também entra,
// sem precisar mexer aqui — não é uma lista fechada.
const EMPRESAS_CONHECIDAS = ['Açaí no Grau', 'Subway'];

function renderizarGraficoEmpresas(resumo, gastos) {
  const container = document.getElementById('graficoEmpresas');
  if (!container) return;

  const nomesEmpresas = new Set([...EMPRESAS_CONHECIDAS, ...Object.keys(resumo.totalPorEmpresa)]);

  // Quantidade de lançamentos pendentes por empresa — não vem do
  // /admin/relatorios/resumo (que só soma valores), então é calculada
  // aqui em cima do `gastos` que a Visão Geral já carrega.
  const pendentesPorEmpresa = {};
  (gastos || []).forEach((g) => {
    if (g.status !== 'pendente') return;
    const empresa = g.empresa || 'Não informado';
    if (!pendentesPorEmpresa[empresa]) pendentesPorEmpresa[empresa] = { qtd: 0 };
    pendentesPorEmpresa[empresa].qtd += 1;
  });

  const entradas = [...nomesEmpresas]
    .map((empresa) => ({
      empresa,
      valor: resumo.totalPorEmpresa[empresa] || 0,
      qtd: (pendentesPorEmpresa[empresa] && pendentesPorEmpresa[empresa].qtd) || 0,
    }))
    .sort((a, b) => b.valor - a.valor);

  if (!entradas.length) {
    limparEPreencher(container, [estadoVazio('Nenhum valor pendente no período.', '📊')]);
    return;
  }

  const totalGeral = entradas.reduce((soma, e) => soma + e.valor, 0);
  const maior = Math.max(...entradas.map((e) => e.valor), 0);

  const linhas = entradas.map((e) => {
    const percentual = totalGeral ? Math.round((e.valor / totalGeral) * 100) : 0;
    const ticketMedio = e.qtd ? e.valor / e.qtd : 0;

    return el('div', {}, [
      el('div', { class: 'bar-row' }, [
        el('span', { class: 'bar-row-label', text: e.empresa }),
        el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${maior ? (e.valor / maior) * 100 : 0}%` })),
        el('span', { class: 'bar-row-value', text: formatarMoeda(e.valor) }),
        el('span', { class: 'bar-row-percent', text: e.valor > 0 ? `${percentual}%` : '—' }),
      ]),
      el('div', {
        class: 'bar-row-meta',
        text: e.qtd
          ? `${e.qtd} lançamento(s) pendente(s) • ticket médio ${formatarMoeda(ticketMedio)}`
          : 'Sem pendências neste período.',
      }),
    ]);
  });

  // Só vale destacar "quem concentra mais" quando há de fato mais de
  // uma empresa com valor em aberto — com uma só, seria óbvio (100%)
  // e a frase não agregaria nada.
  const comValor = entradas.filter((e) => e.valor > 0);
  const dominante = comValor[0];

  const insight = comValor.length > 1 && dominante
    ? el('div', { class: 'insight-card tone-info', style: 'margin-top:16px' }, [
        el('span', { class: 'insight-icon', text: '🏆' }),
        el('div', { class: 'insight-text' }, [
          el('strong', { text: `${dominante.empresa} concentra a maior parte do valor pendente` }),
          el('span', { text: `${Math.round((dominante.valor / totalGeral) * 100)}% do total em aberto no período (${formatarMoeda(dominante.valor)}).` }),
        ]),
      ])
    : null;

  limparEPreencher(container, [el('div', { class: 'bar-list bar-list-detalhado' }, linhas), insight].filter(Boolean));
}

function renderizarAlertas(resumo, gastos) {
  const container = document.getElementById('alertasDashboard');
  if (!container) return;

  const semDescricao = gastos.filter((g) => !g.descricao || !g.descricao.trim()).length;
  const pendentesCount = gastos.filter((g) => g.status === 'pendente').length;
  const maiorFunc = resumo.rankingFuncionarios[0];
  const maiorEnt = resumo.rankingEntregadores[0];
  const maior = [maiorFunc, maiorEnt].filter(Boolean).sort((a, b) => b.total - a.total)[0];

  const alertas = [];

  if (pendentesCount > 0) {
    alertas.push({ tom: 'info', icone: '⏳', titulo: `${pendentesCount} gasto(s) pendente(s)`, texto: `Total em aberto: ${formatarMoeda(resumo.totalPendente)}` });
  }
  if (maior) {
    alertas.push({ tom: 'info', icone: '🔝', titulo: `Maior pendência: ${maior.nome}`, texto: formatarMoeda(maior.total) });
  }
  if (semDescricao > 0) {
    alertas.push({ tom: 'warning', icone: '⚠️', titulo: `${semDescricao} gasto(s) sem descrição`, texto: 'Lançamentos antigos sem detalhe, difíceis de auditar depois.' });
  }
  if (!alertas.length) {
    alertas.push({ tom: 'info', icone: '✅', titulo: 'Tudo em dia', texto: 'Nenhuma pendência encontrada para este período.' });
  }

  limparEPreencher(container, alertas.map((a) => el('div', { class: `insight-card tone-${a.tom}` }, [
    el('span', { class: 'insight-icon', text: a.icone }),
    el('div', { class: 'insight-text' }, [
      el('strong', { text: a.titulo }),
      el('span', { text: a.texto }),
    ]),
  ])));
}

function renderizarAtividadeRecente(gastos) {
  const container = document.getElementById('atividadeRecente');
  if (!container) return;

  const recentes = gastos.slice(0, 8);
  if (!recentes.length) {
    limparEPreencher(container, [estadoVazio('Nenhuma movimentação registrada ainda.', '🕓')]);
    return;
  }

  limparEPreencher(container, [el('div', { class: 'activity-list' }, recentes.map((g) => el('div', { class: 'activity-item' }, [
    el('div', { class: 'activity-icon', text: g.tipo === 'Entregador' ? '🛵' : '🧑‍💼' }),
    el('div', { class: 'activity-main' }, [
      el('div', { class: 'activity-title', text: `${g.nome} • ${g.empresa || 'Açaí no Grau'}` }),
      el('div', { class: 'activity-meta', text: `${g.descricao || 'Sem descrição'} — ${formatarData(g.data)}` }),
    ]),
    el('div', { class: 'activity-value', style: g.status === 'pendente' ? 'color:#fca5a5' : 'color:#86efac', text: formatarMoeda(g.valor) }),
  ])))]);
}

function renderizarDashboard() {
  renderizarKpis('kpiGrid', cache.resumo);
  renderizarKpis('kpiGridRelatorio', cache.resumo);
  renderizarGraficoEmpresas(cache.resumo, cache.gastos);
  renderizarAlertas(cache.resumo, cache.gastos);
  renderizarAtividadeRecente(cache.gastos);
}

/* =========================================================
   FUNCIONÁRIOS (módulo isolado)
========================================================= */

const tabelaFuncionarios = criarTabela({
  container: document.getElementById('tabelaFuncionarios'),
  vazio: 'Nenhum funcionário cadastrado ainda.',
  iconeVazio: '🧑‍💼',
  colunas: [
    colunaTexto('nome', 'Nome', { classe: 'cell-strong' }),
    colunaTexto('usuario', 'Usuário', { classe: 'cell-muted' }),
    colunaAcoes((funcionario) => [
      { label: 'Editar', onClick: () => editarFuncionario(funcionario) },
      { label: 'Excluir', perigo: true, onClick: () => excluirFuncionario(funcionario) },
    ]),
  ],
});

function renderizarFuncionarios() {
  tabelaFuncionarios.setDados(cache.funcionarios);
}

function renderizarSelectPessoas() {
  const selectFunc = document.getElementById('funcionarioGastoSelect');
  const selectEnt = document.getElementById('entregadorGastoSelect');

  limparEPreencher(selectFunc, cache.funcionarios.length
    ? cache.funcionarios.map((f) => el('option', { value: f.id, text: f.nome }))
    : [el('option', { value: '', text: 'Nenhum funcionário cadastrado' })]);

  limparEPreencher(selectEnt, cache.entregadores.length
    ? cache.entregadores.map((eItem) => el('option', { value: eItem.id, text: eItem.nome }))
    : [el('option', { value: '', text: 'Nenhum entregador cadastrado' })]);
}

async function abrirModalNovoFuncionario() {
  const valores = await Modal.formulario({
    titulo: 'Novo funcionário',
    subtitulo: 'Cria um acesso para o funcionário consultar os próprios gastos.',
    campos: [
      { nome: 'nome', label: 'Nome completo', obrigatorio: true },
      { nome: 'usuario', label: 'Usuário de acesso', obrigatorio: true },
      { nome: 'senha', label: 'Senha', tipo: 'password', obrigatorio: true, dica: 'Mínimo de 6 caracteres.' },
      { nome: 'telefone', label: 'Telefone (opcional)' },
    ],
    textoConfirmar: 'Cadastrar',
  });
  if (!valores) return;

  try {
    await Api.post('/funcionarios', valores);
    Toast.sucesso('Funcionário cadastrado.');
    cache.funcionarios = await Api.get('/funcionarios');
    renderizarFuncionarios();
    renderizarSelectPessoas();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function editarFuncionario(funcionario) {
  const valores = await Modal.formulario({
    titulo: 'Editar funcionário',
    campos: [
      { nome: 'nome', label: 'Nome', valor: funcionario.nome, obrigatorio: true },
      { nome: 'usuario', label: 'Usuário', valor: funcionario.usuario, obrigatorio: true },
      { nome: 'senha', label: 'Nova senha (opcional)', tipo: 'password', dica: 'Deixe em branco para manter a senha atual.' },
      { nome: 'telefone', label: 'Telefone (opcional)', valor: funcionario.telefone || '' },
    ],
  });
  if (!valores) return;

  try {
    await Api.put(`/funcionarios/${funcionario.id}`, valores);
    Toast.sucesso('Funcionário atualizado.');
    cache.funcionarios = await Api.get('/funcionarios');
    renderizarFuncionarios();
    renderizarSelectPessoas();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function excluirFuncionario(funcionario) {
  const ok = await Modal.confirmar({
    titulo: 'Excluir funcionário',
    mensagem: `Deseja excluir "${funcionario.nome}"? Só é possível se não houver gastos vinculados a ele.`,
    textoConfirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  try {
    await Api.del(`/funcionarios/${funcionario.id}`);
    Toast.sucesso('Funcionário excluído.');
    cache.funcionarios = await Api.get('/funcionarios');
    renderizarFuncionarios();
    renderizarSelectPessoas();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

/* =========================================================
   ENTREGADORES (módulo isolado)
========================================================= */

const tabelaEntregadores = criarTabela({
  container: document.getElementById('tabelaEntregadores'),
  vazio: 'Nenhum entregador cadastrado ainda.',
  iconeVazio: '🛵',
  colunas: [
    colunaTexto('nome', 'Nome', { classe: 'cell-strong' }),
    colunaTexto('usuario', 'Usuário', { classe: 'cell-muted' }),
    colunaAcoes((entregador) => [
      { label: 'Editar', onClick: () => editarEntregador(entregador) },
      { label: 'Excluir', perigo: true, onClick: () => excluirEntregador(entregador) },
    ]),
  ],
});

function renderizarEntregadores() {
  tabelaEntregadores.setDados(cache.entregadores);
}

async function abrirModalNovoEntregador() {
  const valores = await Modal.formulario({
    titulo: 'Novo entregador',
    subtitulo: 'Cria um acesso para o entregador consultar os próprios gastos.',
    campos: [
      { nome: 'nome', label: 'Nome completo', obrigatorio: true },
      { nome: 'usuario', label: 'Usuário de acesso', obrigatorio: true },
      { nome: 'senha', label: 'Senha', tipo: 'password', obrigatorio: true, dica: 'Mínimo de 6 caracteres.' },
      { nome: 'telefone', label: 'Telefone (WhatsApp)', dica: 'Com DDD, só números. Usado para lembretes automáticos.' },
    ],
    textoConfirmar: 'Cadastrar',
  });
  if (!valores) return;

  try {
    await Api.post('/entregadores', valores);
    Toast.sucesso('Entregador cadastrado.');
    cache.entregadores = await Api.get('/entregadores');
    renderizarEntregadores();
    renderizarSelectPessoas();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function editarEntregador(entregador) {
  const valores = await Modal.formulario({
    titulo: 'Editar entregador',
    campos: [
      { nome: 'nome', label: 'Nome', valor: entregador.nome, obrigatorio: true },
      { nome: 'usuario', label: 'Usuário', valor: entregador.usuario, obrigatorio: true },
      { nome: 'senha', label: 'Nova senha (opcional)', tipo: 'password', dica: 'Deixe em branco para manter a senha atual.' },
      { nome: 'telefone', label: 'Telefone (WhatsApp)', valor: entregador.telefone || '', dica: 'Com DDD, só números.' },
    ],
  });
  if (!valores) return;

  try {
    await Api.put(`/entregadores/${entregador.id}`, valores);
    Toast.sucesso('Entregador atualizado.');
    cache.entregadores = await Api.get('/entregadores');
    renderizarEntregadores();
    renderizarSelectPessoas();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function excluirEntregador(entregador) {
  const ok = await Modal.confirmar({
    titulo: 'Excluir entregador',
    mensagem: `Deseja excluir "${entregador.nome}"? Só é possível se não houver gastos vinculados a ele.`,
    textoConfirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  try {
    await Api.del(`/entregadores/${entregador.id}`);
    Toast.sucesso('Entregador excluído.');
    cache.entregadores = await Api.get('/entregadores');
    renderizarEntregadores();
    renderizarSelectPessoas();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

/* =========================================================
   GASTOS — separados por tipo (funcionário / entregador)
   Antes existia UMA lista misturando os dois; agora cada módulo só
   enxerga (e só pode mexer) nos gastos do seu próprio tipo.
========================================================= */

const rotuloTipo = { funcionario: 'Funcionário', entregador: 'Entregador' };

const tabelasGastos = {
  funcionario: criarTabela({
    container: document.getElementById('tabelaGastosFuncionario'),
    vazio: 'Nenhum débito de funcionário neste período.',
    iconeVazio: '💳',
    colunas: colunasGasto('funcionario'),
  }),
  entregador: criarTabela({
    container: document.getElementById('tabelaGastosEntregador'),
    vazio: 'Nenhum débito de entregador neste período.',
    iconeVazio: '💳',
    colunas: colunasGasto('entregador'),
  }),
};

function colunasGasto(tipo) {
  return [
    {
      chave: '_check', titulo: '', sortavel: false,
      render: (g) => el('td', {}, el('input', {
        type: 'checkbox', class: 'gasto-checkbox',
        checked: selecao[tipo].includes(g.id) || undefined,
        onchange: () => toggleSelecionarGasto(tipo, g.id),
      })),
    },
    colunaTexto('nome', 'Nome', { classe: 'cell-strong' }),
    colunaTexto('empresa', 'Empresa', { classe: 'cell-muted' }),
    {
      chave: 'valor', titulo: 'Valor', sortavel: true,
      valorOrdenacao: (g) => Number(g.valor) || 0,
      render: (g) => el('td', { class: 'cell-num' }, formatarMoeda(g.valor)),
    },
    colunaTexto('descricao', 'Descrição', { sortavel: false }),
    colunaStatus('status'),
    {
      chave: 'data', titulo: 'Data', sortavel: true,
      valorOrdenacao: (g) => g.data,
      render: (g) => el('td', { class: 'cell-muted' }, formatarData(g.data)),
    },
    colunaAcoes((g) => {
      const acoes = [];
      if (g.status === 'pendente') acoes.push({ label: 'Marcar como pago', onClick: () => marcarPago(g.id) });
      acoes.push({ label: 'Editar', onClick: () => editarGasto(g) });
      acoes.push({ label: 'Excluir', perigo: true, onClick: () => removerGasto(g.id) });
      return acoes;
    }),
  ];
}

function gastosPorTipo(tipo) {
  return cache.gastos.filter((g) => g.tipo === rotuloTipo[tipo]);
}

function renderizarGastosPorTipo(tipo) {
  tabelasGastos[tipo].setDados(gastosPorTipo(tipo));
  atualizarInterfaceSelecao(tipo);
}

async function adicionarGasto(tipo) {
  const prefixo = tipo === 'funcionario' ? 'Funcionario' : 'Entregador';
  const pessoaId = document.getElementById(`${tipo}GastoSelect`).value;
  const empresa = document.getElementById(`empresaGasto${prefixo}`).value;
  const valor = document.getElementById(`valorGasto${prefixo}`).value;
  const descricao = document.getElementById(`descricaoGasto${prefixo}`).value;

  if (!pessoaId) {
    Toast.erro(`Cadastre um ${rotuloTipo[tipo].toLowerCase()} antes de lançar um débito.`);
    return;
  }

  const corpo = tipo === 'funcionario'
    ? { funcionario_id: pessoaId, entregador_id: null, valor, descricao, empresa }
    : { funcionario_id: null, entregador_id: pessoaId, valor, descricao, empresa };

  try {
    await Api.post('/gastos', corpo);
    Toast.sucesso('Débito adicionado.');
    document.getElementById(`valorGasto${prefixo}`).value = '';
    document.getElementById(`descricaoGasto${prefixo}`).value = '';
    await recarregarGastosEResumo();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function editarGasto(gasto) {
  const valores = await Modal.formulario({
    titulo: 'Editar débito',
    campos: [
      { nome: 'valor', label: 'Valor', valor: String(gasto.valor), tipo: 'number', obrigatorio: true },
      { nome: 'descricao', label: 'Descrição', valor: gasto.descricao, obrigatorio: true },
    ],
  });
  if (!valores) return;

  try {
    await Api.put(`/gastos/${gasto.id}`, valores);
    Toast.sucesso('Débito atualizado.');
    await recarregarGastosEResumo();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function marcarPago(id) {
  try {
    await Api.put(`/gastos/${id}/pago`);
    await recarregarGastosEResumo();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function removerGasto(id) {
  const ok = await Modal.confirmar({
    titulo: 'Excluir débito',
    mensagem: 'Deseja excluir este débito? Essa ação não pode ser desfeita.',
    textoConfirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  try {
    await Api.del(`/gastos/${id}`);
    await recarregarGastosEResumo();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

/* ---------- Seleção em lote (por tipo) ---------- */

function toggleSelecionarGasto(tipo, id) {
  const lista = selecao[tipo];
  const index = lista.indexOf(id);
  if (index > -1) lista.splice(index, 1);
  else lista.push(id);
  atualizarInterfaceSelecao(tipo);
}

function atualizarInterfaceSelecao(tipo) {
  const sufixo = tipo === 'funcionario' ? 'Funcionario' : 'Entregador';
  const contador = document.getElementById(`contador${sufixo}`);
  const acoes = document.getElementById(`acoesLote${sufixo}`);
  const selecionarTodos = document.getElementById(`selecionarTodos${sufixo}`);

  if (contador) contador.innerText = `${selecao[tipo].length} selecionado(s)`;
  if (acoes) acoes.classList.toggle('hidden', selecao[tipo].length === 0);

  // "Selecionar todos" reflete o que está FILTRADO na busca agora (ex:
  // buscou "Matheus" e marcou todos os dele) — não o total geral. Sem
  // busca ativa, o filtrado é a lista inteira, então continua marcando
  // todo mundo normalmente.
  const idsFiltrados = tabelasGastos[tipo].obterFiltrados().map((g) => g.id);
  if (selecionarTodos) selecionarTodos.checked = idsFiltrados.length > 0 && idsFiltrados.every((id) => selecao[tipo].includes(id));
}

function toggleSelecionarTodos(tipo) {
  const sufixo = tipo === 'funcionario' ? 'Funcionario' : 'Entregador';
  const marcado = document.getElementById(`selecionarTodos${sufixo}`).checked;
  const idsFiltrados = tabelasGastos[tipo].obterFiltrados().map((g) => g.id);

  if (marcado) {
    // Soma aos já selecionados (não sobrescreve) — assim dá pra buscar
    // "Matheus", selecionar todos dele, depois buscar "Ana" e selecionar
    // todos dela também, acumulando os dois num só lote.
    const conjunto = new Set(selecao[tipo]);
    idsFiltrados.forEach((id) => conjunto.add(id));
    selecao[tipo] = [...conjunto];
  } else {
    const idsFiltradosSet = new Set(idsFiltrados);
    selecao[tipo] = selecao[tipo].filter((id) => !idsFiltradosSet.has(id));
  }

  // rerender() (não renderizarGastosPorTipo/setDados) de propósito: só
  // atualiza os checkboxes na tela, sem descartar a busca ativa.
  tabelasGastos[tipo].rerender();
  atualizarInterfaceSelecao(tipo);
}

async function marcarSelecionadosComoPagos(tipo) {
  if (!selecao[tipo].length) return;

  const ok = await Modal.confirmar({
    titulo: 'Marcar como pagos',
    mensagem: `Deseja marcar ${selecao[tipo].length} débito(s) como pagos?`,
    textoConfirmar: 'Marcar como pagos',
  });
  if (!ok) return;

  await Promise.all(selecao[tipo].map((id) => Api.put(`/gastos/${id}/pago`)));
  selecao[tipo] = [];
  await recarregarGastosEResumo();
  Toast.sucesso('Débitos marcados como pagos.');
}

async function excluirSelecionados(tipo) {
  if (!selecao[tipo].length) return;

  const ok = await Modal.confirmar({
    titulo: 'Excluir débitos selecionados',
    mensagem: `Deseja excluir ${selecao[tipo].length} débito(s)? Essa ação não pode ser desfeita.`,
    textoConfirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  await Promise.all(selecao[tipo].map((id) => Api.del(`/gastos/${id}`)));
  selecao[tipo] = [];
  await recarregarGastosEResumo();
  Toast.sucesso('Débitos excluídos.');
}

/* =========================================================
   DESEMPENHO (por módulo — antes chamado "Ranking")
   Antes o card só tinha nome + valor em texto puro (sem nenhum estilo
   aplicado de verdade — as classes usadas nem existiam mais no CSS
   depois do redesign). Agora tem posição, avatar com iniciais e uma
   barra comparando com quem está no topo.
========================================================= */

function iniciaisDoNome(nome) {
  const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
  const letras = partes.slice(0, 2).map((parte) => parte[0].toUpperCase());
  return letras.join('') || '?';
}

function cardDesempenho(item, posicao, maiorValor) {
  const classeTop = posicao <= 3 ? `top${posicao}` : '';
  const proporcao = maiorValor ? Math.max(4, (item.total / maiorValor) * 100) : 0;

  const chips = Object.entries(item.porEmpresa).map(([empresa, valor]) => el('div', { class: 'desempenho-chip' }, [
    el('span', { class: 'desempenho-chip-label', text: empresa }),
    el('span', { class: 'desempenho-chip-valor', text: formatarMoeda(valor) }),
  ]));

  return el('div', { class: `desempenho-card ${classeTop}` }, [
    el('div', { class: 'desempenho-topo' }, [
      el('div', { class: `desempenho-rank ${classeTop}`, text: `#${posicao}` }),
      el('div', { class: 'desempenho-avatar', text: iniciaisDoNome(item.nome) }),
      el('div', { class: 'desempenho-nome', text: item.nome }),
      el('div', { class: 'desempenho-total', text: formatarMoeda(item.total) }),
    ]),
    el('div', { class: 'desempenho-bar-track' }, el('div', { class: 'desempenho-bar-fill', style: `width:${proporcao}%` })),
    chips.length ? el('div', { class: 'desempenho-chips' }, chips) : null,
  ]);
}

function renderizarRanking(tipo) {
  if (!cache.resumo) return;
  const containerId = tipo === 'funcionario' ? 'rankingFuncionarios' : 'rankingEntregadores';
  const lista = tipo === 'funcionario' ? cache.resumo.rankingFuncionarios : cache.resumo.rankingEntregadores;
  const container = document.getElementById(containerId);
  const maiorValor = lista.length ? lista[0].total : 0;

  limparEPreencher(container, lista.length
    ? lista.map((item, indice) => cardDesempenho(item, indice + 1, maiorValor))
    : [estadoVazio(`Nenhuma pendência de ${rotuloTipo[tipo].toLowerCase()} neste período.`, '🏆')]);
}

/* =========================================================
   RESET DO SISTEMA
========================================================= */

async function resetarSistema() {
  const FRASE = 'APAGAR TUDO';

  const valores = await Modal.formulario({
    titulo: '⚠️ Resetar sistema',
    avisoPerigo: `Isso apaga TODOS os gastos cadastrados (${cache.gastos.length} registros carregados). Um backup em JSON é salvo no servidor antes de apagar, mas a ação não pode ser desfeita pela tela.`,
    campos: [
      { nome: 'senha', label: 'Sua senha de admin', tipo: 'password', obrigatorio: true },
      { nome: 'confirmacao', label: `Digite "${FRASE}" para confirmar`, obrigatorio: true },
    ],
    textoConfirmar: 'Apagar tudo',
  });
  if (!valores) return;

  try {
    const resultado = await Api.del('/resetar-sistema', valores);
    Toast.sucesso(`Sistema resetado. Backup salvo em backups/${resultado.backup}.`);
    await recarregarGastosEResumo();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

/* =========================================================
   RELATÓRIOS PDF
========================================================= */

async function gerarRelatorioFinanceiroCompleto() {
  const [gastos, resumo] = await Promise.all([
    Api.get(`/admin/gastos${queryStringFiltro()}`),
    Api.get(`/admin/relatorios/resumo${queryStringFiltro()}`),
  ]);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });

  const rows = gastos.map((g) => [g.nome, g.tipo || 'Funcionário', g.empresa || 'Açaí no Grau', formatarMoeda(g.valor), g.descricao || '—', g.status.toUpperCase(), formatarData(g.data)]);

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
  Toast.sucesso('Relatório financeiro gerado.');
}

function gerarRelatorioPorTipo(tipo, tituloArquivo, tituloDoc) {
  return async () => {
    const resumo = await Api.get(`/admin/relatorios/resumo${queryStringFiltro()}`);
    const lista = tipo === 'funcionario' ? resumo.rankingFuncionarios : resumo.rankingEntregadores;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(tituloDoc, 14, 20);

    let y = 45;
    doc.setTextColor(0);
    doc.setFontSize(11);

    if (!lista.length) {
      doc.text(`Nenhuma pendência de ${rotuloTipo[tipo].toLowerCase()} neste período.`, 14, y);
    }

    lista.forEach((item) => {
      if (y > 270) { doc.addPage(); y = 20; }

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

    doc.save(tituloArquivo);
    Toast.sucesso('Relatório gerado.');
  };
}

const gerarRelatorioFuncionarios = gerarRelatorioPorTipo('funcionario', 'relatorio-funcionarios.pdf', 'RELATÓRIO DE FUNCIONÁRIOS');
const gerarRelatorioEntregadores = gerarRelatorioPorTipo('entregador', 'relatorio-entregadores.pdf', 'RELATÓRIO DE ENTREGADORES');

/* =========================================================
   PAINEL DO FUNCIONÁRIO / ENTREGADOR (login não-admin)
========================================================= */

async function carregarPainelFuncionario() {
  const container = document.getElementById('tabelaMeusGastos');
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'skeleton' }));
  container.appendChild(el('div', { class: 'skeleton' }));

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

  limparEPreencher(document.getElementById('kpiGridFuncionario'), [
    kpiCard({ icone: '🍧', tom: 'accent', rotulo: 'Total Açaí', valor: formatarMoeda(totalAcai) }),
    kpiCard({ icone: '🥪', tom: 'accent', rotulo: 'Total Subway', valor: formatarMoeda(totalSubway) }),
    kpiCard({ icone: '💰', tom: 'neutral', rotulo: 'Total geral pendente', valor: formatarMoeda(totalAcai + totalSubway + totalOutros) }),
  ]);

  const tabela = criarTabela({
    container,
    vazio: 'Você ainda não tem gastos registrados.',
    iconeVazio: '🗂️',
    colunas: [
      colunaTexto('empresa', 'Empresa', { classe: 'cell-strong' }),
      { chave: 'valor', titulo: 'Valor', sortavel: true, valorOrdenacao: (g) => Number(g.valor) || 0, render: (g) => el('td', { class: 'cell-num' }, formatarMoeda(g.valor)) },
      colunaTexto('descricao', 'Descrição', { sortavel: false }),
      colunaStatus('status'),
      { chave: 'data', titulo: 'Data', sortavel: true, valorOrdenacao: (g) => g.data, render: (g) => el('td', { class: 'cell-muted' }, formatarData(g.data)) },
    ],
  });
  tabela.setDados(dados);
}

/* =========================================================
   WHATSAPP (painel admin)
========================================================= */

const ROTULOS_STATUS_WHATSAPP = {
  conectado: { texto: 'Conectado', classe: 'pago' },
  aguardando_qr: { texto: 'Aguardando QR Code', classe: 'pendente' },
  conectando: { texto: 'Conectando...', classe: 'pendente' },
  desconectado: { texto: 'Desconectado', classe: 'pendente' },
};

async function atualizarStatusWhatsapp() {
  const status = await Api.get('/admin/whatsapp/status');
  renderizarStatusWhatsapp(status);
}

function renderizarStatusWhatsapp(status) {
  const badge = document.getElementById('whatsappStatusBadge');
  const info = ROTULOS_STATUS_WHATSAPP[status.status] || { texto: status.status, classe: 'pendente' };
  badge.className = `status-badge ${info.classe}`;
  badge.textContent = info.texto;

  const area = document.getElementById('whatsappQrArea');

  if (status.qrCodeDataUrl) {
    limparEPreencher(area, [el('div', {}, [
      el('p', { class: 'field-hint', text: 'Escaneie com o WhatsApp do número da loja (⋮ Aparelhos conectados → Conectar um aparelho):' }),
      el('img', {
        src: status.qrCodeDataUrl,
        style: 'width:220px; height:220px; border-radius:12px; margin-top:10px; border:1px solid var(--border); background:white; padding:8px',
      }),
    ])]);
    return;
  }

  if (status.ultimoErro) {
    limparEPreencher(area, [el('div', { class: 'insight-card tone-warning' }, [
      el('span', { class: 'insight-icon', text: '⚠️' }),
      el('div', { class: 'insight-text' }, [el('strong', { text: 'Aviso' }), el('span', { text: status.ultimoErro })]),
    ])]);
    return;
  }

  if (status.status === 'conectado') {
    limparEPreencher(area, [el('div', { class: 'insight-card tone-info' }, [
      el('span', { class: 'insight-icon', text: '✅' }),
      el('div', { class: 'insight-text' }, [el('strong', { text: 'Tudo certo' }), el('span', { text: `Grupo configurado: ${status.grupoConfigurado}` })]),
    ])]);
    return;
  }

  limparEPreencher(area, []);
}

async function reconectarWhatsapp() {
  try {
    await Api.post('/admin/whatsapp/reconectar');
    Toast.sucesso('Reconectando...');
    setTimeout(() => atualizarStatusWhatsapp().catch(() => {}), 2500);
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function novoLoginWhatsapp() {
  const ok = await Modal.confirmar({
    titulo: 'Gerar novo QR Code',
    mensagem: 'Isso encerra a sessão atual do WhatsApp e gera um novo QR Code — use se o número foi desconectado pelo celular e a reconexão automática não resolveu.',
    textoConfirmar: 'Gerar novo QR Code',
    perigo: true,
  });
  if (!ok) return;

  try {
    await Api.post('/admin/whatsapp/novo-login');
    Toast.sucesso('Gerando novo QR Code...');
    setTimeout(() => atualizarStatusWhatsapp().catch(() => {}), 2500);
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function dispararLembretes() {
  const ok = await Modal.confirmar({
    titulo: 'Disparar lembretes agora',
    mensagem: 'Envia o lembrete de débito pendente para todos os entregadores com telefone cadastrado, agora — fora do agendamento automático de quarta-feira.',
    textoConfirmar: 'Disparar lembretes',
  });
  if (!ok) return;

  try {
    const resultado = await Api.post('/admin/lembretes/executar');
    if (resultado.ignorados) {
      Toast.erro(resultado.motivo === 'whatsapp_desconectado' ? 'WhatsApp não está conectado no momento.' : 'Lembretes desabilitados.');
    } else {
      Toast.sucesso(`${resultado.enviados} lembrete(s) adicionado(s) à fila de envio.`);
    }
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

/* =========================================================
   COMPROVANTES (painel admin)
========================================================= */

let cacheComprovantesAdmin = [];

const tabelaComprovantesAdmin = criarTabela({
  container: document.getElementById('tabelaComprovantesAdmin'),
  vazio: 'Nenhum comprovante enviado ainda.',
  iconeVazio: '📎',
  colunas: [
    colunaTexto('entregador_nome', 'Entregador', { classe: 'cell-strong' }),
    colunaTexto('entregador_telefone', 'Telefone', { classe: 'cell-muted' }),
    {
      chave: 'valor_debito', titulo: 'Débito', sortavel: true,
      valorOrdenacao: (c) => Number(c.valor_debito) || 0,
      render: (c) => el('td', { class: 'cell-num' }, formatarMoeda(c.valor_debito)),
    },
    {
      chave: 'status', titulo: 'Status', sortavel: true,
      render: (c) => el('td', {}, el('span', { class: `status-badge ${rotuloStatusComprovante(c.status).classe}`, text: rotuloStatusComprovante(c.status).texto })),
    },
    {
      chave: 'confianca', titulo: 'Confiança IA', sortavel: true,
      valorOrdenacao: (c) => c.confianca || 0,
      render: (c) => el('td', { class: 'cell-muted' }, c.confianca != null ? `${Math.round(c.confianca * 100)}%` : '—'),
    },
    {
      chave: 'criado_em', titulo: 'Data', sortavel: true,
      valorOrdenacao: (c) => c.criado_em,
      render: (c) => el('td', { class: 'cell-muted' }, formatarData(c.criado_em)),
    },
    colunaAcoes((comprovante) => {
      const acoes = [
        { label: 'Visualizar comprovante', onClick: () => visualizarImagemComprovante(comprovante) },
        { label: 'Visualizar OCR', onClick: () => visualizarOcrComprovante(comprovante) },
        { label: 'Visualizar histórico do entregador', onClick: () => visualizarHistoricoEntregador(comprovante) },
      ];

      if (comprovante.status !== 'confirmado') {
        acoes.push({ label: 'Aprovar', onClick: () => aprovarComprovanteAdmin(comprovante) });
        acoes.push({ label: 'Rejeitar', perigo: true, onClick: () => rejeitarComprovanteAdmin(comprovante) });
        acoes.push({ label: 'Reprocessar OCR', onClick: () => reprocessarComprovanteAdmin(comprovante) });
      }

      acoes.push({ label: 'Solicitar novo comprovante', onClick: () => solicitarNovoComprovanteAdmin(comprovante) });
      acoes.push({ label: 'Enviar mensagem', onClick: () => enviarMensagemAdmin(comprovante) });

      return acoes;
    }),
  ],
});

async function carregarComprovantesAdmin() {
  const statusFiltro = document.getElementById('filtroStatusComprovante').value;
  const query = statusFiltro ? `?status=${encodeURIComponent(statusFiltro)}` : '';
  cacheComprovantesAdmin = await Api.get(`/admin/comprovantes${query}`);
  tabelaComprovantesAdmin.setDados(cacheComprovantesAdmin);
}

async function visualizarImagemComprovante(comprovante) {
  try {
    const resposta = await fetch(`/admin/comprovantes/${comprovante.id}/arquivo`, { headers: { authorization: token } });
    if (!resposta.ok) throw new Error('Não foi possível carregar o comprovante.');

    const blob = await resposta.blob();
    const url = URL.createObjectURL(blob);

    Modal.abrir(el('div', {}, [
      el('h3', { text: `Comprovante — ${comprovante.entregador_nome}` }),
      blob.type === 'application/pdf'
        ? el('p', { class: 'modal-subtitle', style: 'margin-top:10px', text: 'Este comprovante é um PDF — abra em uma nova aba para visualizar.' })
        : el('img', { src: url, style: 'width:100%; border-radius:12px; margin-top:14px' }),
      el('div', { class: 'modal-acoes' }, [
        el('a', { href: url, target: '_blank', class: 'btn btn-secondary', style: 'text-decoration:none; text-align:center; display:flex; align-items:center; justify-content:center', text: 'Abrir em nova aba' }),
        el('button', { class: 'btn btn-primary', onclick: () => Modal.fechar(), text: 'Fechar' }),
      ]),
    ]), { largo: true });
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

function rotuloChecagemOcr(chave) {
  const mapa = {
    cnpjBate: 'CNPJ confere',
    valorBate: 'Valor confere',
    dataRecente: 'Data recente',
    estruturaPix: 'Estrutura de comprovante PIX',
    temFavorecido: 'Nome do favorecido identificado',
    confiancaOcrSuficiente: 'Confiança de leitura suficiente',
  };
  return mapa[chave] || chave;
}

async function visualizarOcrComprovante(comprovante) {
  const detalhes = await Api.get(`/admin/comprovantes/${comprovante.id}`);
  const ultimo = detalhes.ocrHistorico[0];

  if (!ultimo) {
    Modal.abrir(el('div', {}, [
      el('h3', { text: 'Leitura automática (OCR)' }),
      el('p', { class: 'modal-subtitle', style: 'margin-top:10px', text: 'Nenhuma leitura registrada — provavelmente este comprovante é um PDF, que não passa por OCR automático.' }),
      el('div', { class: 'modal-acoes' }, [el('button', { class: 'btn btn-primary', onclick: () => Modal.fechar(), text: 'Fechar' })]),
    ]));
    return;
  }

  const checks = ultimo.validacoes || {};
  const linhasChecagem = Object.entries(checks).map(([chave, ok]) => el('div', { class: 'legend-item' }, [
    el('span', { class: 'legend-dot', style: `background:${ok ? 'var(--success)' : 'var(--danger)'}` }),
    el('span', { class: 'legend-label', text: rotuloChecagemOcr(chave) }),
    el('span', { class: 'legend-value', text: ok ? 'OK' : 'Falhou' }),
  ]));

  Modal.abrir(el('div', {}, [
    el('h3', { text: 'Leitura automática (OCR)' }),
    el('p', { class: 'modal-subtitle', text: `Confiança: ${ultimo.confianca != null ? Math.round(ultimo.confianca * 100) + '%' : '—'}` }),

    el('div', { class: 'form-section', style: 'margin-top:14px' }, [
      el('div', { class: 'form-section-title', text: 'Checagens automáticas' }),
      el('div', { style: 'display:flex; flex-direction:column; gap:6px; margin-top:8px' }, linhasChecagem),
    ]),

    el('div', { class: 'form-section', style: 'margin-top:14px' }, [
      el('div', { class: 'form-section-title', text: 'Campos extraídos' }),
      el('div', { class: 'field-hint', style: 'margin-top:6px', text: `Valor: ${ultimo.valor_extraido ?? '—'} · CNPJ: ${ultimo.cnpj_extraido ?? '—'} · Data: ${ultimo.data_extraida ?? '—'} · Favorecido: ${ultimo.nome_favorecido ?? '—'}` }),
    ]),

    el('div', { class: 'form-section', style: 'margin-top:14px' }, [
      el('div', { class: 'form-section-title', text: 'Texto completo lido' }),
      el('div', { class: 'field-hint', style: 'white-space:pre-wrap; margin-top:8px', text: ultimo.texto_completo || '(vazio)' }),
    ]),

    detalhes.ocrHistorico.length > 1
      ? el('p', { class: 'field-hint', style: 'margin-top:10px', text: `${detalhes.ocrHistorico.length} tentativas de leitura registradas (mostrando a mais recente).` })
      : null,

    el('div', { class: 'modal-acoes' }, [el('button', { class: 'btn btn-primary', onclick: () => Modal.fechar(), text: 'Fechar' })]),
  ]), { largo: true });
}

async function aprovarComprovanteAdmin(comprovante) {
  const ok = await Modal.confirmar({
    titulo: 'Aprovar comprovante',
    mensagem: `Confirmar pagamento de "${comprovante.entregador_nome}" no valor de ${formatarMoeda(comprovante.valor_debito)}? O débito dele será marcado como pago.`,
    textoConfirmar: 'Aprovar',
  });
  if (!ok) return;

  try {
    await Api.post(`/admin/comprovantes/${comprovante.id}/aprovar`);
    Toast.sucesso('Comprovante aprovado.');
    carregarComprovantesAdmin();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function rejeitarComprovanteAdmin(comprovante) {
  const valores = await Modal.formulario({
    titulo: 'Rejeitar comprovante',
    subtitulo: `${comprovante.entregador_nome} — ${formatarMoeda(comprovante.valor_debito)}`,
    campos: [{ nome: 'motivo', label: 'Motivo (opcional)', tipo: 'textarea' }],
    textoConfirmar: 'Rejeitar',
  });
  if (!valores) return;

  try {
    await Api.post(`/admin/comprovantes/${comprovante.id}/rejeitar`, valores);
    Toast.sucesso('Comprovante rejeitado.');
    carregarComprovantesAdmin();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function reprocessarComprovanteAdmin(comprovante) {
  try {
    const resultado = await Api.post(`/admin/comprovantes/${comprovante.id}/reprocessar`);
    Toast.sucesso(resultado.status === 'confirmado' ? 'Reprocessado: aprovado automaticamente.' : 'Reprocessado: segue em análise.');
    carregarComprovantesAdmin();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function solicitarNovoComprovanteAdmin(comprovante) {
  const ok = await Modal.confirmar({
    titulo: 'Solicitar novo comprovante',
    mensagem: `Enviar mensagem pelo WhatsApp para "${comprovante.entregador_nome}" pedindo um novo comprovante?`,
    textoConfirmar: 'Enviar solicitação',
  });
  if (!ok) return;

  try {
    await Api.post(`/admin/comprovantes/${comprovante.id}/solicitar-novo`);
    Toast.sucesso('Mensagem enviada.');
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function enviarMensagemAdmin(comprovante) {
  const valores = await Modal.formulario({
    titulo: `Mensagem para ${comprovante.entregador_nome}`,
    campos: [{ nome: 'texto', label: 'Mensagem', tipo: 'textarea', obrigatorio: true }],
    textoConfirmar: 'Enviar',
  });
  if (!valores) return;

  try {
    await Api.post(`/admin/entregadores/${comprovante.entregador_id}/mensagem`, valores);
    Toast.sucesso('Mensagem enviada.');
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

function visualizarHistoricoEntregador(comprovante) {
  const outros = cacheComprovantesAdmin.filter((c) => c.entregador_id === comprovante.entregador_id);

  const linhas = outros.map((c) => el('div', { class: 'activity-item' }, [
    el('div', { class: 'activity-icon', text: '📎' }),
    el('div', { class: 'activity-main' }, [
      el('div', { class: 'activity-title', text: formatarMoeda(c.valor_debito) }),
      el('div', { class: 'activity-meta', text: `${rotuloStatusComprovante(c.status).texto} — ${formatarData(c.criado_em)}` }),
    ]),
  ]));

  Modal.abrir(el('div', {}, [
    el('h3', { text: `Histórico de comprovantes — ${comprovante.entregador_nome}` }),
    el('div', { class: 'activity-list', style: 'margin-top:14px' }, linhas.length ? linhas : [estadoVazio('Nenhum outro comprovante encontrado.')]),
    el('div', { class: 'modal-acoes' }, [el('button', { class: 'btn btn-primary', onclick: () => Modal.fechar(), text: 'Fechar' })]),
  ]));
}

/* =========================================================
   LISTA DE ENVIO (cobrança de débito por WhatsApp)
   Mostra cada entregador com débito e o status do último envio, com
   ação individual (kebab) e em lote (checkbox + botão), no mesmo
   padrão de seleção já usado nas tabelas de débitos.
========================================================= */

let cacheListaEnvio = [];

const ROTULOS_ENVIO_WHATSAPP = {
  enviado: { texto: 'Enviado', classe: 'pago' },
  pendente: { texto: 'Na fila', classe: 'pendente' },
  falhou: { texto: 'Falhou', classe: 'pendente' },
};

function celulaUltimoEnvio(pessoa) {
  if (!pessoa.ultimo_envio_status) {
    return el('span', { class: 'cell-muted', text: 'Nunca enviado' });
  }

  const info = ROTULOS_ENVIO_WHATSAPP[pessoa.ultimo_envio_status] || { texto: pessoa.ultimo_envio_status, classe: 'pendente' };

  return el('div', {}, [
    el('span', { class: `status-badge ${info.classe}`, text: info.texto }),
    el('div', { class: 'cell-muted', style: 'margin-top:4px; font-size:var(--fs-xs)', text: formatarData(pessoa.ultimo_envio_em) }),
  ]);
}

const tabelaListaEnvio = criarTabela({
  container: document.getElementById('tabelaListaEnvio'),
  vazio: 'Nenhum entregador cadastrado ainda.',
  iconeVazio: '📲',
  colunas: [
    {
      chave: '_check', titulo: '', sortavel: false,
      render: (p) => el('td', {}, el('input', {
        type: 'checkbox', class: 'gasto-checkbox',
        checked: selecaoListaEnvio.includes(p.id) || undefined,
        onchange: () => toggleSelecionarListaEnvio(p.id),
      })),
    },
    colunaTexto('nome', 'Entregador', { classe: 'cell-strong' }),
    colunaTexto('telefone', 'Telefone', { classe: 'cell-muted' }),
    {
      chave: 'debito_pendente', titulo: 'Débito pendente', sortavel: true,
      valorOrdenacao: (p) => Number(p.debito_pendente) || 0,
      render: (p) => el('td', { class: 'cell-num' }, formatarMoeda(p.debito_pendente)),
    },
    {
      chave: 'ultimo_envio_em', titulo: 'Último envio', sortavel: true,
      valorOrdenacao: (p) => p.ultimo_envio_em || '',
      render: (p) => el('td', {}, celulaUltimoEnvio(p)),
    },
    colunaAcoes((p) => [
      {
        label: 'Enviar cobrança agora',
        onClick: () => enviarCobrancaIndividualUI(p),
      },
    ]),
  ],
});

async function carregarListaEnvio() {
  cacheListaEnvio = await Api.get('/admin/entregadores/lista-envio');
  tabelaListaEnvio.setDados(cacheListaEnvio);
  atualizarInterfaceSelecaoListaEnvio();
}

function toggleSelecionarListaEnvio(id) {
  const index = selecaoListaEnvio.indexOf(id);
  if (index > -1) selecaoListaEnvio.splice(index, 1);
  else selecaoListaEnvio.push(id);
  // Sem setDados/rerender aqui de propósito: o checkbox clicado já
  // reflete visualmente sozinho, e refazer a tabela descartaria a
  // busca ativa. Só o resumo (contador + "selecionar todos") precisa
  // atualizar.
  atualizarInterfaceSelecaoListaEnvio();
}

function toggleSelecionarTodosListaEnvio() {
  const marcado = document.getElementById('selecionarTodosListaEnvio').checked;
  // Respeita a busca ativa (ex: buscou "Matheus", marca só os dele) —
  // sem busca, o filtrado é a lista inteira. Soma aos já selecionados
  // em vez de sobrescrever, pra dar pra combinar buscas diferentes.
  const idsFiltrados = tabelaListaEnvio.obterFiltrados().map((p) => p.id);

  if (marcado) {
    const conjunto = new Set(selecaoListaEnvio);
    idsFiltrados.forEach((id) => conjunto.add(id));
    selecaoListaEnvio = [...conjunto];
  } else {
    const idsFiltradosSet = new Set(idsFiltrados);
    selecaoListaEnvio = selecaoListaEnvio.filter((id) => !idsFiltradosSet.has(id));
  }

  // rerender() (não setDados) de propósito: só atualiza os checkboxes
  // na tela, sem descartar a busca ativa.
  tabelaListaEnvio.rerender();
  atualizarInterfaceSelecaoListaEnvio();
}

function atualizarInterfaceSelecaoListaEnvio() {
  const contador = document.getElementById('contadorListaEnvio');
  const acoes = document.getElementById('acoesLoteListaEnvio');
  const selecionarTodos = document.getElementById('selecionarTodosListaEnvio');

  if (contador) contador.innerText = `${selecaoListaEnvio.length} selecionado(s)`;
  if (acoes) acoes.classList.toggle('hidden', selecaoListaEnvio.length === 0);

  const idsFiltrados = tabelaListaEnvio.obterFiltrados().map((p) => p.id);
  if (selecionarTodos) selecionarTodos.checked = idsFiltrados.length > 0 && idsFiltrados.every((id) => selecaoListaEnvio.includes(id));
}

async function enviarCobrancaIndividualUI(pessoa) {
  const ok = await Modal.confirmar({
    titulo: 'Enviar cobrança',
    mensagem: `Enviar cobrança de ${formatarMoeda(pessoa.debito_pendente)} pelo WhatsApp para "${pessoa.nome}" agora?`,
    textoConfirmar: 'Enviar cobrança',
  });
  if (!ok) return;

  try {
    await Api.post(`/admin/entregadores/${pessoa.id}/cobranca`);
    Toast.sucesso('Cobrança adicionada à fila de envio.');
    await carregarListaEnvio();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

async function enviarCobrancaLoteUI() {
  if (!selecaoListaEnvio.length) return;

  const ok = await Modal.confirmar({
    titulo: 'Enviar cobrança aos selecionados',
    mensagem: `Enviar cobrança pelo WhatsApp para ${selecaoListaEnvio.length} entregador(es) selecionado(s)? O envio é gradual, um de cada vez.`,
    textoConfirmar: 'Enviar cobranças',
  });
  if (!ok) return;

  try {
    const resultado = await Api.post('/admin/entregadores/cobranca-lote', { ids: selecaoListaEnvio });
    Toast.sucesso(`${resultado.enviados} cobrança(s) adicionada(s) à fila de envio.`);
    selecaoListaEnvio = [];
    await carregarListaEnvio();
  } catch (erro) {
    Toast.erro(erro.message);
  }
}

/* =========================================================
   FINANCEIRO DO ENTREGADOR (débito, pagamento PIX, comprovante)
========================================================= */

async function carregarFinanceiroEntregador() {
  const container = document.getElementById('tabelaHistoricoDebitos');
  const containerPagos = document.getElementById('tabelaHistoricoPagamentos');
  const containerComprovantes = document.getElementById('tabelaComprovantesEnviados');

  [container, containerPagos, containerComprovantes].forEach((c) => {
    c.innerHTML = '';
    c.appendChild(el('div', { class: 'skeleton' }));
  });

  const [resumo, comprovantes] = await Promise.all([
    Api.get('/entregador/financeiro/resumo'),
    Api.get('/entregador/comprovantes'),
  ]);

  cache.financeiroEntregador = resumo;

  const badge = document.getElementById('situacaoFinanceiraBadge');
  badge.className = `status-badge ${resumo.situacao === 'em_dia' ? 'pago' : 'pendente'}`;
  badge.textContent = resumo.situacao === 'em_dia' ? 'Em dia' : 'Pendente';

  limparEPreencher(document.getElementById('kpiGridEntregador'), [
    kpiCard({ icone: '⚠️', tom: resumo.debitoAtual > 0 ? 'danger' : 'success', rotulo: 'Débito atual', valor: formatarMoeda(resumo.debitoAtual) }),
    kpiCard({
      icone: '✅',
      tom: 'success',
      rotulo: 'Último pagamento',
      valor: resumo.ultimoPagamento ? formatarMoeda(resumo.ultimoPagamento.valor) : '—',
      descricao: resumo.ultimoPagamento ? formatarData(resumo.ultimoPagamento.data) : 'Nenhum pagamento ainda',
    }),
  ]);

  const colunasGasto = [
    colunaTexto('empresa', 'Empresa', { classe: 'cell-strong' }),
    { chave: 'valor', titulo: 'Valor', sortavel: true, valorOrdenacao: (g) => Number(g.valor) || 0, render: (g) => el('td', { class: 'cell-num' }, formatarMoeda(g.valor)) },
    colunaTexto('descricao', 'Descrição', { sortavel: false }),
    { chave: 'data', titulo: 'Data', sortavel: true, valorOrdenacao: (g) => g.data, render: (g) => el('td', { class: 'cell-muted' }, formatarData(g.data)) },
  ];

  criarTabela({ container, vazio: 'Nenhum débito pendente.', iconeVazio: '✅', colunas: colunasGasto }).setDados(resumo.historicoDebitos);
  criarTabela({ container: containerPagos, vazio: 'Nenhum pagamento ainda.', iconeVazio: '🗂️', colunas: colunasGasto }).setDados(resumo.historicoPagamentos);

  criarTabela({
    container: containerComprovantes,
    vazio: 'Você ainda não enviou nenhum comprovante.',
    iconeVazio: '📎',
    colunas: [
      { chave: 'valor_debito', titulo: 'Valor', sortavel: true, valorOrdenacao: (c) => Number(c.valor_debito) || 0, render: (c) => el('td', { class: 'cell-num' }, formatarMoeda(c.valor_debito)) },
      {
        chave: 'status', titulo: 'Status', sortavel: true,
        render: (c) => el('td', {}, el('span', { class: `status-badge ${rotuloStatusComprovante(c.status).classe}`, text: rotuloStatusComprovante(c.status).texto })),
      },
      { chave: 'criado_em', titulo: 'Enviado em', sortavel: true, valorOrdenacao: (c) => c.criado_em, render: (c) => el('td', { class: 'cell-muted' }, formatarData(c.criado_em)) },
    ],
  }).setDados(comprovantes);
}

function rotuloStatusComprovante(status) {
  const mapa = {
    confirmado: { texto: 'Confirmado', classe: 'pago' },
    em_analise: { texto: 'Em análise', classe: 'pendente' },
    pendente: { texto: 'Processando', classe: 'pendente' },
    rejeitado: { texto: 'Rejeitado', classe: 'pendente' },
  };
  return mapa[status] || { texto: status, classe: 'pendente' };
}

async function abrirModalPagamento() {
  const resumo = cache.financeiroEntregador || (await Api.get('/entregador/financeiro/resumo'));

  if (resumo.debitoAtual <= 0) {
    Toast.sucesso('Você não tem nenhum débito pendente no momento.');
    return;
  }

  const pix = await Api.get('/entregador/pix');
  renderizarEtapaPix(resumo, pix);
}

function renderizarEtapaPix(resumo, pix) {
  Modal.abrir(el('div', {}, [
    el('h3', { text: 'Pagar débito' }),
    el('p', { class: 'modal-subtitle', text: `Valor a pagar: ${formatarMoeda(resumo.debitoAtual)}` }),

    el('div', { class: 'form-section', style: 'margin-top:16px' }, [
      el('div', { class: 'form-section-title', text: `Chave PIX (${pix.tipoChave})` }),
      el('div', { style: 'display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap' }, [
        el('code', { style: 'flex:1; font-size:15px; font-weight:700; word-break:break-all; min-width:160px', text: pix.chave }),
        el('button', { class: 'btn btn-secondary btn-sm', style: 'width:auto; margin:0', onclick: () => copiarChavePix(pix.chave), text: 'Copiar Chave PIX' }),
      ]),
    ]),

    el('div', { class: 'modal-acoes' }, [
      el('button', { class: 'btn btn-secondary', onclick: () => Modal.fechar(), text: 'Fechar' }),
      el('button', { class: 'btn btn-primary', onclick: () => renderizarEtapaUpload(resumo, pix), text: 'Já Realizei o Pagamento' }),
    ]),
  ]));
}

function copiarChavePix(chave) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(chave).then(
      () => Toast.sucesso('Chave PIX copiada.'),
      () => Toast.erro('Não foi possível copiar automaticamente. Copie manualmente.')
    );
  } else {
    Toast.erro('Copie a chave manualmente — seu navegador não permite copiar automaticamente aqui.');
  }
}

const FORMATOS_COMPROVANTE_ACEITOS = '.jpg,.jpeg,.png,.webp,.pdf';

function renderizarEtapaUpload(resumo, pix) {
  let arquivoSelecionado = null;

  const inputArquivo = el('input', { type: 'file', accept: FORMATOS_COMPROVANTE_ACEITOS });
  const nomeArquivo = el('div', { class: 'field-hint', text: 'Nenhum arquivo selecionado.' });

  inputArquivo.addEventListener('change', () => {
    arquivoSelecionado = inputArquivo.files[0] || null;
    nomeArquivo.textContent = arquivoSelecionado ? arquivoSelecionado.name : 'Nenhum arquivo selecionado.';
  });

  const botaoEnviar = el('button', {
    class: 'btn btn-primary',
    text: 'Enviar Comprovante',
    onclick: async () => {
      if (!arquivoSelecionado) {
        Toast.erro('Selecione um arquivo antes de enviar.');
        return;
      }

      botaoEnviar.setAttribute('disabled', 'true');
      botaoEnviar.textContent = 'Enviando e validando...';

      try {
        const formData = new FormData();
        formData.append('comprovante', arquivoSelecionado);
        const resultado = await Api.upload('/entregador/comprovantes', formData);
        renderizarResultadoComprovante(resultado);
      } catch (erro) {
        Toast.erro(erro.message);
        botaoEnviar.removeAttribute('disabled');
        botaoEnviar.textContent = 'Enviar Comprovante';
      }
    },
  });

  Modal.abrir(el('div', {}, [
    el('h3', { text: 'Enviar comprovante' }),
    el('p', { class: 'modal-subtitle', text: 'Formatos aceitos: JPG, PNG, WEBP ou PDF (até 8 MB).' }),

    el('div', { class: 'form-group' }, [inputArquivo, nomeArquivo]),

    el('div', { class: 'modal-acoes' }, [
      el('button', { class: 'btn btn-secondary', onclick: () => renderizarEtapaPix(resumo, pix), text: 'Voltar' }),
      botaoEnviar,
    ]),
  ]));
}

function renderizarResultadoComprovante(resultado) {
  const info = resultado.status === 'confirmado'
    ? { icone: '✅', titulo: 'Pagamento confirmado!', texto: 'Seu débito foi quitado automaticamente. Obrigado!' }
    : { icone: '⏳', titulo: 'Comprovante em análise', texto: 'Recebemos seu comprovante e ele será revisado por um administrador em breve.' };

  Modal.abrir(el('div', {}, [
    el('h3', { text: `${info.icone} ${info.titulo}` }),
    el('p', { class: 'modal-subtitle', style: 'margin-top:8px', text: info.texto }),
    el('div', { class: 'modal-acoes' }, [
      el('button', {
        class: 'btn btn-primary',
        text: 'Fechar',
        onclick: () => {
          Modal.fechar();
          carregarFinanceiroEntregador();
        },
      }),
    ]),
  ]));
}

/* =========================================================
   VISUAL
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

/* =========================================================
   BOOT
========================================================= */

Modal.init();
