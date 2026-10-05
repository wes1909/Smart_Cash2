/**
 * SmartCash — planejamento.js
 * Tela 5: Planejamento Semanal
 * -----------------------------------------------
 * O limite semanal é definido manualmente pelo usuário
 * (não é mais calculado automaticamente a partir da renda).
 *
 * Controla lançamentos de gastos diários por semana
 * e exibe alertas quando o limite é ultrapassado.
 */

'use strict';

// ============================================================
// RENDER PRINCIPAL
// ============================================================

/**
 * Renderiza a tela de Planejamento Semanal.
 */
async function renderPlanejamento() {
  try {
    const mes    = getCurrentMonth();
    const config = AppState.config;

    // Carrega dados em paralelo
    const [pagamentos, reservas, gastos, ganhos] = await Promise.all([
      dbGetPagamentosPorMes(mes),
      dbGetAll('reservas'),
      dbGetGastosPorMes(mes),
      dbGetGanhosPorMes(mes)
    ]);

    // ── Cálculo informativo do saldo do mês ──────────────────
    // (o limite semanal em si é definido manualmente pelo usuário,
    //  não é mais calculado a partir da renda)

    const totalGanhos   = ganhos.reduce((s, g) => s + (g.valor || 0), 0);
    const totalPago      = pagamentos.reduce((s, p) => s + (p.valorPago || 0), 0);
    const reservasMes    = reservas.filter(r => r.mesReferencia === mes);
    const totalGuardado  = reservasMes.reduce((s, r) => s + (r.valorGuardado || 0), 0);
    const saldoParaGastos = totalGanhos - totalPago - totalGuardado;

    // Limite semanal manual, definido pelo usuário nas Configurações desta tela
    const limiteSemanal = config.limiteSemanal || 0;
    const NUM_SEMANAS   = 4;

    // ── Agrupa gastos por semana ─────────────────────────────

    const gastosPorSemana = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    gastos.forEach(g => {
      const sem = parseInt(g.semana, 10) || getWeekOfMonth(g.data);
      if (sem >= 1 && sem <= 5) gastosPorSemana[sem] += (g.valor || 0);
    });

    // ── Render ───────────────────────────────────────────────

    setValPl('planLimiteSemanal', limiteSemanal ? String(limiteSemanal) : '');
    setElPl('planSaldoInfo', `Saldo do mês (ganhos − contas pagas − guardado): ${formatCurrency(saldoParaGastos)}`);

    renderSemanasTable(limiteSemanal, gastosPorSemana, NUM_SEMANAS, saldoParaGastos);
    renderGastosTable(gastos);
    atualizarResumoGastos(gastos);

    // Setup de eventos
    setupFormGasto();
    setupFiltroSemana();
    setupLimiteSemanal();

  } catch (err) {
    console.error('[Planejamento] Erro:', err);
    showToast('Erro ao carregar planejamento.', 'error');
  }
}

// ============================================================
// LIMITE SEMANAL MANUAL
// ============================================================

/**
 * Configura o botão que salva o limite semanal definido pelo usuário.
 */
function setupLimiteSemanal() {
  const btn = document.getElementById('btnSalvarLimiteSemanal');
  if (btn && !btn._scListener) {
    btn.addEventListener('click', salvarLimiteSemanal);
    btn._scListener = true;
  }
}

/**
 * Salva o limite semanal manual informado pelo usuário.
 */
async function salvarLimiteSemanal() {
  const valor = parseFloat(document.getElementById('planLimiteSemanal')?.value) || 0;

  if (valor <= 0) {
    showToast('Informe um limite semanal maior que zero.', 'error');
    return;
  }

  AppState.config.limiteSemanal = valor;

  try {
    await saveConfig();
    showToast('Limite semanal salvo! ✅');
    await renderPlanejamento();
  } catch (err) {
    console.error('[Planejamento] Erro ao salvar limite semanal:', err);
    showToast('Erro ao salvar limite semanal.', 'error');
  }
}

// ============================================================
// TABELA DE SEMANAS
// ============================================================

/**
 * Renderiza a tabela de controle por semana.
 */
function renderSemanasTable(limiteSemanal, gastosPorSemana, numSemanas, saldoTotal) {
  const tbody = document.getElementById('semanasTableBody');
  if (!tbody) return;

  if (limiteSemanal <= 0) {
    tbody.innerHTML = `
      <tr><td colspan="5" class="table-empty">
        Defina quanto você quer gastar por semana no campo acima para ver o planejamento semanal.
      </td></tr>
    `;
    return;
  }

  tbody.innerHTML = '';

  let totalGastoGeral = 0;

  for (let sem = 1; sem <= numSemanas; sem++) {
    const gasto  = gastosPorSemana[sem] || 0;
    const saldo  = limiteSemanal - gasto;
    const over   = gasto > limiteSemanal;
    totalGastoGeral += gasto;

    const barWidth = limiteSemanal > 0
      ? Math.min((gasto / limiteSemanal) * 100, 100)
      : 0;
    const barColor = over ? 'var(--danger)' : gasto > limiteSemanal * 0.8 ? 'var(--warning)' : 'var(--success)';

    const situacao = over
      ? `<span class="badge badge-red">⚠️ Estourado</span>`
      : gasto > limiteSemanal * 0.8
        ? `<span class="badge badge-yellow">⚡ Atenção</span>`
        : gasto > 0
          ? `<span class="badge badge-green">✅ OK</span>`
          : `<span class="badge badge-gray">—</span>`;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <div class="cell-main">Semana ${sem}</div>
        <div class="cell-sub">Dias ${(sem - 1) * 7 + 1}–${Math.min(sem * 7, 31)}</div>
      </td>
      <td>${formatCurrency(limiteSemanal)}</td>
      <td>
        <div class="${over ? 'text-danger fw-bold' : ''}">${formatCurrency(gasto)}</div>
        <div style="height:4px;background:var(--border-color);border-radius:2px;margin-top:5px;width:80px">
          <div style="height:4px;background:${barColor};border-radius:2px;width:${barWidth}%"></div>
        </div>
      </td>
      <td class="${saldo < 0 ? 'text-danger fw-bold' : 'text-success'}">${formatCurrency(saldo)}</td>
      <td>${situacao}</td>
    `;
    tbody.appendChild(row);
  }

  // Linha de total
  const saldoTotal2 = limiteSemanal * numSemanas - totalGastoGeral;
  const totalRow = document.createElement('tr');
  totalRow.className = 'table-total';
  totalRow.innerHTML = `
    <td><strong>Total do Mês</strong></td>
    <td><strong>${formatCurrency(limiteSemanal * numSemanas)}</strong></td>
    <td class="${totalGastoGeral > limiteSemanal * numSemanas ? 'text-danger' : ''}">
      <strong>${formatCurrency(totalGastoGeral)}</strong>
    </td>
    <td class="${saldoTotal2 < 0 ? 'text-danger' : 'text-success'}">
      <strong>${formatCurrency(saldoTotal2)}</strong>
    </td>
    <td></td>
  `;
  tbody.appendChild(totalRow);
}

// ============================================================
// TABELA DE GASTOS
// ============================================================

/**
 * Renderiza a tabela de lançamentos (com filtro de semana).
 * @param {Array} gastos  Gastos do mês atual
 */
function renderGastosTable(gastos) {
  const filterSem = document.getElementById('filterSemana')?.value || '';
  const tbody     = document.getElementById('gastosTableBody');
  if (!tbody) return;

  let filtrados = [...gastos];
  if (filterSem) {
    filtrados = filtrados.filter(g => String(g.semana) === filterSem);
  }

  // Ordena por data decrescente
  filtrados.sort((a, b) => b.data.localeCompare(a.data));

  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhum gasto lançado.</td></tr>';
    return;
  }

  tbody.innerHTML = '';

  filtrados.forEach(g => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatDate(g.data)}</td>
      <td>
        <div class="cell-main">${sanitize(g.descricao)}</div>
      </td>
      <td><span class="badge badge-blue">${sanitize(g.categoria)}</span></td>
      <td>Sem. ${g.semana}</td>
      <td class="text-danger fw-bold">${formatCurrency(g.valor)}</td>
      <td class="actions-cell">
        <button class="btn-icon" title="Editar" onclick="editarGasto(${g.id})">✏️</button>
        <button class="btn-icon btn-danger" title="Excluir" onclick="excluirGasto(${g.id})">🗑️</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Atualiza o rodapé com total de gastos e quantidade.
 * @param {Array} gastos
 */
function atualizarResumoGastos(gastos) {
  const el = document.getElementById('gastosResumo');
  if (!el) return;
  const total = gastos.reduce((s, g) => s + (g.valor || 0), 0);
  el.textContent = `${gastos.length} lançamento(s) — Total: ${formatCurrency(total)}`;
}

// ============================================================
// FILTRO DE SEMANA
// ============================================================

function setupFiltroSemana() {
  const el = document.getElementById('filterSemana');
  if (el && !el._scListener) {
    el.addEventListener('change', async () => {
      const gastos = await dbGetGastosPorMes(getCurrentMonth());
      renderGastosTable(gastos);
    });
    el._scListener = true;
  }
}

// ============================================================
// FORMULÁRIO DE GASTO
// ============================================================

/**
 * Configura eventos do formulário de gasto (uma única vez).
 */
function setupFormGasto() {
  const btnNovo  = document.getElementById('btnNovoGasto');
  const btnSalvar = document.getElementById('btnSalvarGasto');

  if (btnNovo && !btnNovo._scListener) {
    btnNovo.addEventListener('click', () => abrirFormGasto());
    btnNovo._scListener = true;
  }
  if (btnSalvar && !btnSalvar._scListener) {
    btnSalvar.addEventListener('click', salvarGasto);
    btnSalvar._scListener = true;
  }
}

/**
 * Abre o modal de lançamento de gasto.
 * @param {Object|null} gasto  Se fornecido, abre em modo edição
 */
function abrirFormGasto(gasto = null) {
  const hoje = new Date().toISOString().split('T')[0];

  setElPl('modalGastoTitulo', gasto ? 'Editar Gasto' : 'Lançar Gasto');
  setValPl('gastoId',          gasto?.id != null ? String(gasto.id) : '');
  setValPl('gastoData',        gasto?.data      || hoje);
  setValPl('gastoDescricao',   gasto?.descricao || '');
  setValPl('gastoCategoria',   gasto?.categoria || 'Mercado');
  setValPl('gastoSemana',      gasto?.semana    || String(getWeekOfMonth(hoje)));
  setValPl('gastoValor',       gasto?.valor     != null ? String(gasto.valor) : '');

  openModal('modalGasto');

  // Auto-calcula semana ao mudar a data
  const dataInput  = document.getElementById('gastoData');
  const semSelect  = document.getElementById('gastoSemana');
  if (dataInput && semSelect && !dataInput._weekListener) {
    dataInput.addEventListener('change', e => {
      semSelect.value = String(getWeekOfMonth(e.target.value));
    });
    dataInput._weekListener = true;
  }
}

/**
 * Carrega gasto do banco e abre o formulário de edição.
 * @param {number} id
 */
async function editarGasto(id) {
  try {
    const g = await dbGet('gastos', id);
    if (g) abrirFormGasto(g);
  } catch (err) {
    showToast('Erro ao carregar gasto.', 'error');
  }
}

/**
 * Salva um gasto (insert ou update) após validação.
 */
async function salvarGasto() {
  const id        = document.getElementById('gastoId')?.value;
  const data      = document.getElementById('gastoData')?.value || '';
  const descricao = (document.getElementById('gastoDescricao')?.value || '').trim();
  const categoria = document.getElementById('gastoCategoria')?.value || 'Outros';
  const semana    = parseInt(document.getElementById('gastoSemana')?.value, 10)  || 1;
  const valor     = parseFloat(document.getElementById('gastoValor')?.value) || 0;

  // Validação
  let ok = true;

  if (!descricao) {
    setElPl('errGastoDescricao', 'Descrição é obrigatória.');
    ok = false;
  } else setElPl('errGastoDescricao', '');

  if (!valor || valor <= 0) {
    setElPl('errGastoValor', 'Valor deve ser maior que zero.');
    ok = false;
  } else setElPl('errGastoValor', '');

  if (!ok) return;

  const gasto = { data, descricao, categoria, semana, valor };
  if (id) gasto.id = parseInt(id, 10);

  try {
    await dbPut('gastos', gasto);
    closeModal('modalGasto');
    await renderPlanejamento();
    await renderDashboard();
    showToast(id ? 'Gasto atualizado!' : 'Gasto lançado com sucesso!');
  } catch (err) {
    console.error('[Planejamento] Erro ao salvar gasto:', err);
    showToast('Erro ao salvar gasto.', 'error');
  }
}

/**
 * Exclui um gasto após confirmação.
 * @param {number} id
 */
function excluirGasto(id) {
  showConfirm('Excluir este lançamento?', async () => {
    try {
      await dbDelete('gastos', id);
      await renderPlanejamento();
      await renderDashboard();
      showToast('Gasto excluído.');
    } catch (err) {
      showToast('Erro ao excluir gasto.', 'error');
    }
  });
}

// ============================================================
// UTILIDADES LOCAIS
// ============================================================

function setElPl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setValPl(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

function sanitize(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
