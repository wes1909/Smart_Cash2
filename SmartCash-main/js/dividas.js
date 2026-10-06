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
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const dividas = await dbGetAll('dividas');
    if (!isCurrentAppSession(sessionEpoch)) return;

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
      .sort((a, b) => Number(b.saldoAtual > 0) - Number(a.saldoAtual > 0) ||
        b.crescimento - a.crescimento); // Quitadas após as dívidas ativas.

    // Tabela
    renderTabelaDividas(dividasComProjecao);

    // Caixa de recomendação
    renderRecomendacao(dividasComProjecao);

    // Setup de eventos
    setupFormDivida();
    setupSimulador();

  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
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
    const quitada = d.saldoAtual === 0;
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
      <td><span class="badge ${quitada ? 'badge-green' : priorityClass}">${quitada ? 'Quitada' : priorLabel}</span></td>
      <td>
        <div class="cell-main">${escHtml(d.nome)}</div>
      </td>
      <td class="${quitada ? 'text-success' : 'text-danger'} fw-bold">${formatCurrency(d.saldoAtual)}</td>
      <td>
        <span class="badge badge-red">${formatNum(d.jurosMensal, 2)}% a.m.</span>
      </td>
      <td>${d.parcelaMinima > 0 ? formatCurrency(d.parcelaMinima) : '—'}</td>
      <td>
        <div class="cell-main ${quitada ? 'text-success' : 'text-danger'}">${formatCurrency(d.vf12)}</div>
        <div class="cell-sub">em 12 meses</div>
      </td>
      <td>
        <span class="${quitada ? 'text-success' : 'text-danger'} fw-bold">+${formatCurrency(d.crescimento)}</span>
        <div class="cell-sub ${quitada ? 'text-success' : 'text-danger'}">+${formatNum(d.pctCrescimento, 1)}%</div>
      </td>
      <td class="actions-cell debt-actions">
        ${d.saldoAtual > 0 ? `<button class="btn btn-secondary btn-sm" onclick="abrirAmortizacaoDivida(${d.id})">Amortizar</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="abrirHistoricoDivida(${d.id})">Histórico</button>
        <button class="btn-icon" title="Editar" onclick="editarDivida(${d.id})">✏️</button>
        <button class="btn-icon btn-danger" title="Excluir" onclick="excluirDivida(${d.id})">🗑️</button>
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

  dividas = dividas.filter(d => d.saldoAtual > 0);
  if (!dividas.length) {
    el.innerHTML = '<p class="text-success">🎉 Todas as dívidas estão quitadas.</p>';
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
  document.getElementById('dividaSaldo').dataset.saldoOriginal = divida ? String(divida.saldoAtual) : '';
  setValElDiv('dividaJuros',  divida?.jurosMensal  != null ? String(divida.jurosMensal)  : '');
  setValElDiv('dividaParcela',divida?.parcelaMinima != null ? String(divida.parcelaMinima): '');
  openModal('modalDivida');
}

/**
 * Carrega dívida do banco e abre o formulário de edição.
 * @param {number} id
 */
async function editarDivida(id) {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const d = await dbGet('dividas', id);
    if (!isCurrentAppSession(sessionEpoch)) return;
    if (d) abrirFormDivida(d);
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Erro ao carregar dívida.', 'error');
  }
}

/**
 * Salva a dívida (insert ou update) após validação.
 */
async function salvarDivida() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  const id            = document.getElementById('dividaId')?.value;
  const nome          = (document.getElementById('dividaNome')?.value  || '').trim();
  const saldoInput    = document.getElementById('dividaSaldo');
  const saldoAtual    = parseFloat(saldoInput?.value);
  const eraQuitada    = Boolean(id) && saldoInput.dataset.saldoOriginal === '0';
  const jurosMensal   = parseFloat(document.getElementById('dividaJuros')?.value)   || 0;
  const parcelaMinima = parseFloat(document.getElementById('dividaParcela')?.value) || 0;

  // Validação
  let ok = true;

  if (!nome) {
    setElDiv('errDividaNome',  'Nome é obrigatório.');
    ok = false;
  } else setElDiv('errDividaNome', '');

  if (!Number.isFinite(saldoAtual) || saldoAtual < 0 || (saldoAtual === 0 && !eraQuitada)) {
    setElDiv('errDividaSaldo', eraQuitada ? 'Saldo deve ser zero ou positivo.' : 'Saldo deve ser maior que zero.');
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
    if (id) {
      const atual = await dbGet('dividas', Number(id));
      if (!isCurrentAppSession(sessionEpoch)) return;
      if (!atual || atual.saldoAtual !== Number(saldoInput.dataset.saldoOriginal)) {
        showToast('O saldo mudou. Abra a edição novamente antes de salvar.', 'error');
        return;
      }
    }
    await dbPut('dividas', divida);
    if (!isCurrentAppSession(sessionEpoch)) return;
    closeModal('modalDivida');
    await renderDividas();
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast(id ? 'Dívida atualizada!' : 'Dívida registrada!');
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Erro ao salvar dívida.', 'error');
  }
}

/**
 * Exclui uma dívida sem histórico após confirmação.
 * @param {number} id
 */
async function excluirDivida(id) {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  const preservedMessage = 'Esta dívida possui histórico de amortizações e deve ser preservada.';
  try {
    const historico = await dbGetPagamentosPorDivida(id);
    if (!isCurrentAppSession(sessionEpoch)) return;
    if (historico.length) { showToast(preservedMessage, 'info'); return; }
  } catch (err) {
    if (isCurrentAppSession(sessionEpoch)) showToast('Erro ao consultar o histórico da dívida.', 'error');
    return;
  }
  showConfirm(
    'Deseja excluir esta dívida?',
    async () => {
      const sessionEpoch = appSessionEpoch;
      if (!isCurrentAppSession(sessionEpoch)) return;
      try {
        const historico = await dbGetPagamentosPorDivida(id);
        if (!isCurrentAppSession(sessionEpoch)) return;
        if (historico.length) { showToast(preservedMessage, 'info'); return; }
        await dbDelete('dividas', id);
        if (!isCurrentAppSession(sessionEpoch)) return;
        await renderDividas();
        if (!isCurrentAppSession(sessionEpoch)) return;
        showToast('Dívida removida! 🎉');
      } catch (err) {
        if (!isCurrentAppSession(sessionEpoch)) return;
        showToast(err.code === '23503' ? preservedMessage : 'Erro ao remover dívida.', 'error');
      }
    }
  );
}

// ============================================================
// AMORTIZAÇÃO E HISTÓRICO
// ============================================================

function atualizarSaldoAmortizacao() {
  const modal = document.getElementById('modalAmortizacaoDivida');
  const saldo = Number(modal.dataset.saldo);
  const valor = Number(document.getElementById('amortizacaoValor').value);
  const valido = Number.isFinite(valor) && valor > 0 && valor <= saldo;
  // Centavos somente para a prévia visual; a subtração definitiva é feita pela RPC.
  setElDiv('amortizacaoSaldoPrevisto', valido
    ? formatCurrency((Math.round(saldo * 100) - Math.round(valor * 100)) / 100) : '—');
}

async function abrirAmortizacaoDivida(id) {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  if (document.getElementById('modalAmortizacaoDivida').dataset.busy === 'true') {
    showToast('Aguarde a confirmação da amortização em andamento.', 'info');
    return;
  }
  try {
    const divida = await dbGet('dividas', id);
    if (!isCurrentAppSession(sessionEpoch)) return;
    if (!divida) { showToast('Dívida não encontrada.', 'error'); return; }
    if (divida.saldoAtual <= 0) { showToast('Dívida quitada não pode receber amortização.', 'info'); return; }
    const modal = document.getElementById('modalAmortizacaoDivida');
    modal.dataset.dividaId = String(id);
    modal.dataset.saldo = String(divida.saldoAtual);
    modal.dataset.busy = '';
    setElDiv('amortizacaoNome', divida.nome);
    setElDiv('amortizacaoSaldoAtual', formatCurrency(divida.saldoAtual));
    const hoje = new Date();
    setValElDiv('amortizacaoData', `${toMonthString(hoje)}-${String(hoje.getDate()).padStart(2, '0')}`);
    setValElDiv('amortizacaoValor', '');
    setValElDiv('amortizacaoObservacao', '');
    const valorInput = document.getElementById('amortizacaoValor');
    valorInput.max = String(divida.saldoAtual);
    valorInput.oninput = atualizarSaldoAmortizacao;
    const salvar = document.getElementById('btnSalvarAmortizacao');
    salvar.disabled = false;
    salvar.onclick = () => {
      if (isCurrentAppSession(sessionEpoch)) return salvarAmortizacaoDivida();
    };
    setElDiv('errAmortizacao', '');
    atualizarSaldoAmortizacao();
    openModal('modalAmortizacaoDivida');
  } catch (err) {
    if (isCurrentAppSession(sessionEpoch)) showToast('Erro ao carregar dívida.', 'error');
  }
}

async function salvarAmortizacaoDivida() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  const modal = document.getElementById('modalAmortizacaoDivida');
  if (modal.dataset.busy === 'true') return;
  const id = Number(modal.dataset.dividaId);
  const saldo = Number(modal.dataset.saldo);
  const data = document.getElementById('amortizacaoData').value;
  const valor = Number(document.getElementById('amortizacaoValor').value);
  const observacao = document.getElementById('amortizacaoObservacao').value.trim();
  if (!Number.isFinite(valor) || valor <= 0 || valor > saldo || saldo <= 0) {
    setElDiv('errAmortizacao', 'Informe um valor maior que zero e não superior ao saldo atual.');
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !document.getElementById('amortizacaoData').checkValidity()) {
    setElDiv('errAmortizacao', 'Informe uma data válida.');
    return;
  }
  if (!document.getElementById('amortizacaoValor').checkValidity()) {
    setElDiv('errAmortizacao', 'Informe um valor em centavos, sem mais de duas casas decimais.');
    return;
  }
  modal.dataset.busy = 'true';
  const salvar = document.getElementById('btnSalvarAmortizacao');
  salvar.disabled = true;
  setElDiv('errAmortizacao', '');
  let gravada = false;
  try {
    await dbAmortizarDivida(id, data, valor, observacao);
    if (!isCurrentAppSession(sessionEpoch)) return;
    gravada = true;
    closeModal('modalAmortizacaoDivida');
    await renderDividas();
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Amortização registrada com sucesso!');
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    setElDiv('errAmortizacao', gravada
      ? 'Amortização registrada. Reabra a tela para atualizar os dados.'
      : 'Não foi possível confirmar a amortização. Confira o saldo e o histórico antes de tentar novamente.');
  } finally {
    if (isCurrentAppSession(sessionEpoch)) {
      modal.dataset.busy = '';
      salvar.disabled = false;
    }
  }
}

async function abrirHistoricoDivida(id) {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  const modal = document.getElementById('modalHistoricoDivida');
  modal.dataset.dividaId = String(id);
  setElDiv('historicoDividaNome', 'Carregando...');
  setElDiv('historicoDividaSaldo', '');
  const body = document.getElementById('historicoDividaBody');
  body.innerHTML = '<tr><td colspan="3" class="table-empty">Carregando...</td></tr>';
  openModal('modalHistoricoDivida');
  try {
    const [divida, pagamentos] = await Promise.all([dbGet('dividas', id), dbGetPagamentosPorDivida(id)]);
    if (!isCurrentAppSession(sessionEpoch) || modal.dataset.dividaId !== String(id)) return;
    if (!divida) { closeModal('modalHistoricoDivida'); showToast('Dívida não encontrada.', 'error'); return; }
    setElDiv('historicoDividaNome', divida.nome);
    setElDiv('historicoDividaSaldo', `Saldo atual: ${formatCurrency(divida.saldoAtual)}`);
    body.innerHTML = pagamentos.length ? pagamentos.map(p => `
      <tr><td>${formatDate(p.dataPagamento)}</td><td>${formatCurrency(p.valor)}</td>
      <td class="debt-observation">${escHtml(p.observacao || '—')}</td></tr>`).join('')
      : '<tr><td colspan="3" class="table-empty">Nenhuma amortização registrada.</td></tr>';
  } catch (err) {
    if (isCurrentAppSession(sessionEpoch) && modal.dataset.dividaId === String(id)) {
      body.innerHTML = '<tr><td colspan="3" class="table-empty">Erro ao carregar histórico. Feche e tente novamente.</td></tr>';
    }
  }
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
