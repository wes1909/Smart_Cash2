/**
 * SmartCash — configuracoes.js
 * Tela 6: Configurações
 * -----------------------------------------------
 * Gerencia:
 *  - Dados financeiros (salário, dia pagamento, moeda)
 *  - Preferências de aparência (tema)
 *  - Exportação de dados (JSON e CSV)
 *  - Backup completo (exportar e importar)
 *  - Limpeza de todos os dados
 */

'use strict';

// ============================================================
// RENDER PRINCIPAL
// ============================================================

/**
 * Renderiza a tela de Configurações.
 */
async function renderConfiguracoes() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const config = AppState.config;

    // Preenche os campos com os valores atuais
    setValCfg('cfgMoeda', config.moeda || 'BRL');
    setValCfg('cfgTema',  config.tema  || 'dark');

    // Configura eventos (uma única vez)
    setupFormConfig();
    setupExportarImportar();

  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    console.error('[Config] Erro ao renderizar:', err);
    showToast('Erro ao carregar configurações.', 'error');
  }
}

// ============================================================
// FORMULÁRIO DE CONFIGURAÇÕES
// ============================================================

function setupFormConfig() {
  const btnSalvar     = document.getElementById('btnSalvarConfig');
  const btnSalvarTema = document.getElementById('btnSalvarTema');
  const btnLimpar     = document.getElementById('btnLimparDados');

  if (btnSalvar && !btnSalvar._scListener) {
    btnSalvar.addEventListener('click', salvarConfiguracoes);
    btnSalvar._scListener = true;
  }

  if (btnSalvarTema && !btnSalvarTema._scListener) {
    btnSalvarTema.addEventListener('click', salvarTema);
    btnSalvarTema._scListener = true;
  }

  if (btnLimpar && !btnLimpar._scListener) {
    btnLimpar.addEventListener('click', confirmarLimparDados);
    btnLimpar._scListener = true;
  }
}

/**
 * Salva as configurações financeiras no banco.
 */
async function salvarConfiguracoes() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  const moeda = document.getElementById('cfgMoeda')?.value || 'BRL';

  AppState.config.moeda = moeda;

  try {
    await saveConfig();
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Configurações salvas com sucesso! ✅');

    // Recarrega o dashboard com os novos valores
    if (AppState.currentScreen === 'dashboard') {
      await renderDashboard();
      if (!isCurrentAppSession(sessionEpoch)) return;
    }
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    console.error('[Config] Erro ao salvar:', err);
    showToast('Erro ao salvar configurações.', 'error');
  }
}

/**
 * Aplica e salva o tema selecionado.
 */
async function salvarTema() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  const tema = document.getElementById('cfgTema')?.value || 'dark';
  AppState.config.tema = tema;
  applyTheme(tema);

  try {
    await saveConfig();
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Tema aplicado com sucesso!');
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Erro ao salvar tema.', 'error');
  }
}

/**
 * Confirma e executa a limpeza total dos dados.
 */
function confirmarLimparDados() {
  showConfirm(
    '⚠️ ATENÇÃO: Esta ação vai apagar TODOS os dados permanentemente. Não há como desfazer. Deseja continuar?',
    async () => {
      const sessionEpoch = appSessionEpoch;
      if (!isCurrentAppSession(sessionEpoch)) return;
      try {
        const temaAtual = AppState.config.tema;
        const moedaAtual = AppState.config.moeda;

        await dbClearAll();
        if (!isCurrentAppSession(sessionEpoch)) return;

        // Reinicia configurações preservando tema e moeda
        AppState.config = {
          id: 1,
          limiteSemanal: 0,
          tema: temaAtual,
          moeda: moedaAtual,
          lastProcessedMonth: AppState.currentMonth
        };

        await saveConfig();
        if (!isCurrentAppSession(sessionEpoch)) return;
        await renderConfiguracoes();
        if (!isCurrentAppSession(sessionEpoch)) return;
        showToast('Todos os dados foram limpos.', 'info');
      } catch (err) {
        if (!isCurrentAppSession(sessionEpoch)) return;
        console.error('[Config] Erro ao limpar dados:', err);
        showToast('Erro ao limpar dados.', 'error');
      }
    }
  );
}

// ============================================================
// EXPORTAÇÃO E BACKUP
// ============================================================

function setupExportarImportar() {
  const btnJSON   = document.getElementById('btnExportJSON');
  const btnCSV    = document.getElementById('btnExportCSV');
  const btnBackup = document.getElementById('btnBackup');
  const inputFile = document.getElementById('btnImport');

  if (btnJSON && !btnJSON._scListener) {
    btnJSON.addEventListener('click', exportarJSON);
    btnJSON._scListener = true;
  }

  if (btnCSV && !btnCSV._scListener) {
    btnCSV.addEventListener('click', exportarCSV);
    btnCSV._scListener = true;
  }

  if (btnBackup && !btnBackup._scListener) {
    btnBackup.addEventListener('click', exportarBackup);
    btnBackup._scListener = true;
  }

  if (inputFile && !inputFile._scListener) {
    inputFile.addEventListener('change', importarBackup);
    inputFile._scListener = true;
  }
}

// ── Exportar JSON ──────────────────────────────────────────

/**
 * Exporta todos os dados como arquivo JSON.
 */
async function exportarJSON() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const dados = await dbExportAll();
    if (!isCurrentAppSession(sessionEpoch)) return;
    const json  = JSON.stringify(dados, null, 2);
    baixarArquivo(json, `smartcash_dados_${getCurrentMonth()}.json`, 'application/json');
    showToast('Dados exportados em JSON! 📤');
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Erro ao exportar JSON.', 'error');
  }
}

// ── Exportar CSV ───────────────────────────────────────────

/**
 * Exporta todas as tabelas como CSV (um bloco por tabela).
 */
async function exportarCSV() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const dados = await dbExportAll();
    if (!isCurrentAppSession(sessionEpoch)) return;
    let csv = `SmartCash — Exportação CSV — ${new Date().toLocaleDateString('pt-BR')}\n\n`;

    // Contas
    csv += 'CONTAS\n';
    csv += 'ID,Nome,Categoria,Valor Parcela,Parcelas Totais,Parcelas Restantes,Fixa,Ativa,Data Criação\n';
    (dados.contas || []).forEach(c => {
      csv += `${c.id},"${c.nome}","${c.categoria}",${c.valorParcela},` +
             `${c.parcelasTotais ?? ''},${c.parcelasRestantes ?? ''},` +
             `${c.fixa},${c.ativa},${c.dataCriacao}\n`;
    });

    // Pagamentos
    csv += '\nPAGAMENTOS\n';
    csv += 'ID,Conta ID,Mês Referência,Valor Pago,Data Pagamento\n';
    (dados.pagamentos || []).forEach(p => {
      csv += `${p.id},${p.contaId},${p.mesReferencia},${p.valorPago},${p.dataPagamento}\n`;
    });

    // Gastos
    csv += '\nGASTOS\n';
    csv += 'ID,Data,Descrição,Categoria,Semana,Valor\n';
    (dados.gastos || []).forEach(g => {
      csv += `${g.id},${g.data},"${g.descricao}","${g.categoria}",${g.semana},${g.valor}\n`;
    });

    // Ganhos
    csv += '\nGANHOS\n';
    csv += 'ID,Data,Descrição,Categoria,Valor\n';
    (dados.ganhos || []).forEach(g => {
      csv += `${g.id},${g.data},"${g.descricao}","${g.categoria}",${g.valor}\n`;
    });

    // Dívidas
    csv += '\nDÍVIDAS\n';
    csv += 'ID,Nome,Saldo Atual,Juros Mensal (%),Parcela Mínima\n';
    (dados.dividas || []).forEach(d => {
      csv += `${d.id},"${d.nome}",${d.saldoAtual},${d.jurosMensal},${d.parcelaMinima || 0}\n`;
    });

    // Investimentos
    csv += '\nINVESTIMENTOS\n';
    csv += 'ID,Nome,Saldo Inicial,Aporte Mensal,Rentabilidade Mensal (%)\n';
    (dados.investimentos || []).forEach(i => {
      csv += `${i.id},"${i.nome}",${i.saldoInicial},${i.aporteMensal},${i.rentabilidadeMensal}\n`;
    });

    // Reservas
    csv += '\nRESERVAS\n';
    csv += 'ID,Mês Referência,Valor Guardado\n';
    (dados.reservas || []).forEach(r => {
      csv += `${r.id},${r.mesReferencia},${r.valorGuardado}\n`;
    });

    baixarArquivo(csv, `smartcash_relatorio_${getCurrentMonth()}.csv`, 'text/csv;charset=utf-8');
    showToast('Relatório CSV exportado! 📊');
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Erro ao exportar CSV.', 'error');
  }
}

// ── Backup Completo ────────────────────────────────────────

/**
 * Exporta backup completo com metadados.
 */
async function exportarBackup() {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  try {
    const dados = await dbExportAll();
    if (!isCurrentAppSession(sessionEpoch)) return;
    const backup = JSON.stringify({
      app:     'SmartCash',
      versao:  '1.0.0',
      geradoEm: new Date().toISOString(),
      dados
    }, null, 2);

    const hoje = new Date().toISOString().split('T')[0];
    baixarArquivo(backup, `smartcash_backup_${hoje}.json`, 'application/json');
    showToast('Backup exportado com sucesso! 💾');
  } catch (err) {
    if (!isCurrentAppSession(sessionEpoch)) return;
    showToast('Erro ao exportar backup.', 'error');
  }
}

/**
 * Importa backup JSON e substitui todos os dados.
 * @param {Event} event
 */
function importarBackup(event) {
  const sessionEpoch = appSessionEpoch;
  if (!isCurrentAppSession(sessionEpoch)) return;
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  const unregisterReader = registerAppSessionCleanup(() => {
    reader.onload = reader.onerror = null;
    if (reader.readyState === 1) reader.abort();
  });

  reader.onload = async e => {
    unregisterReader();
    if (!isCurrentAppSession(sessionEpoch)) return;
    try {
      const conteudo = JSON.parse(e.target.result);

      // Suporta backup com wrapper (app/versao/dados) ou export direto
      const dados = conteudo.dados || conteudo;

      // Validação mínima: precisa ter pelo menos uma das stores
      const temDados = ['contas', 'gastos', 'ganhos', 'dividas', 'reservas', 'investimentos', 'configuracoes']
        .some(store => Array.isArray(dados[store]));

      if (!temDados) {
        showToast('Arquivo inválido. Use um backup exportado pelo SmartCash.', 'error');
        return;
      }

      showConfirm(
        'Importar backup substituirá TODOS os dados atuais. Deseja continuar?',
        async () => {
          const sessionEpoch = appSessionEpoch;
          if (!isCurrentAppSession(sessionEpoch)) return;
          try {
            await dbImportAll(dados);
            if (!isCurrentAppSession(sessionEpoch)) return;
            await loadConfig();
            if (!isCurrentAppSession(sessionEpoch)) return;
            applyTheme(AppState.config.tema);
            await renderConfiguracoes();
            if (!isCurrentAppSession(sessionEpoch)) return;
            showToast('Backup importado com sucesso! ✅');
          } catch (err) {
            if (!isCurrentAppSession(sessionEpoch)) return;
            console.error('[Config] Erro ao importar:', err);
            showToast('Erro ao importar backup.', 'error');
          }
        }
      );

    } catch (_) {
      if (!isCurrentAppSession(sessionEpoch)) return;
      showToast('Arquivo corrompido ou formato inválido.', 'error');
    }
  };

  reader.onerror = () => {
    unregisterReader();
    if (isCurrentAppSession(sessionEpoch)) showToast('Erro ao ler o arquivo.', 'error');
  };
  reader.readAsText(file);

  // Reseta o input para permitir re-importar o mesmo arquivo
  event.target.value = '';
}

// ============================================================
// UTILIDADE — DOWNLOAD
// ============================================================

/**
 * Cria um link temporário e dispara o download de um arquivo.
 * @param {string} conteudo   Texto do arquivo
 * @param {string} nomeArquivo
 * @param {string} tipo       MIME type
 */
function baixarArquivo(conteudo, nomeArquivo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href     = url;
  link.download = nomeArquivo;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Libera memória após o download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================
// UTILIDADES LOCAIS
// ============================================================

function setValCfg(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
