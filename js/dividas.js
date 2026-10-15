/**
 * SmartCash — dividas.js
 * Tela 3: Dívidas
 * -----------------------------------------------
 * Gerencia dívidas com:
 *  - Classificação explicável de prioridade por regras
 *  - Cálculo de Valor Futuro: VF = VP × (1 + i)^n
 *  - Simulação por 1, 3, 6 e 12 meses
 *  - Apoio à decisão sobre atenção às dívidas
 */

'use strict';

/**
 * Análise pura, sem mutações ou acesso ao banco. Critérios v1: ver
 * docs/apoio-decisao-dividas.md. Percentual e taxa não somam pontos.
 */
function analisarPrioridadeDividas(dividas) {
  const projetadas = dividas.map(d => {
    const quitada = d.saldoAtual === 0;
    const valida = Number.isFinite(d.saldoAtual) && d.saldoAtual >= 0 &&
      Number.isFinite(d.jurosMensal) && d.jurosMensal >= 0;
    const vf12 = quitada ? 0 : valida ? calcValorFuturo(d.saldoAtual, d.jurosMensal, 12) : NaN;
    const crescimento = vf12 - d.saldoAtual;
    return { ...d, vf12, crescimento,
      pctCrescimento: quitada ? 0 : crescimento / d.saldoAtual * 100,
      analisavel: !quitada && valida && Number.isFinite(vf12),
      prioridade: null, nivelPrioridade: 0, regrasAcionadas: [], justificativa: '', observacaoPrioridade: '' };
  });
  const ativas = projetadas.filter(d => d.analisavel);
  // Ordenação antes da soma torna o resultado independente da ordem de entrada.
  const crescimentos = ativas.map(d => d.crescimento).sort((a, b) => a - b);
  const maior = crescimentos[crescimentos.length - 1] || 0;
  // Normalizar evita overflow na soma de projeções individualmente finitas.
  const somaNormalizada = maior > 0 ? crescimentos.reduce((s, v) => s + v / maior, 0) : 0;
  for (const d of projetadas) {
    if (d.saldoAtual === 0) {
      d.regrasAcionadas = ['R1'];
      d.justificativa = 'Dívida quitada, sem prioridade.';
      continue;
    }
    if (!d.analisavel) {
      d.justificativa = 'Não classificada: confira o saldo e a taxa de juros.';
      continue;
    }
    const participacao = somaNormalizada > 0 ? (d.crescimento / maior) / somaNormalizada : 0;
    const impactoRelativo = ativas.length > 1 && d.crescimento > 0 && participacao >= 1 / ativas.length;
    // 60% do crescimento total implica pelo menos 1,5 vez todo o restante.
    const destaque = ativas.length > 1 && participacao >= 0.60;
    const combinacao = d.jurosMensal >= 5 && (ativas.length === 1 || impactoRelativo);
    const motivos = [];
    if (combinacao || destaque) {
      d.prioridade = 'Alta'; d.nivelPrioridade = 3; d.regrasAcionadas = ['R2'];
      if (combinacao) motivos.push(`taxa elevada de ${d.jurosMensal.toFixed(2)}% ao mês (limite: 5%)`);
      if (impactoRelativo) motivos.push('crescimento em reais igual ou superior à média das dívidas ativas analisáveis');
      if (ativas.length === 1) motivos.push('crescimento projetado associado a essa taxa na única dívida ativa analisável');
      if (destaque) motivos.push('concentração de pelo menos 60% do crescimento projetado total das dívidas ativas analisáveis');
    } else if (d.pctCrescimento >= 25 || impactoRelativo) {
      d.prioridade = 'Média'; d.nivelPrioridade = 2; d.regrasAcionadas = ['R3'];
      if (d.pctCrescimento >= 25) motivos.push(`crescimento de ${d.pctCrescimento.toFixed(2)}% em 12 meses (limite: 25%)`);
      if (impactoRelativo) motivos.push('crescimento em reais igual ou superior à média das dívidas ativas analisáveis');
    } else {
      d.prioridade = 'Baixa'; d.nivelPrioridade = 1; d.regrasAcionadas = ['R4'];
      motivos.push('crescimento inferior a 25% em 12 meses');
      if (ativas.length > 1) motivos.push(d.crescimento > 0
        ? 'crescimento em reais abaixo da média das dívidas ativas analisáveis'
        : 'ausência de crescimento projetado');
    }
    d.justificativa = `Prioridade ${d.prioridade.toLowerCase()} devido a ${motivos.join(' e ')}. Projeção sem pagamentos.`;
    if (Number.isFinite(d.parcelaMinima) && d.parcelaMinima > 0 &&
        d.parcelaMinima <= d.saldoAtual * d.jurosMensal / 100) {
      d.regrasAcionadas.push('R5');
      d.observacaoPrioridade = 'A parcela mínima informada não supera os juros estimados de um mês sobre o saldo atual. Confira as condições do contrato.';
    }
  }
  return projetadas.sort((a, b) =>
    Number(b.saldoAtual > 0) - Number(a.saldoAtual > 0) ||
    b.nivelPrioridade - a.nivelPrioridade ||
    (Number.isFinite(b.crescimento) ? b.crescimento : 0) - (Number.isFinite(a.crescimento) ? a.crescimento : 0) ||
    (b.jurosMensal || 0) - (a.jurosMensal || 0) || a.id - b.id);
}

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

    const dividasComProjecao = analisarPrioridadeDividas(dividas);

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

  dividas.forEach(d => {
    const quitada = d.saldoAtual === 0;
    const priorityClass = d.prioridade === 'Alta' ? 'badge-red'
      : d.prioridade === 'Média' ? 'badge-yellow' : d.prioridade === 'Baixa' ? 'badge-green' : 'badge-gray';
    const priorLabel = quitada ? 'Quitada' : d.prioridade ? `Prioridade ${d.prioridade}` : 'Não classificada';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span class="badge ${quitada ? 'badge-green' : priorityClass}">${priorLabel}</span></td>
      <td>
        <div class="cell-main">${escHtml(d.nome)}</div>
        <div class="cell-sub">${escHtml(d.justificativa || '')}</div>
        ${d.observacaoPrioridade ? `<div class="cell-sub">${escHtml(d.observacaoPrioridade)}</div>` : ''}
      </td>
      <td class="${quitada ? 'text-success' : 'text-danger'} fw-bold">${formatCurrency(d.saldoAtual)}</td>
      <td>
        <span class="badge badge-red">${formatNum(d.jurosMensal, 2)}% a.m.</span>
      </td>
      <td>${d.parcelaMinima > 0 ? formatCurrency(d.parcelaMinima) : '—'}</td>
      <td>
        <div class="cell-main ${quitada ? 'text-success' : 'text-danger'}">${Number.isFinite(d.vf12) ? formatCurrency(d.vf12) : '—'}</div>
        <div class="cell-sub">em 12 meses</div>
      </td>
      <td>
        <span class="${quitada ? 'text-success' : 'text-danger'} fw-bold">${Number.isFinite(d.crescimento) ? '+' + formatCurrency(d.crescimento) : '—'}</span>
        <div class="cell-sub ${quitada ? 'text-success' : 'text-danger'}">${Number.isFinite(d.pctCrescimento) ? '+' + formatNum(d.pctCrescimento, 1) + '%' : '—'}</div>
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

  if (dividas.every(d => d.saldoAtual === 0)) {
    el.innerHTML = '<p class="text-success">🎉 Todas as dívidas estão quitadas.</p>';
    return;
  }

  dividas = dividas.filter(d => d.saldoAtual > 0 && d.prioridade);
  if (!dividas.length) {
    el.textContent = 'Confira os dados das dívidas para obter uma classificação.';
    return;
  }
  const top     = dividas[0];
  const pct     = formatNum(top.pctCrescimento, 1);
  const juros12 = calcValorFuturo(top.saldoAtual, top.jurosMensal, 12) - top.saldoAtual;

  el.innerHTML = `
    <div class="recommendation">
      <span class="rec-icon">⚠️</span>
      <div class="rec-content">
        <strong>Apoio à decisão — prioridade ${escHtml(top.prioridade)}: ${escHtml(top.nome)}</strong>
        <p>${escHtml(top.justificativa)}</p>
        <p>
          Com juros de <strong>${formatNum(top.jurosMensal, 2)}% ao mês</strong>,
          mantendo o saldo atual de <strong>${formatCurrency(top.saldoAtual)}</strong> sem pagar,
          em <strong>12 meses</strong> esta dívida crescerá para
          <strong class="text-danger">${formatCurrency(top.vf12)}</strong>
          — um aumento de <strong class="text-danger">+${formatCurrency(juros12)}</strong> (+${pct}%).
          Considere estes critérios ao planejar seus pagamentos; a decisão é sua.
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
