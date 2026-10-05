/**
 * SmartCash — patrimonio.js
 * Tela 4: Patrimônio
 * -----------------------------------------------
 * Gerencia:
 *  - Reserva Financeira (histórico mensal)
 *  - Investimentos com juros compostos
 *  - Projeções de patrimônio em 6m, 1a, 2a, 5a
 *
 * Fórmula usada:
 *   VF = VP × (1+i)^n  +  PMT × [((1+i)^n − 1) / i]
 */

'use strict';

// ============================================================
// RENDER PRINCIPAL
// ============================================================

/**
 * Renderiza a tela de Patrimônio completa.
 */
async function renderPatrimonio() {
  try {
    const [reservas, investimentos] = await Promise.all([
      dbGetAll('reservas'),
      dbGetAll('investimentos')
    ]);

    // ── Totais ───────────────────────────────────────────────

    // Soma de todas as reservas históricas
    const totalGuardado = reservas.reduce((s, r) => s + (r.valorGuardado || 0), 0);

    // Valor investido atual: saldo inicial + aportes acumulados (sem juros = patrimônio investido)
    const totalAportado = investimentos.reduce((s, inv) => {
      // Saldo inicial + aportes mensais × 12 (estimativa conservadora)
      return s + (inv.saldoInicial || 0) + (inv.aporteMensal || 0) * 12;
    }, 0);

    // Valor futuro projetado em 12 meses (com juros)
    const totalInvestido12m = investimentos.reduce((s, inv) => {
      return s + calcValorFuturoComAportes(
        inv.saldoInicial        || 0,
        inv.aporteMensal        || 0,
        inv.rentabilidadeMensal || 0,
        12
      );
    }, 0);

    // Patrimônio total = reservas + investimentos projetados 12m
    const patriTotal = totalGuardado + totalInvestido12m;

    // ── Atualiza Cards ───────────────────────────────────────

    setElP('patriGuardado', formatCurrency(totalGuardado));
    setElP('patriInvestido', formatCurrency(totalInvestido12m));
    setElP('patriTotal',    formatCurrency(patriTotal));

    // ── Sub-seções ───────────────────────────────────────────

    renderTabelaReservas(reservas);
    renderTabelaInvestimentos(investimentos);
    renderProjecoes(investimentos, totalGuardado);

    // ── Forms ────────────────────────────────────────────────

    setupFormReserva();
    setupFormInvestimento();

  } catch (err) {
    console.error('[Patrimônio] Erro:', err);
    showToast('Erro ao carregar patrimônio.', 'error');
  }
}

// ============================================================
// RESERVAS — TABELA
// ============================================================

/**
 * Preenche a tabela de reservas financeiras.
 * @param {Array} reservas
 */
function renderTabelaReservas(reservas) {
  const tbody = document.getElementById('reservasTableBody');
  if (!tbody) return;

  if (reservas.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="table-empty">Nenhuma reserva registrada ainda.</td></tr>';
    return;
  }

  // Ordena por mês decrescente (mais recente primeiro)
  const ordenadas = [...reservas].sort((a, b) =>
    b.mesReferencia.localeCompare(a.mesReferencia)
  );

  // Calcula acumulado
  let acumulado = 0;
  const comAcum = [...reservas]
    .sort((a, b) => a.mesReferencia.localeCompare(b.mesReferencia))
    .map(r => { acumulado += r.valorGuardado; return { ...r, acumulado }; });

  const mapaAcum = {};
  comAcum.forEach(r => { mapaAcum[r.id] = r.acumulado; });

  tbody.innerHTML = '';
  ordenadas.forEach(r => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatMonth(r.mesReferencia)}</td>
      <td>
        <div class="cell-main">${formatCurrency(r.valorGuardado)}</div>
        <div class="cell-sub">Acumulado: ${formatCurrency(mapaAcum[r.id] || r.valorGuardado)}</div>
      </td>
      <td class="actions-cell">
        <button class="btn-icon" title="Editar" onclick="editarReserva(${r.id})">✏️</button>
        <button class="btn-icon btn-danger" title="Excluir" onclick="excluirReserva(${r.id})">🗑️</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ============================================================
// INVESTIMENTOS — TABELA
// ============================================================

/**
 * Preenche a tabela de investimentos com projeção de 12 meses.
 * @param {Array} investimentos
 */
function renderTabelaInvestimentos(investimentos) {
  const tbody = document.getElementById('investimentosTableBody');
  if (!tbody) return;

  if (investimentos.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="table-empty">Nenhum investimento cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = '';

  investimentos.forEach(inv => {
    const vf12       = calcValorFuturoComAportes(
      inv.saldoInicial        || 0,
      inv.aporteMensal        || 0,
      inv.rentabilidadeMensal || 0,
      12
    );
    const totalInvestido = (inv.saldoInicial || 0) + (inv.aporteMensal || 0) * 12;
    const lucro12m = vf12 - totalInvestido;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <div class="cell-main">${escapeHtml(inv.nome)}</div>
      </td>
      <td>${formatCurrency(inv.saldoInicial)}</td>
      <td>${formatCurrency(inv.aporteMensal)}<small>/mês</small></td>
      <td>
        <span class="badge badge-green">${Number(inv.rentabilidadeMensal || 0).toFixed(2)}% a.m.</span>
      </td>
      <td>
        <div class="cell-main text-success">${formatCurrency(vf12)}</div>
        <div class="cell-sub text-success">+${formatCurrency(lucro12m)} de rendimento</div>
      </td>
      <td class="actions-cell">
        <button class="btn-icon" title="Editar" onclick="editarInvestimento(${inv.id})">✏️</button>
        <button class="btn-icon btn-danger" title="Excluir" onclick="excluirInvestimento(${inv.id})">🗑️</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ============================================================
// PROJEÇÕES DE PATRIMÔNIO
// ============================================================

/**
 * Renderiza os cards de projeção de patrimônio futuros.
 * @param {Array}  investimentos
 * @param {number} totalGuardado  Reservas acumuladas (não crescem com juros)
 */
function renderProjecoes(investimentos, totalGuardado) {
  const el = document.getElementById('projecoes');
  if (!el) return;

  if (investimentos.length === 0 && totalGuardado === 0) {
    el.innerHTML =
      '<div class="table-empty" style="grid-column:1/-1">Adicione investimentos ou reservas para ver projeções.</div>';
    return;
  }

  const periodos = [
    { label: '6 meses',  meses: 6  },
    { label: '1 ano',    meses: 12 },
    { label: '2 anos',   meses: 24 },
    { label: '5 anos',   meses: 60 }
  ];

  let html = '';

  periodos.forEach(p => {
    // Investimentos projetados com juros compostos + aportes
    const totalProjetado = investimentos.reduce((s, inv) => {
      return s + calcValorFuturoComAportes(
        inv.saldoInicial        || 0,
        inv.aporteMensal        || 0,
        inv.rentabilidadeMensal || 0,
        p.meses
      );
    }, 0);

    // Reservas = valor atual (não cresce — poupança sem rendimento)
    const patriTotal = totalProjetado + totalGuardado;

    // Aportes totais realizados no período
    const aportesTotais = investimentos.reduce((s, inv) => {
      return s + (inv.saldoInicial || 0) + (inv.aporteMensal || 0) * p.meses;
    }, 0) + totalGuardado;

    const rendimento = patriTotal - aportesTotais;

    html += `
      <div class="projection-card">
        <div class="proj-label">${p.label}</div>
        <div class="proj-value">${formatCurrency(patriTotal)}</div>
        <div class="proj-sub">
          <span>📈 Invest: ${formatCurrency(totalProjetado)}</span>
          <span>🏦 Reserva: ${formatCurrency(totalGuardado)}</span>
          <span class="text-success">💰 Rendimento: +${formatCurrency(Math.max(0, rendimento))}</span>
        </div>
      </div>
    `;
  });

  el.innerHTML = html;
}

// ============================================================
// RESERVAS — FORMULÁRIO
// ============================================================

function setupFormReserva() {
  const btnNova  = document.getElementById('btnNovaReserva');
  const btnSalvar = document.getElementById('btnSalvarReserva');

  if (btnNova && !btnNova._scListener) {
    btnNova.addEventListener('click', () => abrirFormReserva());
    btnNova._scListener = true;
  }
  if (btnSalvar && !btnSalvar._scListener) {
    btnSalvar.addEventListener('click', salvarReserva);
    btnSalvar._scListener = true;
  }
}

function abrirFormReserva(reserva = null) {
  setValP('reservaId',    reserva?.id  != null ? String(reserva.id) : '');
  setValP('reservaMes',   reserva?.mesReferencia || getCurrentMonth());
  setValP('reservaValor', reserva?.valorGuardado != null ? String(reserva.valorGuardado) : '');
  openModal('modalReserva');
}

async function editarReserva(id) {
  const r = await dbGet('reservas', id);
  if (r) abrirFormReserva(r);
}

async function salvarReserva() {
  const id            = document.getElementById('reservaId')?.value;
  const mesReferencia = document.getElementById('reservaMes')?.value || '';
  const valorGuardado = parseFloat(document.getElementById('reservaValor')?.value) || 0;

  if (!valorGuardado || valorGuardado <= 0) {
    setElP('errReservaValor', 'Informe um valor maior que zero.');
    return;
  }
  setElP('errReservaValor', '');

  const reserva = { mesReferencia, valorGuardado };
  if (id) reserva.id = parseInt(id, 10);

  try {
    await dbPut('reservas', reserva);
    closeModal('modalReserva');
    await renderPatrimonio();
    await renderDashboard();
    showToast(id ? 'Reserva atualizada!' : 'Reserva registrada! 💪');
  } catch (err) {
    showToast('Erro ao salvar reserva.', 'error');
  }
}

function excluirReserva(id) {
  showConfirm('Excluir este registro de reserva?', async () => {
    try {
      await dbDelete('reservas', id);
      await renderPatrimonio();
      await renderDashboard();
      showToast('Reserva excluída.');
    } catch (err) {
      showToast('Erro ao excluir.', 'error');
    }
  });
}

// ============================================================
// INVESTIMENTOS — FORMULÁRIO
// ============================================================

function setupFormInvestimento() {
  const btnNovo  = document.getElementById('btnNovoInvestimento');
  const btnSalvar = document.getElementById('btnSalvarInvestimento');

  if (btnNovo && !btnNovo._scListener) {
    btnNovo.addEventListener('click', () => abrirFormInvestimento());
    btnNovo._scListener = true;
  }
  if (btnSalvar && !btnSalvar._scListener) {
    btnSalvar.addEventListener('click', salvarInvestimento);
    btnSalvar._scListener = true;
  }
}

function abrirFormInvestimento(inv = null) {
  setElP('modalInvestTitulo', inv ? 'Editar Investimento' : 'Novo Investimento');
  setValP('investId',           inv?.id != null ? String(inv.id) : '');
  setValP('investNome',         inv?.nome || '');
  setValP('investSaldoInicial', inv?.saldoInicial        != null ? String(inv.saldoInicial)        : '');
  setValP('investAporte',       inv?.aporteMensal        != null ? String(inv.aporteMensal)        : '');
  setValP('investRentab',       inv?.rentabilidadeMensal != null ? String(inv.rentabilidadeMensal) : '');
  openModal('modalInvestimento');
}

async function editarInvestimento(id) {
  const inv = await dbGet('investimentos', id);
  if (inv) abrirFormInvestimento(inv);
}

async function salvarInvestimento() {
  const id                = document.getElementById('investId')?.value;
  const nome              = (document.getElementById('investNome')?.value || '').trim();
  const saldoInicial      = parseFloat(document.getElementById('investSaldoInicial')?.value) || 0;
  const aporteMensal      = parseFloat(document.getElementById('investAporte')?.value)        || 0;
  const rentabilidadeMensal = parseFloat(document.getElementById('investRentab')?.value)      || 0;

  if (!nome) {
    setElP('errInvestNome', 'Nome é obrigatório.');
    return;
  }
  setElP('errInvestNome', '');

  const inv = { nome, saldoInicial, aporteMensal, rentabilidadeMensal };
  if (id) inv.id = parseInt(id, 10);

  try {
    await dbPut('investimentos', inv);
    closeModal('modalInvestimento');
    await renderPatrimonio();
    showToast(id ? 'Investimento atualizado!' : 'Investimento adicionado! 📈');
  } catch (err) {
    showToast('Erro ao salvar investimento.', 'error');
  }
}

function excluirInvestimento(id) {
  showConfirm('Excluir este investimento?', async () => {
    try {
      await dbDelete('investimentos', id);
      await renderPatrimonio();
      showToast('Investimento excluído.');
    } catch (err) {
      showToast('Erro ao excluir.', 'error');
    }
  });
}

// ============================================================
// UTILIDADES LOCAIS
// ============================================================

function setElP(id, text)  { const el = document.getElementById(id); if (el) el.textContent = text; }
function setValP(id, val)  { const el = document.getElementById(id); if (el) el.value = val; }

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
