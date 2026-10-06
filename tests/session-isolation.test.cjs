'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'SmartCash-main');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appMarkup = html.split('<div id="appContainer" hidden>')[1].split('</div><!-- appContainer -->')[0];
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise(done => setTimeout(done, 0));
};

// DOM mínimo: recriar innerHTML substitui nós e seus listeners, como no navegador.
function fixture(initialUser = 'A') {
  const nodes = new Map();
  class Element {
    constructor(id) {
      this.id = id; this.value = ''; this.textContent = ''; this._html = '';
      this.hidden = false; this.disabled = false; this.listeners = {}; this.children = [];
      this.style = {}; this.dataset = {};
      const classes = new Set();
      this.classList = {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle: (name, value) => value ? classes.add(name) : classes.delete(name)
      };
      this.parentElement = { innerHTML: '' };
    }
    set innerHTML(value) {
      this._html = value;
      if (this.id === 'appContainer') {
        for (const match of value.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], new Element(match[1]));
      }
    }
    get innerHTML() { return this._html; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    async emit(type, event = {}) {
      await Promise.all((this.listeners[type] || []).map(callback => callback({ target: this, preventDefault() {}, ...event })));
    }
    closest(selector) { return selector === '#' + this.id ? this : null; }
    querySelectorAll() { return []; }
    setAttribute() {}
    checkValidity() { return this.validity !== false; }
    appendChild(node) { this.children.push(node); }
    replaceChildren() { this.children = []; }
    focus() {}
    remove() {}
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], new Element(match[1]));
  nodes.get('appContainer').innerHTML = appMarkup;
  nodes.get('appContainer').hidden = true;
  const domListeners = {};
  const document = {
    getElementById: id => nodes.get(id) || null,
    querySelectorAll: () => [], createElement: () => new Element(''),
    documentElement: { setAttribute() {}, getAttribute: () => 'dark' },
    addEventListener: (type, callback) => { domListeners[type] = callback; }
  };
  let currentUser = initialUser, authCallback, chartDestroyed = 0, initCount = 0;
  const session = () => currentUser ? { user: { id: currentUser } } : null;
  const configs = {
    A: { id: 1, tema: 'dark', moeda: 'BRL', limiteSemanal: 111 },
    B: { id: 1, tema: 'light', moeda: 'EUR', limiteSemanal: 222 }
  };
  const c = vm.createContext({
    document, console: { log() {}, warn() {}, error() {} }, navigator: {},
    window: { dispatchEvent() {} }, Event: class {},
    requestAnimationFrame: () => 0, setTimeout, clearTimeout,
    Chart: class { destroy() { chartDestroyed++; } },
    initDB: async () => { initCount++; },
    dbGet: async () => configs[currentUser], dbPut: async () => 1,
    dbGetAll: async () => [], dbGetPagamentosPorMes: async () => [],
    dbGetGastosPorMes: async () => [],
    dbGetGanhosPorMes: async () => [{ id: 1, data: '2026-10-06', descricao: currentUser, categoria: 'Other', valor: 10 }],
    supabaseClient: { auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      onAuthStateChange: callback => { authCallback = callback; },
      signOut: async () => { currentUser = null; authCallback('SIGNED_OUT', null); return { error: null }; }
    } }
  });
  for (const file of ['app', 'dashboard', 'contas', 'dividas', 'patrimonio', 'planejamento', 'configuracoes']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c);
  }
  return {
    c, nodes, evaluate: code => vm.runInContext(code, c), session,
    switchUser(id) { currentUser = id; if (authCallback) authCallback(id ? 'SIGNED_IN' : 'SIGNED_OUT', session()); },
    startAuth() { vm.runInContext(fs.readFileSync(path.join(root, 'js', 'auth.js'), 'utf8'), c); domListeners.DOMContentLoaded(); },
    get initCount() { return initCount; }, get chartDestroyed() { return chartDestroyed; }
  };
}

test('logout limpa estado, gráficos, formulários, confirmação e promessa; B reinicializa', async () => {
  const f = fixture();
  const first = f.c.initApp(f.session());
  assert.equal(f.c.initApp(f.session()), first);
  await first;
  const oldInput = f.nodes.get('contaNome'); oldInput.value = 'PRIVATE A';
  f.c.showConfirm('PRIVATE A', () => assert.fail('old confirmation executed'));
  const oldConfirmation = f.nodes.get('btnConfirmOk').onclick;
  f.evaluate('AppState.extra = ["PRIVATE A"]');
  const destroyedBefore = f.chartDestroyed;
  f.c.resetAppSession();
  assert.equal(f.nodes.get('appContainer').hidden, true);
  assert.equal(f.evaluate('appInitialization'), null);
  assert.equal(f.evaluate('appUserId'), null);
  assert.equal(f.evaluate('AppState.currentMonth'), '');
  assert.equal(f.evaluate('AppState.config.limiteSemanal'), 0);
  assert.equal(f.evaluate('AppState.extra'), undefined);
  assert.equal(f.evaluate('_confirmCallback'), null);
  assert.equal(f.evaluate('_chartPizza === null && _chartBarras === null && _chartLinha === null'), true);
  assert.ok(f.chartDestroyed > destroyedBefore);
  assert.notEqual(f.nodes.get('contaNome'), oldInput);
  assert.equal(f.nodes.get('contaNome').value, '');
  oldConfirmation();
  f.switchUser('B');
  const second = f.c.initApp(f.session()); assert.notEqual(second, first); await second;
  assert.equal(f.evaluate('AppState.config.moeda'), 'EUR');
  assert.equal(f.evaluate('AppState.config.limiteSemanal'), 222);
  assert.equal(f.initCount, 2);
});

test('configuração e render pendentes de A não sobrescrevem B', async () => {
  const f = fixture(); const config = deferred();
  const readConfig = f.c.dbGet;
  f.c.dbGet = () => config.promise;
  const oldInit = f.c.initApp(f.session());
  await flush();
  f.switchUser('B'); f.c.dbGet = readConfig;
  await f.c.initApp(f.session());
  config.resolve({ id: 1, moeda: 'USD', limiteSemanal: 999 }); await oldInit;
  assert.equal(f.evaluate('AppState.config.moeda'), 'EUR');
  f.switchUser('A'); await f.c.initApp(f.session());
  const payments = deferred(); f.c.dbGetPagamentosPorMes = () => payments.promise;
  const oldRender = f.c.renderContas();
  f.switchUser('B'); f.c.dbGetPagamentosPorMes = async () => [];
  await f.c.initApp(f.session());
  const table = f.nodes.get('contasTableBody'); table.innerHTML = 'B ONLY';
  payments.resolve([]); await oldRender;
  assert.equal(table.innerHTML, 'B ONLY');
});

test('edição e leitura de backup pendentes são invalidadas no logout', async () => {
  const f = fixture(); await f.c.initApp(f.session());
  const account = deferred(); f.c.dbGet = () => account.promise;
  const editing = f.c.abrirModalPagamento(1);
  let reader;
  f.c.FileReader = class {
    constructor() { reader = this; this.readyState = 0; }
    readAsText() { this.readyState = 1; }
    abort() { this.readyState = 2; this.aborted = true; }
  };
  f.c.importarBackup({ target: { files: [{}], value: 'backup.json' } });
  f.c.resetAppSession();
  account.resolve({ nome: 'PRIVATE A', valorParcela: 100 }); await editing;
  assert.equal(f.nodes.get('modalPagamento').classList.contains('active'), false);
  assert.equal(f.nodes.get('pagInfoBox').textContent, '');
  assert.equal(reader.aborted, true); assert.equal(reader.onload, null);
});

test('auth oculta imediatamente, aceita novo botão de logout e preserva renovação do mesmo usuário', async () => {
  const f = fixture(); f.startAuth(); await flush();
  assert.equal(f.nodes.get('appContainer').hidden, false);
  const initialCount = f.initCount;
  f.switchUser('A'); await flush(); assert.equal(f.initCount, initialCount);
  const app = f.nodes.get('appContainer');
  const loggingOut = app.emit('click', { target: f.nodes.get('btnLogout') });
  assert.equal(app.hidden, true); assert.equal(f.evaluate('AppState.currentMonth'), '');
  await loggingOut; await flush();
  f.switchUser('B'); assert.equal(app.hidden, true); await flush();
  assert.equal(app.hidden, false); assert.equal(f.evaluate('AppState.config.moeda'), 'EUR');
  assert.equal(app.listeners.click.length, 1);
  await app.emit('click', { target: f.nodes.get('btnLogout') }); await flush();
  assert.equal(app.hidden, true); assert.equal(f.evaluate('appUserId'), null);
});

test('amortização valida limites, prévia, confirmação e bloqueia duplicidade', async () => {
  const f = fixture(); await f.c.initApp(f.session());
  const debt = { id: 10, nome: 'Cartão', saldoAtual: 100, jurosMensal: 2, parcelaMinima: 10 };
  f.c.dbGet = async () => ({ ...debt });
  let renders = 0, rpcCalls = 0;
  f.c.renderDividas = async () => { renders++; };
  const sending = deferred();
  f.c.dbAmortizarDivida = async (id, date, value, observation) => {
    rpcCalls++; assert.equal(id, 10); assert.equal(date, '2026-10-06');
    assert.equal(value, 100); assert.equal(observation, 'Extra');
    await sending.promise; debt.saldoAtual -= value;
  };
  await f.c.abrirAmortizacaoDivida(10);
  f.nodes.get('amortizacaoData').value = '2026-10-06';
  const value = f.nodes.get('amortizacaoValor');
  for (const invalid of ['0', '-1', '101', 'NaN']) {
    value.value = invalid; await f.c.salvarAmortizacaoDivida(); assert.equal(rpcCalls, 0);
  }
  value.value = '25'; f.c.atualizarSaldoAmortizacao();
  assert.equal(f.nodes.get('amortizacaoSaldoPrevisto').textContent, 'R$ 75,00');
  value.value = '100'; f.nodes.get('amortizacaoObservacao').value = ' Extra ';
  const request = f.c.salvarAmortizacaoDivida();
  assert.equal(f.nodes.get('btnSalvarAmortizacao').disabled, true);
  await f.c.salvarAmortizacaoDivida(); assert.equal(rpcCalls, 1);
  sending.resolve(); await request;
  assert.equal(debt.saldoAtual, 0); assert.equal(renders, 1);
  assert.equal(f.nodes.get('modalAmortizacaoDivida').classList.contains('active'), false);
  await f.c.abrirAmortizacaoDivida(10); assert.equal(rpcCalls, 1);
});

test('quitadas ficam abaixo, não recebem prioridade; exclusão preserva histórico', async () => {
  const f = fixture(); await f.c.initApp(f.session());
  const settled = { id: 10, nome: 'Quitada', saldoAtual: 0, jurosMensal: 2, parcelaMinima: 10 };
  const active = { id: 11, nome: 'Ativa', saldoAtual: 100, jurosMensal: 2, parcelaMinima: 10 };
  f.c.dbGetAll = async () => [settled, active];
  let ordered;
  f.c.renderTabelaDividas = rows => { ordered = rows; };
  await f.c.renderDividas();
  assert.deepEqual(Array.from(ordered, d => d.id), [11, 10]);
  assert.equal(ordered[0].vf12, 100 * Math.pow(1.02, 12));
  assert.equal(ordered[1].vf12, 0);
  assert.equal(f.nodes.get('recomendacaoDivida').innerHTML.includes('Após quitar'), false);
  f.c.renderRecomendacao([settled]);
  assert.match(f.nodes.get('recomendacaoDivida').innerHTML, /Todas as dívidas estão quitadas/);
  let deleted = 0; f.c.dbDelete = async () => { deleted++; };
  f.c.dbGetPagamentosPorDivida = async () => [{ id: 1 }];
  await f.c.excluirDivida(10); assert.equal(deleted, 0);
  assert.equal(f.evaluate('_confirmCallback'), null);
});

test('saldo zero somente na edição de quitada; histórico escapa observações e respeita logout', async () => {
  const f = fixture(); await f.c.initApp(f.session());
  let writes = 0; f.c.dbPut = async () => { writes++; }; f.c.renderDividas = async () => {};
  f.c.abrirFormDivida();
  f.nodes.get('dividaNome').value = 'Teste'; f.nodes.get('dividaSaldo').value = '0'; f.nodes.get('dividaJuros').value = '2';
  await f.c.salvarDivida(); assert.equal(writes, 0);
  const settled = { id: 10, nome: 'Quitada', saldoAtual: 0, jurosMensal: 2, parcelaMinima: 10 };
  f.c.dbGet = async () => settled; f.c.abrirFormDivida(settled);
  await f.c.salvarDivida(); assert.equal(writes, 1);
  f.c.dbGetPagamentosPorDivida = async () => [{ id: 1, dataPagamento: '2026-10-06', valor: 100, observacao: '<script>bad</script>' }];
  await f.c.abrirHistoricoDivida(10);
  assert.match(f.nodes.get('historicoDividaBody').innerHTML, /&lt;script&gt;/);
  const pending = deferred(); f.c.dbGetPagamentosPorDivida = () => pending.promise;
  const history = f.c.abrirHistoricoDivida(10);
  f.c.resetAppSession(); pending.resolve([]); await history;
  assert.equal(f.nodes.get('historicoDividaBody').innerHTML, '');
});

test('erro de RPC mantém modal aberto sem sucesso; resposta após logout não renderiza', async () => {
  const f = fixture(); await f.c.initApp(f.session());
  f.c.dbGet = async () => ({ id: 10, nome: 'Debt', saldoAtual: 100 });
  await f.c.abrirAmortizacaoDivida(10);
  f.nodes.get('amortizacaoData').value = '2026-10-06'; f.nodes.get('amortizacaoValor').value = '25';
  let rendered = 0; f.c.renderDividas = async () => { rendered++; };
  f.c.dbAmortizarDivida = async () => { throw Error('remote'); };
  await f.c.salvarAmortizacaoDivida();
  assert.equal(f.nodes.get('modalAmortizacaoDivida').classList.contains('active'), true);
  assert.equal(f.nodes.get('btnSalvarAmortizacao').disabled, false);
  assert.equal(rendered, 0);
  assert.match(f.nodes.get('errAmortizacao').textContent, /Não foi possível confirmar/);
  const pending = deferred(); f.c.dbAmortizarDivida = () => pending.promise;
  const request = f.c.salvarAmortizacaoDivida(); f.c.resetAppSession(); pending.resolve(); await request;
  assert.equal(rendered, 0); assert.equal(f.nodes.get('errAmortizacao').textContent, '');
});
