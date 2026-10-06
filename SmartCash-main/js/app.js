/**
 * SmartCash — app.js
 * Módulo Principal da Aplicação
 * -----------------------------------------------
 * Responsável por:
 *  - Inicializar o sistema
 *  - Gerenciar navegação entre telas
 *  - Controlar tema (dark/light)
 *  - Gerenciar modais e toasts
 *  - Fornecer funções utilitárias globais
 *  - Verificar virada automática de mês
 */

'use strict';

// ============================================================
// ESTADO GLOBAL
// ============================================================

const AppState = {
  currentScreen: 'dashboard',
  currentMonth:  '',

  /** Configurações carregadas do banco */
  config: {
    id:             1,
    limiteSemanal:  0,
    tema:           'dark',
    moeda:          'BRL',
    lastProcessedMonth: ''
  }
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================

/**
 * Ponto de entrada da aplicação.
 * Chamado pela autenticação após confirmar uma sessão.
 */
let appInitialization = null;

function initApp(session) {
  if (!session || !session.user) {
    return Promise.reject(new Error('É necessário autenticar antes de iniciar o SmartCash.'));
  }
  // Mantém inclusive falhas: repetir uma inicialização parcial duplicaria eventos.
  if (!appInitialization) appInitialization = initializeApp();
  return appInitialization;
}

async function initializeApp() {
  try {
    // 1. Abre o banco de dados
    await initDB();
    console.log('[SmartCash] Banco de dados pronto.');

    // 2. Carrega configurações salvas
    await loadConfig();

    // 3. Define o mês atual no estado global
    const now = new Date();
    AppState.currentMonth = toMonthString(now);

    // 4. Aplica tema salvo
    applyTheme(AppState.config.tema);

    // 5. Configura eventos de navegação e modais
    setupNavigation();
    setupModals();

    // 6. Atualiza badge de mês no topbar
    updateMonthBadge();

    // 7. Verifica se há virada de mês a processar
    await checkMonthRollover();

    // 8. Carrega a tela inicial (dashboard)
    await navigateTo('dashboard');

    // 9. Registra o Service Worker (PWA)
    registerServiceWorker();

    console.log('[SmartCash] Aplicação inicializada com sucesso.');

  } catch (err) {
    console.error('[SmartCash] Erro crítico na inicialização:', err);
    showToast('Erro ao inicializar o sistema. Recarregue a página.', 'error', 6000);
  }
}

// ============================================================
// CONFIGURAÇÕES
// ============================================================

/**
 * Carrega as configurações do banco.
 * Se não existirem, cria o registro padrão.
 */
async function loadConfig() {
  try {
    const saved = await dbGet('configuracoes', 1);
    if (saved) {
      AppState.config = { ...AppState.config, ...saved };
    } else {
      await dbPut('configuracoes', AppState.config);
    }
  } catch (err) {
    console.warn('[SmartCash] Usando configurações padrão:', err);
  }
}

/**
 * Persiste as configurações no banco.
 */
async function saveConfig() {
  AppState.config.id = 1; // Garante ID fixo
  await dbPut('configuracoes', AppState.config);
}

// ============================================================
// NAVEGAÇÃO
// ============================================================

/**
 * Configura todos os eventos de navegação.
 */
function setupNavigation() {
  // Itens do sidebar (desktop)
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.screen);
      closeSidebar();
    });
    // Acessibilidade: teclado
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigateTo(item.dataset.screen);
        closeSidebar();
      }
    });
  });

  // Itens do bottom nav (mobile)
  document.querySelectorAll('.bottom-nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.screen));
  });

  // Botão hambúrguer (mobile)
  document.getElementById('menuBtn').addEventListener('click', openSidebar);

  // Fechar sidebar
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('overlay').addEventListener('click', closeSidebar);

  // Toggle de tema na sidebar
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}

/**
 * Navega para uma tela, atualiza nav, e carrega os dados.
 * @param {string} screen  ID da tela (ex: 'dashboard')
 */
async function navigateTo(screen) {
  AppState.currentScreen = screen;

  // Atualiza estado ativo na sidebar e bottom nav
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.screen === screen);
  });

  // Alterna visibilidade das telas
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === `screen-${screen}`);
  });

  // Atualiza título da página
  const titles = {
    dashboard:     'Dashboard',
    contas:        'Contas',
    dividas:       'Dívidas',
    patrimonio:    'Patrimônio',
    planejamento:  'Planejamento Semanal',
    configuracoes: 'Configurações'
  };
  document.getElementById('pageTitle').textContent = titles[screen] || screen;

  // Carrega dados da tela
  await loadScreen(screen);
}

/**
 * Chama a função de render de cada tela.
 * @param {string} screen
 */
async function loadScreen(screen) {
  const loaders = {
    dashboard:     renderDashboard,
    contas:        renderContas,
    dividas:       renderDividas,
    patrimonio:    renderPatrimonio,
    planejamento:  renderPlanejamento,
    configuracoes: renderConfiguracoes
  };
  if (loaders[screen]) {
    await loaders[screen]();
  }
}

/** Abre o menu lateral no mobile. */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('active');
}

/** Fecha o menu lateral no mobile. */
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('active');
}

// ============================================================
// TEMA
// ============================================================

/**
 * Aplica o tema ao documento e atualiza o botão.
 * @param {'dark'|'light'} tema
 */
function applyTheme(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.innerHTML = tema === 'dark'
    ? '<span>☀️</span><span>Modo Claro</span>'
    : '<span>🌙</span><span>Modo Escuro</span>';
}

/**
 * Alterna entre dark e light e salva a preferência.
 */
async function toggleTheme() {
  AppState.config.tema = AppState.config.tema === 'dark' ? 'light' : 'dark';
  applyTheme(AppState.config.tema);
  await saveConfig();
  // Atualiza gráficos do dashboard se estiver nele
  if (AppState.currentScreen === 'dashboard') {
    await renderDashboard();
  }
}

// ============================================================
// MODAIS
// ============================================================

/**
 * Configura o comportamento global dos modais:
 * fechar ao clicar fora (backdrop) ou em [data-modal].
 */
function setupModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal(modal.id);
    });
  });

  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
}

/**
 * Abre um modal pelo ID.
 * @param {string} modalId
 */
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

/**
 * Fecha um modal e limpa mensagens de erro.
 * @param {string} modalId
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    modal.querySelectorAll('.field-error').forEach(el => (el.textContent = ''));
  }
}

// ============================================================
// VIRADA AUTOMÁTICA DE MÊS
// ============================================================

/**
 * Verifica se o mês atual já foi processado.
 * Se não foi, processa a virada de mês.
 */
async function checkMonthRollover() {
  const currentMonth  = AppState.currentMonth;
  const lastProcessed = AppState.config.lastProcessedMonth || '';

  if (lastProcessed !== currentMonth) {
    await processMonthRollover(currentMonth);
    AppState.config.lastProcessedMonth = currentMonth;
    await saveConfig();
    console.log(`[SmartCash] Mês processado: ${currentMonth}`);
  }
}

/**
 * Processa a virada de mês:
 *  - Encerra contas parceladas com 0 parcelas restantes
 *  - Mantém contas fixas e parceladas ativas
 * @param {string} currentMonth  Formato "YYYY-MM"
 */
async function processMonthRollover(currentMonth) {
  const contas = await dbGetAll('contas');

  for (const conta of contas) {
    // Ignora contas já encerradas
    if (!conta.ativa) continue;

    // Encerra parceladas que chegaram a 0 parcelas
    if (!conta.fixa && conta.parcelasRestantes !== null && conta.parcelasRestantes <= 0) {
      conta.ativa = false;
      await dbPut('contas', conta);
    }
  }
}

// ============================================================
// UTILITÁRIOS — FORMATAÇÃO
// ============================================================

/**
 * Formata um valor numérico como moeda.
 * @param {number} value
 * @returns {string}  Ex: "R$ 1.200,50"
 */
function formatCurrency(value) {
  const num = Number(value) || 0;
  const symbols = { BRL: 'R$', USD: '$', EUR: '€' };
  const symbol  = symbols[AppState.config.moeda] || 'R$';

  // Formatação BR: ponto para milhar, vírgula para decimal
  const formatted = num.toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${symbol} ${formatted}`;
}

/**
 * Formata uma string de mês "YYYY-MM" em "Junho/2026".
 * @param {string} monthStr
 * @returns {string}
 */
function formatMonth(monthStr) {
  if (!monthStr || !monthStr.includes('-')) return monthStr || '';
  const meses = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
  ];
  const [year, month] = monthStr.split('-');
  return `${meses[parseInt(month, 10) - 1]}/${year}`;
}

/**
 * Formata "YYYY-MM-DD" em "DD/MM/YYYY".
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Converte um Date em "YYYY-MM".
 * @param {Date} date
 * @returns {string}
 */
function toMonthString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Retorna o mês atual do estado global.
 * @returns {string}  Formato "YYYY-MM"
 */
function getCurrentMonth() {
  return AppState.currentMonth;
}

/**
 * Calcula a semana do mês para uma data.
 * Semana 1 = dias 1–7, Semana 2 = 8–14, etc.
 * @param {string} dateStr  Formato "YYYY-MM-DD"
 * @returns {number}  1 a 5
 */
function getWeekOfMonth(dateStr) {
  if (!dateStr) return 1;
  const day = parseInt(dateStr.split('-')[2], 10) || 1;
  return Math.min(Math.ceil(day / 7), 5);
}

// ============================================================
// UTILITÁRIOS — MATEMÁTICA FINANCEIRA
// ============================================================

/**
 * Calcula o Valor Futuro com juros compostos.
 * VF = VP × (1 + i)^n
 * @param {number} vp       Valor presente
 * @param {number} iMensal  Taxa mensal em %
 * @param {number} n        Número de meses
 * @returns {number}
 */
function calcValorFuturo(vp, iMensal, n) {
  if (!vp || !n) return vp || 0;
  const i = (iMensal || 0) / 100;
  return vp * Math.pow(1 + i, n);
}

/**
 * Calcula o Valor Futuro com juros compostos e aportes mensais.
 * VF = VP × (1+i)^n + PMT × [((1+i)^n − 1) / i]
 * @param {number} vp       Valor presente (saldo inicial)
 * @param {number} pmt      Aporte mensal
 * @param {number} iMensal  Taxa mensal em %
 * @param {number} n        Número de meses
 * @returns {number}
 */
function calcValorFuturoComAportes(vp, pmt, iMensal, n) {
  if (n <= 0) return vp || 0;
  const i = (iMensal || 0) / 100;
  if (i === 0) return (vp || 0) + (pmt || 0) * n;
  const fatorVP  = (vp  || 0) * Math.pow(1 + i, n);
  const fatorPMT = (pmt || 0) * ((Math.pow(1 + i, n) - 1) / i);
  return fatorVP + fatorPMT;
}

// ============================================================
// UTILITÁRIOS — UI
// ============================================================

/**
 * Atualiza o badge de mês no topbar.
 */
function updateMonthBadge() {
  const el = document.getElementById('currentMonth');
  if (el) el.textContent = formatMonth(AppState.currentMonth);
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

/**
 * Exibe uma notificação toast temporária.
 * @param {string}  message    Texto da mensagem
 * @param {'success'|'error'|'info'} type
 * @param {number}  duration   Duração em ms (padrão: 3000)
 */
function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span style="font-size:16px">${icons[type] || 'ℹ️'}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Animação de entrada
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  });

  // Remove após a duração
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ============================================================
// DIÁLOGO DE CONFIRMAÇÃO
// ============================================================

/** Callback para o diálogo de confirmação */
let _confirmCallback = null;

/**
 * Exibe um diálogo de confirmação modal.
 * @param {string}   message   Texto de confirmação
 * @param {Function} callback  Executado se confirmar
 */
function showConfirm(message, callback) {
  document.getElementById('confirmMessage').textContent = message;
  _confirmCallback = callback;
  openModal('modalConfirm');

  document.getElementById('btnConfirmOk').onclick = () => {
    closeModal('modalConfirm');
    if (_confirmCallback) _confirmCallback();
    _confirmCallback = null;
  };

  document.getElementById('btnConfirmCancel').onclick = () => {
    closeModal('modalConfirm');
    _confirmCallback = null;
  };
}

// ============================================================
// PWA — SERVICE WORKER
// ============================================================

/**
 * Registra o Service Worker para suporte offline.
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg  => console.log('[SW] Registrado:', reg.scope))
      .catch(err => console.warn('[SW] Falha no registro:', err));
  }
}

// ============================================================
// ENTRADA DA APLICAÇÃO
// ============================================================

// O ponto de entrada é gerenciado por js/auth.js.
