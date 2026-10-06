'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../SmartCash-main/js/db.js'), 'utf8');

function fixture() {
  const names = ['configuracoes','contas','pagamentos','gastos','ganhos','dividas','investimentos','reservas','divida_pagamentos'];
  const tables = Object.fromEntries(names.map(n => [n, []]));
  const calls = [];
  let user = 'A', sequence = 100, failure = null;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.op = 'read'; }
    select(cols) { this.cols = cols; return this; }
    eq(k,v) { this.filters.push(r => r[k] === v); return this; }
    order() { return this; }
    range(start) { this.start = start; return this; }
    single() { this.one = true; return this; }
    insert(row) { this.row = {...row}; this.op = 'insert'; return this; }
    upsert(row) { this.row = {...row}; this.op = 'insert'; return this; }
    delete() { this.op = 'delete'; return this; }
    then(ok,bad) {
      return Promise.resolve().then(() => {
        calls.push([this.op, this.table]);
        if (failure) { const error = failure; failure = null; return {data:null,error}; }
        let rows = tables[this.table];
        if (this.op === 'delete') {
          const selected = rows.filter(r => this.filters.every(f => f(r)));
          if (this.table === 'dividas' && tables.divida_pagamentos.some(p => selected.some(d => d.id === p.divida_id))) {
            return {data:null,error:Object.assign(Error('restrict'),{code:'23503'})};
          }
          tables[this.table] = rows.filter(r => !selected.includes(r));
          return {data:null,error:null};
        }
        if (this.op === 'insert') {
          assert.equal(this.row.user_id, user);
          const row = {...this.row, id:this.row.id ?? sequence++};
          if (this.table === 'divida_pagamentos') assert.ok(tables.dividas.some(d => d.id === row.divida_id && d.user_id === row.user_id));
          rows.push(row); rows = [row];
        }
        rows = rows.filter(r => this.filters.every(f => f(r))).sort((a,b) => a.id-b.id);
        if (this.start != null) rows = rows.slice(this.start, this.start+2);
        if (this.cols) rows = rows.map(r => Object.fromEntries(this.cols.split(',').map(k => [k,r[k]])));
        return {data:this.one ? rows[0] : rows,error:null};
      }).then(ok,bad);
    }
  }
  const client = {
    auth: {getSession:async () => ({data:{session:user ? {user:{id:user}} : null},error:null})},
    from:name => new Query(name),
    rpc:(name,args) => ({then(ok,bad) {
      return Promise.resolve().then(() => {
        calls.push(['rpc', name, args]);
        if (failure) {const error=failure;failure=null;return {data:null,error};}
        const d=tables.dividas.find(d => d.id===args.p_divida_id && d.user_id===user);
        if (!d || d.saldo_atual<=0 || args.p_valor>d.saldo_atual) return {data:null,error:Error('invalid balance')};
        d.saldo_atual-=args.p_valor;
        tables.divida_pagamentos.push({id:sequence++,user_id:user,divida_id:d.id,data_pagamento:args.p_data_pagamento,valor:args.p_valor,observacao:args.p_observacao});
        return {data:{saldo_atual:d.saldo_atual},error:null};
      }).then(ok,bad);
    }})
  };
  const c=vm.createContext({supabaseClient:client});vm.runInContext(source,c);
  return {c,tables,calls,setUser:id=>{user=id;},fail:error=>{failure=error;}};
}

test('RPC usa assinatura exata, rejeita erros e não realiza gravações paralelas de saldo', async () => {
  const f=fixture();
  f.tables.dividas.push({id:10,user_id:'A',nome:'Debt',saldo_atual:100,juros_mensal:2,parcela_minima:10});
  await f.c.dbAmortizarDivida(10,'2026-10-06',25,' Extra ');
  const args=f.calls[0][2];
  assert.equal(f.calls[0][1],'amortizar_divida');
  assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_divida_id:10,p_data_pagamento:'2026-10-06',p_valor:25,p_observacao:'Extra'});
  assert.equal(f.tables.dividas[0].saldo_atual,75);
  assert.equal(f.calls.filter(c=>c[0]==='insert').length,0);
  await assert.rejects(f.c.dbAmortizarDivida(10,'2026-10-06',76));
  assert.equal(f.tables.dividas[0].saldo_atual,75);
  await f.c.dbAmortizarDivida(10,'2026-10-06',75);
  assert.equal(f.tables.dividas[0].saldo_atual,0);
  assert.equal(f.tables.divida_pagamentos[1].observacao,null);
  await assert.rejects(f.c.dbAmortizarDivida(10,'2026-10-06',1));
  const error=Error('remote');f.fail(error);
  await assert.rejects(f.c.dbAmortizarDivida(10,'2026-10-06',1),e=>e===error);
  await assert.rejects(f.c.dbAmortizarDivida(10,'2026-02-30',1));
  await assert.rejects(f.c.dbAmortizarDivida(10,'2026-10-06',0));
  f.setUser(null);await assert.rejects(f.c.dbAmortizarDivida(10,'2026-10-06',1));
});

test('histórico retorna camelCase, filtra usuário/dívida, pagina e ordena data/ID decrescentes', async () => {
  const f=fixture();
  f.tables.divida_pagamentos.push(...[
    [1,'A',10,'2026-10-05'],[3,'A',10,'2026-10-06'],[2,'A',10,'2026-10-06'],
    [4,'B',10,'2026-10-07'],[5,'A',11,'2026-10-08']
  ].map(([id,user_id,divida_id,data_pagamento])=>({id,user_id,divida_id,data_pagamento,valor:'10.50',observacao:null})));
  const result=await f.c.dbGetPagamentosPorDivida(10);
  assert.deepEqual(Array.from(result,p=>p.id),[3,2,1]);
  assert.equal(result[0].dividaId,10);assert.equal(result[0].dataPagamento,'2026-10-06');assert.equal(result[0].valor,10.5);
  assert.equal('user_id' in result[0],false);
});

test('backup remapeia dívidas e preserva saldo, aceita backup antigo e limpa filhos antes dos pais', async () => {
  const f=fixture();
  f.tables.dividas.push({id:90,user_id:'B',nome:'Other',saldo_atual:50,juros_mensal:2,parcela_minima:0});
  f.tables.divida_pagamentos.push({id:91,user_id:'B',divida_id:90,data_pagamento:'2026-10-06',valor:10,observacao:null});
  const backup={dividas:[{id:1,nome:'Debt',saldoAtual:75,jurosMensal:2,parcelaMinima:0}],
    divida_pagamentos:[{id:1,dividaId:1,dataPagamento:'2026-10-06',valor:25,observacao:null}]};
  await f.c.dbImportAll(backup);
  const debt=f.tables.dividas.find(d=>d.user_id==='A'),payment=f.tables.divida_pagamentos.find(p=>p.user_id==='A');
  assert.notEqual(debt.id,1);assert.equal(payment.divida_id,debt.id);assert.equal(debt.saldo_atual,75);
  assert.equal(f.calls.some(c=>c[0]==='rpc'),false);
  assert.ok(f.calls.findIndex(c=>c[0]==='delete'&&c[1]==='divida_pagamentos') < f.calls.findIndex(c=>c[0]==='delete'&&c[1]==='dividas'));
  const exported=await f.c.dbExportAll();assert.equal(exported.divida_pagamentos[0].dividaId,debt.id);
  const before=f.calls.length;
  await assert.rejects(f.c.dbImportAll({...backup,divida_pagamentos:[{...backup.divida_pagamentos[0],dividaId:999}]}));
  assert.equal(f.calls.length,before);
  await f.c.dbImportAll({dividas:backup.dividas});
  assert.equal(f.tables.divida_pagamentos.filter(p=>p.user_id==='A').length,0);
  assert.equal(f.tables.divida_pagamentos.filter(p=>p.user_id==='B').length,1);
  assert.equal(backup.divida_pagamentos[0].dividaId,1);
});
