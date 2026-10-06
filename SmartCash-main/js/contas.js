/**
 * SmartCash — contas.js
 * Tela 2: Contas
 * -----------------------------------------------
 * Gerencia contas fixas e parceladas:
 *  - CRUD completo (criar, editar, excluir, duplicar)
 *  - Registro de pagamentos com desconto
 *  - Filtros e busca
 *  - Encerramento automático de parceladas
 */

'use strict';

// ============================================================
// RENDER PRINCIPAL
// ============================================================

/**
 * Renderiza a tela de Contas com tabela e filtros.
 */
async function renderContas() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const mes       = getCurrentMonth();
    const pagamentos = await dbGetPagamentosPorMes(mes);
    if (!isCurrentAppSession(sessionEpoch)) return;
    let   contas     = await dbGetAll('contas');
    if (!isCurrentAppSession(sessionEpoch)) return;

    // Aplica filtros
    contas = aplicarFiltrosContas(contas);

    // Renderiza tabela
    renderTabelaContas(contas, pagamentos);

    // Atualiza rodapé
    const ativas      = contas.filter(c => c.ativa);
    const totalValor  = ativas.reduce((s, c) => s + (c.valorParcela || 0), 0);
    setElContas('contasResumo',
      `${ativas.length} conta(s) ativa(s) — Total mensal: ${formatCurrency(totalValor)}`
    );

    // Configura eventos (uma única vez por render)
    setupFiltrosContas();
    setupFormConta();

  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    console.error('[Contas] Erro ao renderizar:', err);
    showToast('Erro ao carregar contas.', 'error');
  }
}

/**
 * Aplica filtro de texto e select à lista de contas.
 */
function aplicarFiltrosContas(contas) {
  const search = (document.getElementById('searchContas')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('filterContas')?.value || '';

  let resultado = [...contas];

  if (filter === 'fixa')      resultado = resultado.filter(c => c.fixa);
  if (filter === 'parcelada') resultado = resultado.filter(c => !c.fixa);
  if (filter === 'ativa')     resultado = resultado.filter(c => c.ativa);
  if (filter === 'encerrada') resultado = resultado.filter(c => !c.ativa);

  if (search) {
    resultado = resultado.filter(c =>
      (c.nome      || '').toLowerCase().includes(search) ||
      (c.categoria || '').toLowerCase().includes(search)
    );
  }

  return resultado;
}

/**
 * Preenche o `<tbody>` da tabela de contas.
 */
function renderTabelaContas(contas, pagamentos) {
  const tbody = document.getElementById('contasTableBody');
  if (!tbody) return;

  if (contas.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="table-empty">Nenhuma conta encontrada. Clique em "+ Nova Conta" para adicionar.</td></tr>';
    return;
  }

  tbody.innerHTML = '';

  contas.forEach(conta => {
    const pagamento  = pagamentos.find(p => p.contaId === conta.id);
    const valorPago  = pagamento ? (pagamento.valorPago || 0) : 0;
    const diferenca  = (conta.valorParcela || 0) - valorPago; // positivo = falta pagar / negativo = pagou a mais

    const statusBadge = !conta.ativa
      ? '<span class="badge badge-gray">Encerrada</span>'
      : valorPago > 0
        ? '<span class="badge badge-green">✅ Pago</span>'
        : '<span class="badge badge-yellow">⏳ Pendente</span>';

    const parcelaInfo = conta.fixa
      ? '<span class="badge badge-blue">Fixa</span>'
      : conta.parcelasRestantes !== null
        ? `${conta.parcelasRestantes}/${conta.parcelasTotais || '?'}`
        : '—';

    let diferencaHtml = '—';
    if (valorPago > 0 && diferenca !== 0) {
      if (diferenca < 0) {
        // Pagou a mais — economia
        diferencaHtml = `<span class="text-success">−${formatCurrency(Math.abs(diferenca))} <small>(economia)</small></span>`;
      } else {
        // Pagou a menos — falta
        diferencaHtml = `<span class="text-danger">+${formatCurrency(diferenca)} <small>(falta)</small></span>`;
      }
    }

    // Botão de pagar só aparece se ativa e não paga ainda
    const btnPagar = conta.ativa && !pagamento
      ? `<button class="btn-icon btn-success" title="Registrar pagamento"
           onclick="abrirModalPagamento(${conta.id})">💰</button>`
      : '';

    const row = document.createElement('tr');
    if (!conta.ativa) row.style.opacity = '0.55';

    row.innerHTML = `
      <td>
        <div class="cell-main">${escHtml(conta.nome)}</div>
        <div class="cell-sub">${conta.dataCriacao ? 'desde ' + formatDate(conta.dataCriacao) : ''}</div>
      </td>
      <td><span class="badge badge-blue">${escHtml(conta.categoria)}</span></td>
      <td>${formatCurrency(conta.valorParcela)}</td>
      <td>${parcelaInfo}</td>
      <td>${valorPago > 0 ? formatCurrency(valorPago) : '—'}</td>
      <td>${diferencaHtml}</td>
      <td>${statusBadge}</td>
      <td class="actions-cell">
        ${btnPagar}
        <button class="btn-icon" title="Editar" onclick="editarConta(${conta.id})">✏️</button>
        <button class="btn-icon btn-info"   title="Duplicar" onclick="duplicarConta(${conta.id})">📋</button>
        <button class="btn-icon btn-danger" title="Excluir"  onclick="excluirConta(${conta.id})">🗑️</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ============================================================
// FILTROS E BUSCA
// ============================================================

/**
 * Configura os eventos de filtro/busca (evita duplicatas com flag).
 */
function setupFiltrosContas() {
  const search = document.getElementById('searchContas');
  const filter = document.getElementById('filterContas');

  if (search && !search._scListener) {
    search.addEventListener('input', renderContas);
    search._scListener = true;
  }
  if (filter && !filter._scListener) {
    filter.addEventListener('change', renderContas);
    filter._scListener = true;
  }
}

// ============================================================
// FORMULÁRIO DE CONTA
// ============================================================

/**
 * Configura eventos do formulário de conta (btn nova + salvar).
 */
function setupFormConta() {
  const btnNova  = document.getElementById('btnNovaContas');
  const btnSalvar = document.getElementById('btnSalvarConta');
  const checkFixa = document.getElementById('contaFixa');

  if (btnNova && !btnNova._scListener) {
    btnNova.addEventListener('click', () => abrirFormConta());
    btnNova._scListener = true;
  }
  if (btnSalvar && !btnSalvar._scListener) {
    btnSalvar.addEventListener('click', salvarConta);
    btnSalvar._scListener = true;
  }
  if (checkFixa && !checkFixa._scListener) {
    checkFixa.addEventListener('change', e => toggleCamposParcelada(!e.target.checked));
    checkFixa._scListener = true;
  }
}

/**
 * Exibe ou esconde campos de parcelas baseado no tipo de conta.
 */
function toggleCamposParcelada(mostrar) {
  const grupoTotal = document.getElementById('grupoParcelasTotal');
  const grupoRest  = document.getElementById('grupoParcelasRest');
  if (grupoTotal) grupoTotal.style.display = mostrar ? '' : 'none';
  if (grupoRest)  grupoRest.style.display  = mostrar ? '' : 'none';
}

/**
 * Abre o modal para CRIAR uma nova conta.
 */
function abrirFormConta() {
  setElContas('modalContaTitulo', 'Nova Conta');
  setValEl('contaId',               '');
  setValEl('contaNome',             '');
  setValEl('contaCategoria',        'Financiamento');
  setValEl('contaValorParcela',     '');
  setValEl('contaParcelasTotais',   '');
  setValEl('contaParcelasRestantes','');
  setValEl('contaDataCriacao',      new Date().toISOString().split('T')[0]);

  const checkFixa = document.getElementById('contaFixa');
  if (checkFixa) checkFixa.checked = false;
  toggleCamposParcelada(true);

  openModal('modalConta');
}

/**
 * Abre o modal para EDITAR uma conta existente.
 * @param {number} id
 */
async function editarConta(id) {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const conta = await dbGet('contas', id);
    if (!isCurrentAppSession(sessionEpoch)) return;
    if (!conta) { showToast('Conta não encontrada.', 'error'); return; }

    setElContas('modalContaTitulo', 'Editar Conta');
    setValEl('contaId',               String(conta.id));
    setValEl('contaNome',             conta.nome);
    setValEl('contaCategoria',        conta.categoria);
    setValEl('contaValorParcela',     String(conta.valorParcela));
    setValEl('contaParcelasTotais',   conta.parcelasTotais   != null ? String(conta.parcelasTotais) : '');
    setValEl('contaParcelasRestantes',conta.parcelasRestantes != null ? String(conta.parcelasRestantes) : '');
    setValEl('contaDataCriacao',      conta.dataCriacao || '');

    const checkFixa = document.getElementById('contaFixa');
    if (checkFixa) checkFixa.checked = conta.fixa;
    toggleCamposParcelada(!conta.fixa);

    openModal('modalConta');
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Erro ao carregar conta.', 'error');
  }
}

/**
 * Salva a conta (insert ou update).
 */
async function salvarConta() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  // Coleta valores do formulário
  const id               = document.getElementById('contaId')?.value;
  const nome             = (document.getElementById('contaNome')?.value || '').trim();
  const categoria        = document.getElementById('contaCategoria')?.value || 'Outros';
  const valorParcela     = parseFloat(document.getElementById('contaValorParcela')?.value) || 0;
  const fixa             = document.getElementById('contaFixa')?.checked || false;
  const parcelasTotais   = parseInt(document.getElementById('contaParcelasTotais')?.value, 10) || null;
  const parcelasRestantes= parseInt(document.getElementById('contaParcelasRestantes')?.value, 10) || null;
  const dataCriacao      = document.getElementById('contaDataCriacao')?.value || new Date().toISOString().split('T')[0];

  // Validação
  let ok = true;

  if (!nome) {
    setElContas('errContaNome', 'Nome é obrigatório.');
    ok = false;
  } else setElContas('errContaNome', '');

  if (!valorParcela || valorParcela <= 0) {
    setElContas('errContaValor', 'Informe um valor maior que zero.');
    ok = false;
  } else setElContas('errContaValor', '');

  if (!ok) return;

  // Monta objeto
  const conta = {
    nome,
    categoria,
    valorParcela,
    fixa,
    parcelasTotais:    fixa ? null : parcelasTotais,
    parcelasRestantes: fixa ? null : parcelasRestantes,
    ativa:             true,
    dataCriacao
  };
  if (id) conta.id = parseInt(id, 10);

  try {
    await dbPut('contas', conta);
    if (!isCurrentAppSession(sessionEpoch)) return;
    closeModal('modalConta');
    await renderContas();
    if (!isCurrentAppSession(sessionEpoch)) return;
    await renderDashboard();
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast(id ? 'Conta atualizada com sucesso!' : 'Conta criada com sucesso!');
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    console.error('[Contas] Erro ao salvar:', err);
    showToast('Erro ao salvar a conta.', 'error');
  }
}

/**
 * Exclui uma conta após confirmação.
 * @param {number} id
 */
function excluirConta(id) {
  showConfirm(
    'Deseja excluir esta conta? O histórico de pagamentos será mantido.',
    async () => {
      const sessionEpoch = appSessionEpoch;
      if (!isCurrentAppSession(sessionEpoch)) return;
      try {
        await dbDelete('contas', id);
        if (!isCurrentAppSession(sessionEpoch)) return;
        await renderContas();
        if (!isCurrentAppSession(sessionEpoch)) return;
        await renderDashboard();
        if (!isCurrentAppSession(sessionEpoch)) return;
        showToast('Conta excluída.');
      } catch (err) {
        if (!isCurrentAppSession(sessionEpoch)) return;
        showToast('Erro ao excluir a conta.', 'error');
      }
    }
  );
}

/**
 * Duplica uma conta existente.
 * @param {number} id
 */
async function duplicarConta(id) {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const conta = await dbGet('contas', id);
    if (!isCurrentAppSession(sessionEpoch)) return;
    if (!conta) return;

    const copia = { ...conta };
    delete copia.id;
    copia.nome        = `${conta.nome} (Cópia)`;
    copia.dataCriacao = new Date().toISOString().split('T')[0];

    await dbAdd('contas', copia);
    if (!isCurrentAppSession(sessionEpoch)) return;
    await renderContas();
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Conta duplicada com sucesso!');
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Erro ao duplicar a conta.', 'error');
  }
}

// ============================================================
// PAGAMENTOS
// ============================================================

/**
 * Abre o modal de registro de pagamento para uma conta.
 * @param {number} contaId
 */
async function abrirModalPagamento(contaId) {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const conta = await dbGet('contas', contaId);
    if (!isCurrentAppSession(sessionEpoch)) return;
    if (!conta) return;

    const mes  = getCurrentMonth();
    const hoje = new Date().toISOString().split('T')[0];

    setValEl('pagContaId',        String(contaId));
    setValEl('pagValorPago',      String(conta.valorParcela));
    setValEl('pagDataPagamento',  hoje);
    setValEl('pagMesReferencia',  mes);

    const infoBox = document.getElementById('pagInfoBox');
    if (infoBox) {
      infoBox.textContent =
        `${conta.nome} — Parcela: ${formatCurrency(conta.valorParcela)}` +
        (conta.fixa ? ' (Fixa)' : ` — Restam: ${conta.parcelasRestantes || 0} parcela(s)`);
    }

    openModal('modalPagamento');

    // Atribui handler direto (evita empilhar listeners)
    const btnSalvar = document.getElementById('btnSalvarPagamento');
    if (btnSalvar) {
      btnSalvar.onclick = () => {
        if (isCurrentAppSession(sessionEpoch)) return salvarPagamento(contaId);
      };
    }
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Erro ao abrir pagamento.', 'error');
  }
}

/**
 * Salva o pagamento de uma conta.
 * Decrementa parcelas em contas parceladas e encerra quando chegar a 0.
 * @param {number} contaId
 */
async function salvarPagamento(contaId) {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  const valorPago     = parseFloat(document.getElementById('pagValorPago')?.value) || 0;
  const dataPagamento = document.getElementById('pagDataPagamento')?.value || '';
  const mesReferencia = document.getElementById('pagMesReferencia')?.value || '';

  if (!valorPago || valorPago <= 0) {
    setElContas('errPagValor', 'Informe um valor maior que zero.');
    return;
  }
  setElContas('errPagValor', '');

  try {
    // Verifica pagamento existente para o mesmo mês (evita duplicata)
    const existente = await dbGetPagamentoPorContaMes(contaId, mesReferencia);
    if (!isCurrentAppSession(sessionEpoch)) return;

    const pagamento = { contaId, mesReferencia, valorPago, dataPagamento };
    if (existente) pagamento.id = existente.id; // update

    await dbPut('pagamentos', pagamento);
    if (!isCurrentAppSession(sessionEpoch)) return;

    // Para contas parceladas: decrementa parcelas restantes
    const conta = await dbGet('contas', contaId);
    if (!isCurrentAppSession(sessionEpoch)) return;
    if (conta && !conta.fixa && conta.parcelasRestantes > 0) {
      conta.parcelasRestantes -= 1;
      if (conta.parcelasRestantes === 0) {
        conta.ativa = false; // Encerra automaticamente
      }
      await dbPut('contas', conta);
      if (!isCurrentAppSession(sessionEpoch)) return;
    }

    closeModal('modalPagamento');
    await renderContas();
    if (!isCurrentAppSession(sessionEpoch)) return;
    await renderDashboard();
    if (!isCurrentAppSession(sessionEpoch)) return;

    // Informa economia ou acréscimo
    const parcela  = (await dbGet('contas', contaId))?.valorParcela || 0;
    if (!isCurrentAppSession(sessionEpoch)) return;
    const economia = parcela - valorPago;
    if (economia > 0) {
      showToast(`Pagamento registrado! Você economizou ${formatCurrency(economia)} 🎉`);
    } else if (economia < 0) {
      showToast(`Pagamento registrado com acréscimo de ${formatCurrency(Math.abs(economia))}.`, 'info');
    } else {
      showToast('Pagamento registrado com sucesso! ✅');
    }

  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    console.error('[Contas] Erro ao salvar pagamento:', err);
    showToast('Erro ao registrar pagamento.', 'error');
  }
}

// ============================================================
// UTILIDADES LOCAIS
// ============================================================

/** Define o textContent de um elemento pelo ID. */
function setElContas(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Define o value de um input pelo ID. */
function setValEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

/** Escapa HTML para evitar XSS. */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
