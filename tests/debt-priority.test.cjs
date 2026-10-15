'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function fixture() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', dataset: {},
      children: [], checkValidity: () => true, appendChild(n) { this.children.push(n); } });
    return nodes.get(id);
  };
  const c = vm.createContext({
    document: { getElementById: node, createElement: () => ({ innerHTML: '' }) },
    appSessionEpoch: 1, isCurrentAppSession: epoch => epoch === 1,
    console, formatCurrency: value => `R$ ${value.toFixed(2)}`,
    closeModal() {}, showToast() {}
  });
  // Usa a fórmula real, sem carregá-la de novo ou modificá-la.
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  vm.runInContext(app.match(/function calcValorFuturo\(vp, iMensal, n\) \{[\s\S]*?\n\}/)[0], c);
  const contas = fs.readFileSync(path.join(root, 'js/contas.js'), 'utf8');
  vm.runInContext(contas.match(/function escHtml\(str\) \{[\s\S]*?\n\}/)[0], c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/dividas.js'), 'utf8'), c);
  c.setupFormDivida = () => {}; c.setupSimulador = () => {};
  return { c, node, analyze: rows => c.analisarPrioridadeDividas(rows) };
}
const debt = (id, saldoAtual, jurosMensal, parcelaMinima = 0) =>
  ({ id, nome: `Dívida ${id}`, saldoAtual, jurosMensal, parcelaMinima });
const byId = (rows, id) => rows.find(d => d.id === id);

test('Alta, Média e Baixa: combinação, percentual e menor impacto relativo', () => {
  const f = fixture();
  const rows = f.analyze([debt(1, 1000, 8), debt(2, 2000, 2), debt(3, 500, 1)]);
  assert.deepEqual(Array.from(rows, d => d.prioridade), ['Alta', 'Média', 'Baixa']);
  assert.match(rows[0].justificativa, /taxa elevada.*crescimento em reais/);
  assert.match(rows[1].justificativa, /26\.82%.*limite: 25%/);
  assert.match(rows[2].justificativa, /abaixo da média/);
  assert.equal(rows[0].vf12, f.c.calcValorFuturo(1000, 8, 12));
});

test('destaque relativo pode ser Alta mesmo com juros baixos; empate não força Alta', () => {
  const f = fixture();
  const rows = f.analyze([debt(1, 10000, 1), debt(2, 100, 1)]);
  assert.equal(rows[0].prioridade, 'Alta');
  assert.match(rows[0].justificativa, /60%/);
  assert.doesNotMatch(rows[0].justificativa, /taxa elevada/);
  assert.equal(f.analyze([debt(1, 100, 1), debt(2, 100, 1)])[0].prioridade, 'Média');
});

test('fronteiras inclusivas: taxa 5%, participação 60%, média e percentual 25%', () => {
  const f = fixture();
  assert.equal(f.analyze([debt(1, 100, 4.999)])[0].prioridade, 'Média');
  assert.equal(f.analyze([debt(1, 100, 5)])[0].prioridade, 'Alta');
  // Controla a projeção para testar exatamente as fronteiras do motor,
  // independentemente da representação binária da potência composta.
  f.c.calcValorFuturo = saldo => saldo * 2;
  assert.equal(byId(f.analyze([debt(1, 60, 1), debt(2, 40, 1)]), 1).prioridade, 'Alta');
  assert.equal(byId(f.analyze([debt(1, 59.99, 1), debt(2, 40.01, 1)]), 1).prioridade, 'Média');
  f.c.calcValorFuturo = saldo => saldo * 1.25;
  assert.equal(f.analyze([debt(1, 100, 1)])[0].prioridade, 'Média');
  f.c.calcValorFuturo = saldo => saldo * 1.24999;
  assert.equal(f.analyze([debt(1, 100, 1)])[0].prioridade, 'Baixa');
});

test('precedência e quitação, ausência de crescimento, dívida única e inválidas', () => {
  const f = fixture();
  const rows = f.analyze([debt(1, 1000, 8), debt(2, 0, 99)]);
  assert.equal(rows[0].prioridade, 'Alta');
  assert.deepEqual(Array.from(rows[0].regrasAcionadas), ['R2']);
  assert.equal(rows[1].prioridade, null);
  assert.equal(rows[1].vf12, 0);
  assert.match(rows[1].justificativa, /quitada/);
  assert.equal(f.analyze([debt(1, 100, 1)])[0].prioridade, 'Baixa');
  assert.equal(f.analyze([debt(1, 100, 0), debt(2, 200, 0)])[0].prioridade, 'Baixa');
  for (const d of [debt(1, -1, 2), debt(1, NaN, 2), debt(1, 10, Infinity), debt(1, 1e308, 100)]) {
    assert.equal(f.analyze([d])[0].prioridade, null);
  }
  assert.equal(f.analyze([]).length, 0);
});

test('parcela é contextual, inclusiva e não altera classificação', () => {
  const f = fixture();
  for (const parcela of [0, undefined, -1, NaN, 11]) {
    const d = f.analyze([{ ...debt(1, 1000, 1), parcelaMinima: parcela }])[0];
    assert.equal(d.prioridade, 'Baixa');
    assert.equal(d.observacaoPrioridade, '');
  }
  const d = f.analyze([debt(1, 1000, 1, 10)])[0];
  assert.equal(d.prioridade, 'Baixa');
  assert.match(d.observacaoPrioridade, /não supera os juros/);
  assert.ok(d.regrasAcionadas.includes('R5'));
});

test('determinismo, desempate por ID, independência da ordem e ausência de mutação', () => {
  const f = fixture();
  const input = [debt(3, 100, 1), debt(1, 100, 1), debt(2, 100, 1)];
  const before = JSON.stringify(input);
  input.forEach(Object.freeze); Object.freeze(input);
  const result = JSON.stringify(f.analyze(input));
  assert.equal(JSON.stringify(f.analyze([...input].reverse())), result);
  assert.equal(JSON.stringify(f.analyze(input)), result);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(Array.from(f.analyze(input), d => d.id), [1, 2, 3]);
});

test('aumentar juros ou saldo/crescimento não reduz a própria prioridade com pares fixos', () => {
  const f = fixture();
  const peers = [debt(2, 5000, 2), debt(3, 200, 1)];
  for (const saldo of [10, 100, 1000, 10000]) {
    let previous = 0;
    for (const juros of [0, 1, 2, 4.999, 5, 8, 20]) {
      const d = byId(f.analyze([debt(1, saldo, juros), ...peers]), 1);
      assert.ok(d.nivelPrioridade >= previous);
      previous = d.nivelPrioridade;
    }
  }
  for (const juros of [0, 1, 2, 5, 8]) {
    let previous = 0;
    for (const saldo of [1, 10, 100, 1000, 10000, 100000]) {
      const d = byId(f.analyze([debt(1, saldo, juros), ...peers]), 1);
      assert.ok(d.nivelPrioridade >= previous);
      previous = d.nivelPrioridade;
    }
  }
});

test('amortização confirmada recalcula todas as classes e quitação sai da recomendação', async () => {
  const f = fixture();
  let debts = [debt(1, 10000, 1), debt(2, 1000, 1)];
  f.c.dbGetAll = async () => debts;
  let rendered;
  f.c.renderTabelaDividas = rows => { rendered = rows; };
  await f.c.renderDividas();
  assert.equal(byId(rendered, 1).prioridade, 'Alta');
  assert.match(f.node('recomendacaoDivida').innerHTML, /Dívida 1/);
  const modal = f.node('modalAmortizacaoDivida');
  modal.dataset = { dividaId: '1', saldo: '10000' };
  f.node('amortizacaoData').value = '2026-10-15';
  f.node('amortizacaoValor').value = '9900';
  f.c.dbAmortizarDivida = async (id, data, valor) => {
    debts = debts.map(d => d.id === id ? { ...d, saldoAtual: d.saldoAtual - valor } : d);
  };
  await f.c.salvarAmortizacaoDivida();
  assert.equal(byId(rendered, 1).prioridade, 'Baixa');
  assert.equal(byId(rendered, 2).prioridade, 'Alta');
  assert.match(f.node('recomendacaoDivida').innerHTML, /Dívida 2/);
  modal.dataset.saldo = '100'; f.node('amortizacaoValor').value = '100';
  await f.c.salvarAmortizacaoDivida();
  assert.equal(byId(rendered, 1).prioridade, null);
  assert.doesNotMatch(f.node('recomendacaoDivida').innerHTML, /Dívida 1/);
});

test('renderização apresenta motivos, escapa nome e não impõe sequência de quitação', async () => {
  const f = fixture();
  const rows = f.analyze([{ ...debt(1, 1000, 8), nome: '<script>teste</script>' }, debt(2, 0, 2)]);
  f.c.renderTabelaDividas(rows); f.c.renderRecomendacao(rows);
  const cell = f.node('dividasTableBody').children[0].innerHTML;
  assert.match(cell, /Prioridade Alta/);
  assert.match(cell, /taxa elevada/);
  assert.match(cell, /&lt;script&gt;/);
  assert.doesNotMatch(cell, /<script>/);
  assert.match(f.node('recomendacaoDivida').innerHTML, /a decisão é sua/);
  assert.doesNotMatch(f.node('recomendacaoDivida').innerHTML, /Após quitar|#1 de quitação/);
  f.c.renderRecomendacao(f.analyze([debt(1, 0, 2)]));
  assert.match(f.node('recomendacaoDivida').innerHTML, /Todas as dívidas estão quitadas/);
});
