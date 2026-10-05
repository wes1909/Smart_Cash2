/**
 * SmartCash — dividas.js
 * Tela 3: Dívidas
 * -----------------------------------------------
 * Gerencia dívidas com:
 *  - Ranking automático de prioridade (maior crescimento futuro)
 *  - Cálculo de Valor Futuro: VF = VP × (1 + i)^n
 *  - Simulação por 1, 3, 6 e 12 meses
 *  - Recomendação automática de qual quitar primeiro
 */

'use strict';

// ============================================================
// RENDER PRINCIPAL
// ============================================================

/**
 * Renderiza a tela de Dívidas completa.
 */
async function renderDividas() {
  try {
    const dividas = await dbGetAll('dividas');

    // Calcula crescimento em 12 meses e ordena por prioridade
    const dividasComProjecao = dividas
      .map(d => {
        const vf12      = calcValorFuturo(d.saldoAtual || 0, d.jurosMensal || 0, 12);
        const crescimento = vf12 - (d.saldoAtual || 0);
        const pctCrescimento = d.saldoAtual > 0
          ? ((crescimento / d.saldoAtual) * 100)
          : 0;
        return { ...d, vf12, crescimento, pctCrescimento };
      })
      .sort((a, b) => b.crescimento - a.crescimento); // Maior crescimento = maior prioridade

    // Tabela
    renderTabelaDividas(dividasComProjecao);

    // Caixa de recomendação
    renderRecomendacao(dividasComProjecao);

    // Setup de eventos
    setupFormDivida();
    setupSimulador();

  } catch (err) {
    console.error('[Dívidas] Erro ao renderizar:', err);
    showToast('Erro ao carregar dívidas.', 'error');
  }
}

// ============================================================
// TABELA DE DÍVIDAS
// ============================================================

/**
 * Preenche o tbody da tabela de dívidas com ranking e projeções.
 * @param {Array} dividas  Lista já ordenada por prioridade
 */
function renderTabelaDividas(dividas) {
  const tbody = document.getElementById('dividasTableBody');
  if (!tbody) return;

  if (dividas.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="table-empty">🎉 Nenhuma dívida cadastrada. Parabéns!</td></tr>';
    return;
  }

  tbody.innerHTML = '';

  dividas.forEach((d, idx) => {
    const prioridade = idx + 1;

    // Badge de prioridade
    const priorityClass = prioridade === 1
      ? 'badge-red'
      : prioridade === 2
        ? 'badge-yellow'
        : 'badge-green';

    const priorLabel = prioridade === 1
      ? '🔴 1º — Urgente'
      : prioridade === 2
        ? '🟡 2º — Importante'
        : `🟢 ${prioridade}º`;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span class="badge ${priorityClass}">${priorLabel}</span></td>
      <td>
        <div class="cell-main">${escHtml(d.nome)}</div>
      </td>
      <td class="text-danger fw-bold">${formatCurrency(d.saldoAtual)}</td>
      <td>
        <span class="badge badge-red">${formatNum(d.jurosMensal, 2)}% a.m.</span>
      </td>
      <td>${d.parcelaMinima > 0 ? formatCurrency(d.parcelaMinima) : '—'}</td>
      <td>
        <div class="cell-main text-danger">${formatCurrency(d.vf12)}</div>
        <div class="cell-sub">em 12 meses</div>
      </td>
      <td>
        <span class="text-danger fw-bold">+${formatCurrency(d.crescimento)}</span>
        <div class="cell-sub text-danger">+${formatNum(d.pctCrescimento, 1)}%</div>
      </td>
      <td class="actions-cell">
        <button class="btn-icon" title="Editar" onclick="editarDivida(${d.id})">✏️</button>
        <button class="btn-icon btn-danger" title="Quitar/Excluir" onclick="excluirDivida(${d.id})">🗑️</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ============================================================
// RECOMENDAÇÃO AUTOMÁTICA
// ============================================================

/**
 * Gera a caixa de recomendação com análise da dívida mais crítica.
 * @param {Array} dividas  Lista ordenada por prioridade
 */
function renderRecomendacao(dividas) {
  const el = document.getElementById('recomendacaoDivida');
  if (!el) return;

  if (dividas.length === 0) {
    el.innerHTML = '';
    return;
  }

  const top     = dividas[0];
  const pct     = formatNum(top.pctCrescimento, 1);
  const juros12 = calcValorFuturo(top.saldoAtual, top.jurosMensal, 12) - top.saldoAtual;

  el.innerHTML = `
    <div class="recommendation">
      <span class="rec-icon">⚠️</span>
      <div class="rec-content">
        <strong>Prioridade #1 de quitação: ${escHtml(top.nome)}</strong>
        <p>
          Com juros de <strong>${formatNum(top.jurosMensal, 2)}% ao mês</strong>,
          mantendo o saldo atual de <strong>${formatCurrency(top.saldoAtual)}</strong> sem pagar,
          em <strong>12 meses</strong> esta dívida crescerá para
          <strong class="text-danger">${formatCurrency(top.vf12)}</strong>
          — um aumento de <strong class="text-danger">+${formatCurrency(juros12)}</strong> (+${pct}%).
          ${dividas.length > 1
            ? ` Após quitar, foque na: <strong>${escHtml(dividas[1].nome)}</strong>.`
            : ''}
        </p>
      </div>
    </div>
  `;
}

// ============================================================
// FORMULÁRIO DE DÍVIDA
// ============================================================

/**
 * Configura eventos do formulário de dívida (uma única vez).
 */
function setupFormDivida() {
  const btnNova  = document.getElementById('btnNovaDivida');
  const btnSalvar = document.getElementById('btnSalvarDivida');

  if (btnNova && !btnNova._scListener) {
    btnNova.addEventListener('click', () => abrirFormDivida());
    btnNova._scListener = true;
  }
  if (btnSalvar && !btnSalvar._scListener) {
    btnSalvar.addEventListener('click', salvarDivida);
    btnSalvar._scListener = true;
  }
}

/**
 * Abre o modal para CRIAR uma nova dívida.
 */
function abrirFormDivida(divida = null) {
  setElDiv('modalDividaTitulo', divida ? 'Editar Dívida' : 'Nova Dívida');
  setValElDiv('dividaId',     divida?.id      != null ? String(divida.id) : '');
  setValElDiv('dividaNome',   divida?.nome    || '');
  setValElDiv('dividaSaldo',  divida?.saldoAtual   != null ? String(divida.saldoAtual)   : '');
  setValElDiv('dividaJuros',  divida?.jurosMensal  != null ? String(divida.jurosMensal)  : '');
  setValElDiv('dividaParcela',divida?.parcelaMinima != null ? String(divida.parcelaMinima): '');
  openModal('modalDivida');
}

/**
 * Carrega dívida do banco e abre o formulário de edição.
 * @param {number} id
 */
async function editarDivida(id) {
  try {
    const d = await dbGet('dividas', id);
    if (d) abrirFormDivida(d);
  } catch (err) {
    showToast('Erro ao carregar dívida.', 'error');
  }
}

/**
 * Salva a dívida (insert ou update) após validação.
 */
async function salvarDivida() {
  const id            = document.getElementById('dividaId')?.value;
  const nome          = (document.getElementById('dividaNome')?.value  || '').trim();
  const saldoAtual    = parseFloat(document.getElementById('dividaSaldo')?.value)   || 0;
  const jurosMensal   = parseFloat(document.getElementById('dividaJuros')?.value)   || 0;
  const parcelaMinima = parseFloat(document.getElementById('dividaParcela')?.value) || 0;

  // Validação
  let ok = true;

  if (!nome) {
    setElDiv('errDividaNome',  'Nome é obrigatório.');
    ok = false;
  } else setElDiv('errDividaNome', '');

  if (!saldoAtual || saldoAtual <= 0) {
    setElDiv('errDividaSaldo', 'Saldo deve ser maior que zero.');
    ok = false;
  } else setElDiv('errDividaSaldo', '');

  if (!jurosMensal || jurosMensal <= 0) {
    setElDiv('errDividaJuros', 'Informe a taxa de juros mensal.');
    ok = false;
  } else setElDiv('errDividaJuros', '');

  if (!ok) return;

  const divida = { nome, saldoAtual, jurosMensal, parcelaMinima };
  if (id) divida.id = parseInt(id, 10);

  try {
    await dbPut('dividas', divida);
    closeModal('modalDivida');
    await renderDividas();
    showToast(id ? 'Dívida atualizada!' : 'Dívida registrada!');
  } catch (err) {
    showToast('Erro ao salvar dívida.', 'error');
  }
}

/**
 * Exclui (ou marca como quitada) uma dívida após confirmação.
 * @param {number} id
 */
function excluirDivida(id) {
  showConfirm(
    'Deseja remover esta dívida? Use esta opção para dívidas quitadas.',
    async () => {
      try {
        await dbDelete('dividas', id);
        await renderDividas();
        showToast('Dívida removida! 🎉');
      } catch (err) {
        showToast('Erro ao remover dívida.', 'error');
      }
    }
  );
}

// ============================================================
// SIMULADOR DE JUROS
// ============================================================

/**
 * Configura o botão do simulador (uma única vez).
 */
function setupSimulador() {
  const btn = document.getElementById('btnSimular');
  if (btn && !btn._scListener) {
    btn.addEventListener('click', executarSimulacao);
    btn._scListener = true;
  }
}

/**
 * Executa a simulação de crescimento de juros e exibe resultados.
 */
function executarSimulacao() {
  const saldo = parseFloat(document.getElementById('simSaldo')?.value) || 0;
  const juros = parseFloat(document.getElementById('simJuros')?.value) || 0;

  if (saldo <= 0 || juros <= 0) {
    showToast('Preencha o saldo e os juros para simular.', 'info');
    return;
  }

  const periodos = [1, 3, 6, 12];
  const resultsEl = document.getElementById('simulatorResults');
  if (!resultsEl) return;

  let html = '<div class="sim-grid">';

  periodos.forEach(n => {
    const vf          = calcValorFuturo(saldo, juros, n);
    const crescimento = vf - saldo;
    const pct         = ((crescimento / saldo) * 100).toFixed(1);

    html += `
      <div class="sim-card">
        <div class="sim-periodo">${n} ${n === 1 ? 'mês' : 'meses'}</div>
        <div class="sim-valor text-danger">${formatCurrency(vf)}</div>
        <div class="sim-crescimento text-danger">+${formatCurrency(crescimento)} (+${pct}%)</div>
      </div>
    `;
  });

  html += '</div>';

  // Dica adicional
  html += `
    <p style="margin-top:14px;font-size:12px;color:var(--text-muted);">
      💡 Com taxa de ${juros}% a.m., o saldo de ${formatCurrency(saldo)} 
      dobrará em aprox. ${Math.ceil(72 / juros)} meses (Regra de 72).
    </p>
  `;

  resultsEl.innerHTML = html;
}

// ============================================================
// UTILIDADES LOCAIS
// ============================================================

function setElDiv(id, text)    { const el = document.getElementById(id); if (el) el.textContent = text; }
function setValElDiv(id, val)  { const el = document.getElementById(id); if (el) el.value = val; }

/** Formata número com casas decimais fixas. */
function formatNum(n, decimals) {
  return Number(n || 0).toFixed(decimals);
}

/** Escapa HTML (importada de contas.js mas redeclarada como guard). */
if (typeof escHtml !== 'function') {
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
