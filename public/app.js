/* =========================================================
   LOGIN
========================================================= */

let token = localStorage.getItem('token');
let role = localStorage.getItem('role');
let nomeUsuario = localStorage.getItem('nomeUsuario');

/* =========================================================
   SELEÇÃO EM LOTE
========================================================= */

let gastosSelecionados = [];

if (token && role) {
  iniciarPainel();
}

async function login() {

  const usuario = document.getElementById('usuario').value;
  const senha = document.getElementById('senha').value;

  const res = await fetch('/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ usuario, senha })
  });

  const data = await res.json();

  if (!res.ok) {
    document.getElementById('erro').innerText = data.error;
    return;
  }

  token = data.token;
  role = data.role;

  localStorage.setItem('token', token);
  localStorage.setItem('role', role);

  nomeUsuario =
    data.nome ||
    data.usuario ||
    usuario;

  localStorage.setItem(
    'nomeUsuario',
    nomeUsuario
  );

  iniciarPainel();
}

function iniciarPainel() {

  document.getElementById('loginBox').classList.add('hidden');

  const mensagem =
    `Bem-vindo ${nomeUsuario || ''} ao seu controle de gastos.`;

  const boasVindasAdmin =
    document.getElementById('boasVindasAdmin');

  const boasVindasFuncionario =
    document.getElementById('boasVindasFuncionario');

  if (boasVindasAdmin) {
    boasVindasAdmin.innerText = mensagem;
  }

  if (boasVindasFuncionario) {
    boasVindasFuncionario.innerText = mensagem;
  }

  if (role === 'admin') {

    document.getElementById('adminPanel').classList.remove('hidden');

    carregarFuncionarios();
    carregarEntregadores();
    carregarGastos();

  } else {

    document.getElementById('funcionarioPanel').classList.remove('hidden');

    carregarMeusGastos();
    carregarMeuTotal();
  }
}

/* =========================================================
   RESET SISTEMA
========================================================= */

async function resetarSistema() {

  const senha1 = prompt(
    'DIGITE A SENHA DE RESET:'
  );

  if (senha1 !== 'blackout') {

    alert('Senha incorreta.');
    return;
  }

  const senha2 = prompt(
    'CONFIRME NOVAMENTE A SENHA:'
  );

  if (senha2 !== 'blackout') {

    alert('Segunda confirmação incorreta.');
    return;
  }

  const confirmar = confirm(
    '⚠️ ATENÇÃO ⚠️\n\nTODOS OS GASTOS DO ANO SERÃO APAGADOS.\n\nESSA AÇÃO NÃO PODE SER DESFEITA.'
  );

  if (!confirmar) return;

  try {

    const res = await fetch('/resetar-sistema', {
      method: 'DELETE',
      headers: {
        authorization: token
      }
    });

    const data = await res.json();

    if (!res.ok) {

      alert(data.error || 'Erro ao resetar sistema');
      return;
    }

    gastosSelecionados = [];

    carregarGastos();

    alert(
      '✅ Sistema resetado com sucesso.'
    );

  } catch (error) {

    console.error(error);

    alert(
      'Erro ao resetar sistema.'
    );
  }
}

/* =========================================================
   FUNCIONÁRIOS
========================================================= */

async function cadastrarFuncionario() {

  const nome = document.getElementById('nomeFuncionario').value;
  const usuario = document.getElementById('usuarioFuncionario').value;
  const senha = document.getElementById('senhaFuncionario').value;

  const res = await fetch('/funcionarios', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: token
    },
    body: JSON.stringify({ nome, usuario, senha })
  });

  const data = await res.json();

  if (data.success) {

    alert('Funcionário cadastrado');

    document.getElementById('nomeFuncionario').value = '';
    document.getElementById('usuarioFuncionario').value = '';
    document.getElementById('senhaFuncionario').value = '';

    carregarFuncionarios();

  } else {

    alert(data.error);
  }
}

async function editarFuncionario(id, nomeAtual, usuarioAtual) {

  const novoNome = prompt('Novo nome:', nomeAtual);
  if (novoNome === null) return;

  const novoUsuario = prompt('Novo usuário:', usuarioAtual);
  if (novoUsuario === null) return;

  const novaSenha = prompt('Nova senha:');

  const res = await fetch(`/funcionarios/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      authorization: token
    },
    body: JSON.stringify({
      nome: novoNome,
      usuario: novoUsuario,
      senha: novaSenha
    })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'Erro ao editar funcionário');
    return;
  }

  alert('Funcionário atualizado');
  carregarFuncionarios();
}

async function excluirFuncionario(id) {

  if (!confirm('Deseja excluir este funcionário?')) return;

  const res = await fetch(`/funcionarios/${id}`, {
    method: 'DELETE',
    headers: { authorization: token }
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error);
    return;
  }

  carregarFuncionarios();
}

async function carregarFuncionarios() {

  const res = await fetch('/funcionarios', {
    headers: { authorization: token }
  });

  const data = await res.json();

  const lista = document.getElementById('listaFuncionarios');
  const select = document.getElementById('funcionarioSelect');

  if (lista) lista.innerHTML = '';
  if (select) select.innerHTML = '';

  data.forEach(funcionario => {

    if (lista) {

      lista.innerHTML += `
        <li>
          ${funcionario.nome} - @${funcionario.usuario}

          <div class="acoes-botoes">

            <button onclick="editarFuncionario(
              ${funcionario.id},
              '${funcionario.nome}',
              '${funcionario.usuario}'
            )">
              Editar
            </button>

            <button onclick="excluirFuncionario(${funcionario.id})">
              Excluir
            </button>

          </div>
        </li>
      `;
    }

    if (select) {

      select.innerHTML += `
        <option value="${funcionario.id}">
          Funcionário - ${funcionario.nome}
        </option>
      `;
    }
  });

  const totalFunc = document.getElementById('totalFuncionarios');

  if (totalFunc) {
    totalFunc.innerText = data.length;
  }
}

/* =========================================================
   ENTREGADORES
========================================================= */

async function cadastrarEntregador() {

  const nome = document.getElementById('nomeEntregador').value;
  const usuario = document.getElementById('usuarioEntregador').value;
  const senha = document.getElementById('senhaEntregador').value;

  const res = await fetch('/entregadores', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: token
    },
    body: JSON.stringify({ nome, usuario, senha })
  });

  const data = await res.json();

  if (data.success) {

    alert('Entregador cadastrado');

    document.getElementById('nomeEntregador').value = '';
    document.getElementById('usuarioEntregador').value = '';
    document.getElementById('senhaEntregador').value = '';

    carregarEntregadores();

  } else {

    alert(data.error);
  }
}

async function editarEntregador(id, nomeAtual, usuarioAtual) {

  const novoNome = prompt('Novo nome:', nomeAtual);
  if (novoNome === null) return;

  const novoUsuario = prompt('Novo usuário:', usuarioAtual);
  if (novoUsuario === null) return;

  const novaSenha = prompt('Nova senha:');

  const res = await fetch(`/entregadores/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      authorization: token
    },
    body: JSON.stringify({
      nome: novoNome,
      usuario: novoUsuario,
      senha: novaSenha
    })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'Erro ao editar entregador');
    return;
  }

  alert('Entregador atualizado');
  carregarEntregadores();
}

async function excluirEntregador(id) {

  if (!confirm('Deseja excluir este entregador?')) return;

  const res = await fetch(`/entregadores/${id}`, {
    method: 'DELETE',
    headers: { authorization: token }
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error);
    return;
  }

  carregarEntregadores();
}

async function carregarEntregadores() {

  const res = await fetch('/entregadores', {
    headers: { authorization: token }
  });

  const data = await res.json();

  const lista = document.getElementById('listaEntregadores');
  const select = document.getElementById('funcionarioSelect');

  if (lista) lista.innerHTML = '';

  data.forEach(entregador => {

    if (lista) {

      lista.innerHTML += `
        <li>
          ${entregador.nome} - @${entregador.usuario}

          <div class="acoes-botoes">

            <button onclick="editarEntregador(
              ${entregador.id},
              '${entregador.nome}',
              '${entregador.usuario}'
            )">
              Editar
            </button>

            <button onclick="excluirEntregador(${entregador.id})">
              Excluir
            </button>

          </div>
        </li>
      `;
    }

    if (select) {

      select.innerHTML += `
        <option value="entregador-${entregador.id}">
          Entregador - ${entregador.nome}
        </option>
      `;
    }
  });
}

/* =========================================================
   GASTOS
========================================================= */

/* RESTANTE DO SEU app.js CONTINUA IGUAL DAQUI PARA BAIXO */

async function adicionarGasto() {

  const selecionado =
    document.getElementById('funcionarioSelect').value;

  let funcionario_id = null;
  let entregador_id = null;

  if (selecionado.includes('entregador-')) {

    entregador_id =
      selecionado.replace('entregador-', '');

  } else {

    funcionario_id = selecionado;
  }

  const valor =
    document.getElementById('valorGasto').value;

  const descricao =
    document.getElementById('descricaoGasto').value;

  const empresa =
    document.getElementById('empresaGasto').value;

  const res = await fetch('/gastos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: token
    },
    body: JSON.stringify({
      funcionario_id,
      entregador_id,
      valor,
      descricao,
      empresa
    })
  });

  const data = await res.json();

  if (data.success) {

    alert('Gasto adicionado');

    document.getElementById('valorGasto').value = '';
    document.getElementById('descricaoGasto').value = '';

    carregarGastos();

  } else {

    alert(data.error || 'Erro ao adicionar gasto');
  }
}

async function editarGasto(id, valorAtual, descricaoAtual) {

  const novoValor = prompt('Novo valor:', valorAtual);
  if (!novoValor) return;

  const novaDescricao = prompt('Nova descrição:', descricaoAtual);
  if (!novaDescricao) return;

  await fetch(`/gastos/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      authorization: token
    },
    body: JSON.stringify({
      valor: novoValor,
      descricao: novaDescricao
    })
  });

  carregarGastos();
}

async function marcarPago(id) {

  await fetch(`/gastos/${id}/pago`, {
    method: 'PUT',
    headers: { authorization: token }
  });

  carregarGastos();
}

async function removerGasto(id) {

  if (!confirm('Deseja excluir este gasto?')) return;

  await fetch(`/gastos/${id}`, {
    method: 'DELETE',
    headers: { authorization: token }
  });

  carregarGastos();
}

/* =========================================================
   SELEÇÃO
========================================================= */

function toggleSelecionarGasto(id) {

  const index = gastosSelecionados.indexOf(id);

  if (index > -1) {

    gastosSelecionados.splice(index, 1);

  } else {

    gastosSelecionados.push(id);
  }

  atualizarInterfaceSelecao();
}

function atualizarInterfaceSelecao() {

  const contador =
    document.getElementById('contadorSelecionados');

  const acoes =
    document.getElementById('acoesLote');

  const selecionarTodos =
    document.getElementById('selecionarTodos');

  if (contador) {

    contador.innerText =
      `${gastosSelecionados.length} selecionado(s)`;
  }

  if (acoes) {

    if (gastosSelecionados.length > 0) {

      acoes.classList.remove('hidden');

    } else {

      acoes.classList.add('hidden');
    }
  }

  const checkboxes =
    document.querySelectorAll('.gasto-checkbox');

  if (selecionarTodos) {

    selecionarTodos.checked =
      checkboxes.length > 0 &&
      gastosSelecionados.length === checkboxes.length;
  }

  document.querySelectorAll('.gasto-item')
    .forEach(item => {

      const id =
        Number(item.getAttribute('data-id'));

      if (gastosSelecionados.includes(id)) {

        item.classList.add('gasto-selecionado');

      } else {

        item.classList.remove('gasto-selecionado');
      }
    });
}

function toggleSelecionarTodos() {

  const checkboxes =
    document.querySelectorAll('.gasto-checkbox');

  const selecionarTodos =
    document.getElementById('selecionarTodos');

  if (selecionarTodos.checked) {

    gastosSelecionados = [];

    checkboxes.forEach(checkbox => {

      checkbox.checked = true;

      gastosSelecionados.push(
        Number(checkbox.value)
      );
    });

  } else {

    checkboxes.forEach(checkbox => {
      checkbox.checked = false;
    });

    gastosSelecionados = [];
  }

  atualizarInterfaceSelecao();
}

/* =========================================================
   AÇÕES EM LOTE
========================================================= */

async function marcarSelecionadosComoPagos() {

  if (gastosSelecionados.length === 0) {
    return;
  }

  if (
    !confirm(
      `Deseja marcar ${gastosSelecionados.length} gasto(s) como pagos?`
    )
  ) {
    return;
  }

  for (const id of gastosSelecionados) {

    await fetch(`/gastos/${id}/pago`, {
      method: 'PUT',
      headers: {
        authorization: token
      }
    });
  }

  gastosSelecionados = [];

  carregarGastos();

  alert('Gastos marcados como pagos');
}

async function excluirSelecionados() {

  if (gastosSelecionados.length === 0) {
    return;
  }

  if (
    !confirm(
      `Deseja excluir ${gastosSelecionados.length} gasto(s)?`
    )
  ) {
    return;
  }

  for (const id of gastosSelecionados) {

    await fetch(`/gastos/${id}`, {
      method: 'DELETE',
      headers: {
        authorization: token
      }
    });
  }

  gastosSelecionados = [];

  carregarGastos();

  alert('Gastos excluídos');
}

/* =========================================================
   CARREGAR GASTOS
========================================================= */

async function carregarGastos() {

  gastosSelecionados = [];

  const res = await fetch('/admin/gastos', {
    headers: { authorization: token }
  });

  const data = await res.json();

  const lista = document.getElementById('listaGastos');

  if (lista) lista.innerHTML = '';

  let totalPendente = 0;
  let totalPago = 0;

  const rankingFuncionarios = {};
  const rankingEntregadores = {};

  data.forEach(gasto => {

    const dataTexto =
      gasto.data.split(' ')[0];

    const partes =
      dataTexto.split('-');

    const mesGasto =
      parseInt(partes[1]);

    if (
      mesAtualFiltro !== 0 &&
      mesGasto !== mesAtualFiltro
    ) {
      return;
    }

    const valor = Number(gasto.valor) || 0;

    if (gasto.status === 'pendente') {

      totalPendente += valor;

      const empresa =
        (gasto.empresa || '')
        .toLowerCase()
        .trim();

      if (gasto.tipo === 'Entregador') {

        if (!rankingEntregadores[gasto.nome]) {

          rankingEntregadores[gasto.nome] = {
            acai: 0,
            subway: 0,
            total: 0
          };
        }

        if (
          empresa.includes('açaí') ||
          empresa.includes('acai')
        ) {

          rankingEntregadores[gasto.nome].acai += valor;

        } else if (
          empresa.includes('subway')
        ) {

          rankingEntregadores[gasto.nome].subway += valor;
        }

        rankingEntregadores[gasto.nome].total += valor;

      } else {

        if (!rankingFuncionarios[gasto.nome]) {

          rankingFuncionarios[gasto.nome] = {
            acai: 0,
            subway: 0,
            total: 0
          };
        }

        if (
          empresa.includes('açaí') ||
          empresa.includes('acai')
        ) {

          rankingFuncionarios[gasto.nome].acai += valor;

        } else if (
          empresa.includes('subway')
        ) {

          rankingFuncionarios[gasto.nome].subway += valor;
        }

        rankingFuncionarios[gasto.nome].total += valor;
      }

    } else {

      totalPago += valor;
    }

    if (lista) {

      lista.innerHTML += `
        <li
          class="gasto-item"
          data-id="${gasto.id}"
          data-nome="${gasto.nome.toLowerCase()}"
        >

          <div class="gasto-checkbox-area">

            <input
              type="checkbox"
              class="gasto-checkbox"
              value="${gasto.id}"
              onchange="toggleSelecionarGasto(${gasto.id})"
            >

            <div class="gasto-conteudo">

              <div class="gasto-topo">

                <div>

                  <strong>${gasto.nome}</strong>

                  <div class="gasto-info">
                    ${gasto.tipo || 'Funcionário'} • ${gasto.empresa || 'Açaí no Grau'}
                  </div>

                </div>

                <span class="status ${gasto.status}">
                  ${gasto.status}
                </span>

              </div>

              <div class="gasto-valor">
                R$ ${valor.toFixed(2)}
              </div>

              <div class="gasto-descricao">
                ${gasto.descricao}
              </div>

              <div class="gasto-data">
                ${gasto.data.split(' ')[0].split('-').reverse().join('/')}
              </div>

              <div class="gasto-acoes">

                ${
                  gasto.status === 'pendente'
                  ? `
                    <button class="action-btn" onclick="marcarPago(${gasto.id})">
                      Marcar Pago
                    </button>
                  `
                  : ''
                }

                <button
                  class="action-btn"
                  onclick="editarGasto(${gasto.id}, ${gasto.valor}, '${gasto.descricao}')"
                >
                  Editar
                </button>

                <button
                  class="action-btn"
                  onclick="removerGasto(${gasto.id})"
                >
                  Excluir
                </button>

              </div>

            </div>

          </div>

        </li>
      `;
    }
  });

  atualizarInterfaceSelecao();

  const totalGeral = document.getElementById('totalGeral');

  if (totalGeral) {
    totalGeral.innerText =
      `R$ ${totalPendente.toFixed(2)}`;
  }

  const totalPagoEl = document.getElementById('totalPago');

  if (totalPagoEl) {
    totalPagoEl.innerText =
      `R$ ${totalPago.toFixed(2)}`;
  }

  const listaRanking =
    document.getElementById('ranking');

  if (listaRanking) {

    listaRanking.innerHTML = '';

    Object.entries(rankingFuncionarios)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([nome, dados]) => {

        listaRanking.innerHTML += `

          <div class="ranking-entregador-card">

            <div class="ranking-entregador-topo">

              <div class="ranking-entregador-nome">
                ${nome}
              </div>

              <div class="ranking-entregador-total">
                Total: R$ ${dados.total.toFixed(2)}
              </div>

            </div>

            <div class="ranking-entregador-empresas">

              <div class="empresa-divida acai">

                <span class="empresa-titulo">
                  🍧 Açaí no Grau
                </span>

                <span class="empresa-valor">
                  R$ ${dados.acai.toFixed(2)}
                </span>

              </div>

              <div class="empresa-divida subway">

                <span class="empresa-titulo">
                  🥪 Subway
                </span>

                <span class="empresa-valor">
                  R$ ${dados.subway.toFixed(2)}
                </span>

              </div>

            </div>

          </div>
        `;
      });
  }

  const listaRankingEntregadores =
    document.getElementById('rankingEntregadores');

  if (listaRankingEntregadores) {

    listaRankingEntregadores.innerHTML = '';

    Object.entries(rankingEntregadores)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([nome, dados]) => {

        listaRankingEntregadores.innerHTML += `

          <div class="ranking-entregador-card">

            <div class="ranking-entregador-topo">

              <div class="ranking-entregador-nome">
                ${nome}
              </div>

              <div class="ranking-entregador-total">
                Total: R$ ${dados.total.toFixed(2)}
              </div>

            </div>

            <div class="ranking-entregador-empresas">

              <div class="empresa-divida acai">

                <span class="empresa-titulo">
                  🍧 Açaí no Grau
                </span>

                <span class="empresa-valor">
                  R$ ${dados.acai.toFixed(2)}
                </span>

              </div>

              <div class="empresa-divida subway">

                <span class="empresa-titulo">
                  🥪 Subway
                </span>

                <span class="empresa-valor">
                  R$ ${dados.subway.toFixed(2)}
                </span>

              </div>

            </div>

          </div>
        `;
      });
  }
}

function filtrarGastos() {

  const texto =
    document.getElementById('buscarGasto')
    .value
    .toLowerCase();

  const gastos =
    document.querySelectorAll('.gasto-item');

  gastos.forEach(gasto => {

    const nome =
      gasto.getAttribute('data-nome');

    if (nome.includes(texto)) {

      gasto.style.display = 'flex';

    } else {

      gasto.style.display = 'none';
    }
  });
}

/* =========================================================
   PDF - MENU PRINCIPAL
========================================================= */

async function gerarPDF() {

  const opcao = prompt(
    "Escolha o tipo de relatório:\n\n1 - Financeiro completo (atual)\n2 - Resumo de funcionários"
  );

  if (opcao === "1") {
    return gerarRelatorioFinanceiroCompleto();
  }

  if (opcao === "2") {
    return gerarRelatorioFuncionarios();
  }

  alert("Opção inválida");
}


/* =========================================================
   PDF - RELATÓRIO FINANCEIRO COMPLETO
========================================================= */

async function gerarRelatorioFinanceiroCompleto() {

  const res = await fetch('/admin/gastos', {
    headers: {
      authorization: token
    }
  });

  const data = await res.json();

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: 'landscape'
  });

  const rows = [];

  let totalPendente = 0;
  let totalPago = 0;

  let totalAcai = 0;
  let totalSubway = 0;
  let totalOutros = 0;

  data.forEach(g => {

    const dataTexto = g.data.split(' ')[0];
    const partes = dataTexto.split('-');
    const mesGasto = parseInt(partes[1]);

    if (mesAtualFiltro !== 0 && mesGasto !== mesAtualFiltro) {
      return;
    }

    const valor = Number(g.valor) || 0;

    if (g.status === 'pendente') {
      totalPendente += valor;
    } else {
      totalPago += valor;
    }

    const empresa = (g.empresa || '').toLowerCase();

    if (empresa.includes('açaí')) {
      totalAcai += valor;
    } 
    else if (empresa.includes('subway')) {
      totalSubway += valor;
    } 
    else {
      totalOutros += valor;
    }

    rows.push([
      g.nome,
      g.tipo || 'Funcionário',
      g.empresa || 'Açaí no Grau',
      `R$ ${valor.toFixed(2)}`,
      g.descricao,
      g.status.toUpperCase(),
      g.data.split(' ')[0].split('-').reverse().join('/')
    ]);

  });

  /* HEADER */
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 300, 35, 'F');

  doc.setTextColor(255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('RELATÓRIO FINANCEIRO', 14, 22);

  doc.setFontSize(10);
  doc.text(
    `Gerado em: ${new Date().toLocaleDateString('pt-BR')}`,
    220,
    22
  );

  /* CARDS */
  doc.setFillColor(239, 68, 68);
  doc.roundedRect(14, 45, 80, 28, 4, 4, 'F');
  doc.setTextColor(255);
  doc.setFontSize(12);
  doc.text('TOTAL PENDENTE', 20, 57);
  doc.setFontSize(18);
  doc.text(`R$ ${totalPendente.toFixed(2)}`, 20, 67);

  doc.setFillColor(34, 197, 94);
  doc.roundedRect(105, 45, 80, 28, 4, 4, 'F');
  doc.setFontSize(12);
  doc.text('TOTAL PAGO', 112, 57);
  doc.setFontSize(18);
  doc.text(`R$ ${totalPago.toFixed(2)}`, 112, 67);

  doc.setFillColor(59, 130, 246);
  doc.roundedRect(196, 45, 80, 28, 4, 4, 'F');
  doc.setFontSize(12);
  doc.text('TOTAL GERAL', 203, 57);
  doc.setFontSize(18);
  doc.text(
    `R$ ${(totalPago + totalPendente).toFixed(2)}`,
    203,
    67
  );

  /* RESUMO POR EMPRESA */
  doc.setTextColor(30);
  doc.setFontSize(12);
  doc.text('RESUMO POR EMPRESA', 14, 85);

  doc.setFontSize(11);
  doc.text(`Açaí no Grau: R$ ${totalAcai.toFixed(2)}`, 14, 92);
  doc.text(`Subway: R$ ${totalSubway.toFixed(2)}`, 14, 99);
  doc.text(`Outros: R$ ${totalOutros.toFixed(2)}`, 14, 106);

  /* TABELA */
  doc.autoTable({

    startY: 115,

    head: [[
      'Nome',
      'Tipo',
      'Empresa',
      'Valor',
      'Descrição',
      'Status',
      'Data'
    ]],

    body: rows,

    theme: 'grid',

    styles: {
      fontSize: 10,
      cellPadding: 4
    },

    headStyles: {
      fillColor: [15, 23, 42],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center'
    },

    columnStyles: {
      3: { halign: 'right' },
      5: { halign: 'center' },
      6: { halign: 'center' }
    },

    didParseCell: function (data) {

      if (data.section === 'body' && data.column.index === 5) {

        if (data.cell.raw === 'PENDENTE') {
          data.cell.styles.textColor = [220, 38, 38];
        } else {
          data.cell.styles.textColor = [22, 163, 74];
        }
      }
    }
  });

  /* FOOTER */
  const paginas = doc.internal.getNumberOfPages();

  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${paginas}`, 250, 200);
    doc.text('Sistema Financeiro • Açaí no Grau', 14, 200);
  }

  doc.save('relatorio-financeiro.pdf');
}


/* =========================================================
   RELATÓRIO - FUNCIONÁRIOS (SEM ENTREGADORES)
========================================================= */

async function gerarRelatorioFuncionarios() {

  const res = await fetch('/admin/gastos', {
    headers: { authorization: token }
  });

  const data = await res.json();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const funcionarios = {};

  data.forEach(g => {

    if (g.tipo !== 'Funcionário') return;
if (g.status !== 'pendente') return;

    const nome = g.nome || 'Sem nome';
    const valor = Number(g.valor) || 0;

    const empresa = (g.empresa || '').toLowerCase();

    if (!funcionarios[nome]) {
      funcionarios[nome] = {
        acai: 0,
        subway: 0,
        total: 0
      };
    }

    if (empresa.includes('açaí') || empresa.includes('acai')) {
      funcionarios[nome].acai += valor;
    } 
    else if (empresa.includes('subway')) {
      funcionarios[nome].subway += valor;
    }

    funcionarios[nome].total += valor;
  });

  /* HEADER */
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 30, 'F');

  doc.setTextColor(255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text('RELATÓRIO DE FUNCIONÁRIOS', 14, 20);

  let y = 45;

  doc.setTextColor(0);
  doc.setFontSize(11);

  Object.entries(funcionarios)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([nome, dados]) => {

      if (y > 270) {
        doc.addPage();
        y = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.text(nome, 14, y);

      y += 6;
      doc.setFont("helvetica", "normal");
      doc.text(`Açaí: R$ ${dados.acai.toFixed(2)}`, 20, y);

      y += 6;
      doc.text(`Subway: R$ ${dados.subway.toFixed(2)}`, 20, y);

      y += 6;
      doc.setFont("helvetica", "bold");
      doc.text(`Total: R$ ${dados.total.toFixed(2)}`, 20, y);

      y += 12;
    });

  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(
    `Gerado em: ${new Date().toLocaleDateString('pt-BR')}`,
    14,
    285
  );

  doc.save('relatorio-funcionarios.pdf');
}
/* =========================================================
   FUNCIONÁRIO
========================================================= */

async function carregarMeusGastos() {

  const res = await fetch('/meus-gastos', {
    headers: { authorization: token }
  });

  const data = await res.json();

  const lista = document.getElementById('meusGastos');

  if (lista) lista.innerHTML = '';

  data.forEach(gasto => {

    if (lista) {

      lista.innerHTML += `
        <li>

          <div class="gasto-topo">

            <strong>
              ${gasto.empresa || 'Açaí no Grau'}
            </strong>

            <span class="status ${gasto.status}">
              ${gasto.status}
            </span>

          </div>

          <div class="gasto-valor">
            R$ ${Number(gasto.valor).toFixed(2)}
          </div>

          <div class="gasto-descricao">
            ${gasto.descricao}
          </div>

          <div class="gasto-data">
            ${gasto.data.split(' ')[0].split('-').reverse().join('/')}
          </div>

        </li>
      `;
    }
  });
}

/* =========================================================
   TOTAL FUNCIONÁRIO
========================================================= */

async function carregarMeuTotal() {

  const res = await fetch('/meus-gastos', {
    headers: {
      authorization: token
    }
  });

  const data = await res.json();

  let totalAcai = 0;
  let totalSubway = 0;

  data.forEach(gasto => {

    if (gasto.status !== 'pendente') return;

    const valor = Number(gasto.valor) || 0;

    const empresa =
      (gasto.empresa || '')
      .toLowerCase()
      .trim();

    if (
      empresa.includes('açaí') ||
      empresa.includes('acai')
    ) {

      totalAcai += valor;

    } else if (
      empresa.includes('subway')
    ) {

      totalSubway += valor;
    }
  });

  const totalGeral =
    totalAcai + totalSubway;

  const totalAcaiEl =
    document.getElementById('totalAcai');

  if (totalAcaiEl) {

    totalAcaiEl.innerText =
      `R$ ${totalAcai.toFixed(2)}`;
  }

  const totalSubwayEl =
    document.getElementById('totalSubway');

  if (totalSubwayEl) {

    totalSubwayEl.innerText =
      `R$ ${totalSubway.toFixed(2)}`;
  }

  const totalGeralEl =
    document.getElementById('meuTotal');

  if (totalGeralEl) {

    totalGeralEl.innerText =
      `R$ ${totalGeral.toFixed(2)}`;
  }
}
/* =========================================================
   FILTRO POR MÊS
========================================================= */

let mesAtualFiltro = 0;

function filtrarMes(mes, event) {

  mesAtualFiltro = mes;

  document
    .querySelectorAll('.mes-btn')
    .forEach(btn => {
      btn.classList.remove('active');
    });

  if (event && event.target) {
    event.target.classList.add('active');
  }

  carregarGastos();
}

/* =========================================================
   LOGOUT
========================================================= */
/* =========================================================
   TROCAR LOGO
========================================================= */

let logoAtual = 'acai';

function trocarLogo() {

  const logo =
    document.getElementById('logoEmpresa');

  const titulo =
    document.querySelector('.logo-topo span');

  if (logoAtual === 'acai') {

    logo.src = 'subway.png';

    titulo.innerText = 'Subway';

    logoAtual = 'subway';

  } else {

    logo.src = 'logo.png';

    titulo.innerText =
      'Açaí no Grau ';

    logoAtual = 'acai';
  }
}
function logout() {
  localStorage.clear();
  location.reload();
}
function trocarSecaoAdmin(secaoId, botaoClicado){

  document
    .querySelectorAll('.admin-section')
    .forEach(secao => {
      secao.classList.remove('active-section');
    });

  const secao = document.getElementById(secaoId);

  if(secao){
    secao.classList.add('active-section');
  }

  document
    .querySelectorAll('.nav-btn')
    .forEach(btn => {
      btn.classList.remove('active');
    });

  if(botaoClicado){
    botaoClicado.classList.add('active');
  }
}