/** SmartCash — adaptador Supabase; objetos camelCase e IDs numéricos. */
'use strict';

const ALL_STORES = [
  'configuracoes', 'contas', 'pagamentos', 'gastos',
  'ganhos', 'dividas', 'investimentos', 'reservas', 'divida_pagamentos'
];

// Auxiliares encapsulados; as 13 funções públicas permanecem abaixo.
const financialDB = (() => {
  const schemas = {
    configuracoes: {
      limiteSemanal: 'limite_semanal', tema: 'tema', moeda: 'moeda',
      lastProcessedMonth: 'last_processed_month'
    },
    contas: {
      nome: 'nome', categoria: 'categoria', valorParcela: 'valor_parcela',
      fixa: 'fixa', parcelasTotais: 'parcelas_totais',
      parcelasRestantes: 'parcelas_restantes', ativa: 'ativa', dataCriacao: 'data_criacao'
    },
    pagamentos: {
      contaId: 'conta_id', mesReferencia: 'mes_referencia',
      valorPago: 'valor_pago', dataPagamento: 'data_pagamento'
    },
    gastos: { data: 'data', descricao: 'descricao', categoria: 'categoria', semana: 'semana', valor: 'valor' },
    ganhos: { data: 'data', descricao: 'descricao', categoria: 'categoria', valor: 'valor' },
    dividas: { nome: 'nome', saldoAtual: 'saldo_atual', jurosMensal: 'juros_mensal', parcelaMinima: 'parcela_minima' },
    divida_pagamentos: {
      dividaId: 'divida_id', dataPagamento: 'data_pagamento', valor: 'valor', observacao: 'observacao'
    },
    investimentos: {
      nome: 'nome', saldoInicial: 'saldo_inicial', aporteMensal: 'aporte_mensal',
      rentabilidadeMensal: 'rentabilidade_mensal'
    },
    reservas: { mesReferencia: 'mes_referencia', valorGuardado: 'valor_guardado' }
  };
  const numeric = new Set([
    'limiteSemanal', 'valorParcela', 'parcelasTotais', 'parcelasRestantes',
    'contaId', 'dividaId', 'valorPago', 'semana', 'valor', 'saldoAtual', 'jurosMensal',
    'parcelaMinima', 'saldoInicial', 'aporteMensal', 'rentabilidadeMensal', 'valorGuardado'
  ]);
  const nullable = new Set(['parcelasTotais', 'parcelasRestantes', 'contaId', 'observacao']);
  const pageSize = 500;

  function schema(storeName) {
    if (!ALL_STORES.includes(storeName)) throw new Error(`Tabela não permitida: ${storeName}`);
    return schemas[storeName];
  }

  function id(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') ||
        (typeof value === 'string' && !/^\d+$/.test(value))) {
      throw new Error('ID deve ser um inteiro numérico seguro.');
    }
    const result = Number(value);
    if (!Number.isSafeInteger(result)) throw new Error('ID fora do intervalo seguro do JavaScript.');
    return result;
  }

  async function user() {
    if (typeof supabaseClient === 'undefined') throw new Error('Cliente Supabase indisponível.');
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!data?.session?.user?.id) throw new Error('É necessário autenticar para acessar os dados.');
    return data.session.user.id;
  }

  async function assertUser(userId) {
    if (await user() !== userId) throw new Error('A sessão mudou durante a operação.');
  }

  async function execute(query, userId) {
    await assertUser(userId);
    const { data, error } = await query;
    if (error) throw error;
    await assertUser(userId);
    return data;
  }

  function toRow(storeName, data, userId) {
    const fields = schema(storeName);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Registro inválido.');
    const row = { user_id: userId };
    // put substituía o objeto: campos omitidos não devem conservar valores antigos.
    for (const [js, sql] of Object.entries(fields)) row[sql] = data[js] ?? null;
    if (storeName === 'configuracoes') {
      if (data.id != null && id(data.id) !== 1) throw new Error('Configurações devem usar id = 1.');
      row.id = 1;
    } else if (data.id != null) row.id = id(data.id);
    if (row.conta_id != null) row.conta_id = id(row.conta_id);
    if (row.divida_id != null) row.divida_id = id(row.divida_id);
    return row;
  }

  function fromRow(storeName, row) {
    const result = { id: id(row.id) };
    for (const [js, sql] of Object.entries(schema(storeName))) {
      const value = row[sql];
      if (value == null) result[js] = value;
      else if (js === 'contaId' || js === 'dividaId') result[js] = id(value);
      else if (numeric.has(js)) {
        result[js] = Number(value);
        if (!Number.isFinite(result[js])) throw new Error(`Valor numérico inválido: ${js}`);
      } else result[js] = value;
    }
    return result;
  }

  function columns(storeName) {
    return ['id', ...Object.values(schema(storeName))].join(',');
  }

  async function readAll(storeName, userId, filter = query => query) {
    const rows = [];
    // Continua até página vazia, mesmo se o servidor reduzir o tamanho solicitado.
    for (let offset = 0; ; ) {
      let query = supabaseClient.from(storeName).select(columns(storeName)).eq('user_id', userId);
      query = filter(query).order('id', { ascending: true }).range(offset, offset + pageSize - 1);
      const page = await execute(query, userId);
      if (!Array.isArray(page)) throw new Error('Resposta de listagem inválida.');
      if (!page.length) return rows;
      rows.push(...page.map(row => fromRow(storeName, row)));
      offset += page.length;
    }
  }

  async function write(storeName, data, userId, addOnly = false) {
    const row = toRow(storeName, data, userId);
    let query = supabaseClient.from(storeName);
    query = addOnly || row.id == null
      ? query.insert(row)
      : query.upsert(row, { onConflict: storeName === 'configuracoes' ? 'user_id,id' : 'id' });
    const saved = await execute(query.select('id').eq('user_id', userId).single(), userId);
    return id(saved.id);
  }

  async function clear(userId) {
    // Históricos primeiro, inclusive a FK de dívidas com ON DELETE RESTRICT.
    for (const storeName of ['divida_pagamentos', 'pagamentos',
      ...ALL_STORES.filter(name => !['pagamentos', 'divida_pagamentos'].includes(name))]) {
      await execute(supabaseClient.from(storeName).delete().eq('user_id', userId), userId);
    }
    // Compatibilidade com o Promise.all da versão IndexedDB.
    return ALL_STORES.map(() => undefined);
  }

  function monthBounds(month) {
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new Error('Mês de referência deve estar no formato YYYY-MM.');
    }
    const [year, number] = month.split('-').map(Number);
    const next = number === 12
      ? `${String(year + 1).padStart(4, '0')}-01`
      : `${String(year).padStart(4, '0')}-${String(number + 1).padStart(2, '0')}`;
    return [month + '-01', next + '-01'];
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validateBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !ALL_STORES.some(name => Array.isArray(data[name]))) throw new Error('Backup inválido.');
    const prepared = {};
    for (const storeName of ALL_STORES) {
      const records = data[storeName] === undefined ? [] : data[storeName];
      if (!Array.isArray(records)) throw new Error(`Lista inválida no backup: ${storeName}`);
      if (storeName === 'configuracoes' && records.length > 1) throw new Error('Backup contém configurações duplicadas.');
      const seen = new Set();
      prepared[storeName] = records.map(record => {
        const row = toRow(storeName, record, '');
        if (record.id != null) {
          const oldId = id(record.id);
          if (seen.has(oldId)) throw new Error(`ID duplicado no backup: ${storeName}/${oldId}`);
          seen.add(oldId);
        } else if (storeName === 'contas' || storeName === 'dividas') {
          throw new Error(`Registro sem ID no backup: ${storeName}`);
        }
        const copy = {};
        for (const [js, sql] of Object.entries(schema(storeName))) {
          const value = row[sql];
          if (value == null && nullable.has(js)) copy[js] = null;
          else if (numeric.has(js)) {
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Número inválido: ${storeName}.${js}`);
            if (['parcelasTotais', 'parcelasRestantes', 'semana'].includes(js) && !Number.isInteger(value)) {
              throw new Error(`Inteiro inválido: ${storeName}.${js}`);
            }
            copy[js] = value;
          } else if (js === 'fixa' || js === 'ativa') {
            if (typeof value !== 'boolean') throw new Error(`Booleano inválido: ${storeName}.${js}`);
            copy[js] = value;
          } else {
            if (typeof value !== 'string') throw new Error(`Texto inválido: ${storeName}.${js}`);
            if (js === 'mesReferencia') monthBounds(value);
            if (['data', 'dataCriacao', 'dataPagamento'].includes(js) && !validDate(value)) {
              throw new Error(`Data inválida: ${storeName}.${js}`);
            }
            copy[js] = value;
          }
        }
        // IDs antigos servem apenas para o mapa; nunca são gravados nas tabelas financeiras.
        return { oldId: record.id == null ? null : id(record.id), data: copy };
      });
    }
    const debtIds = new Set(prepared.dividas.map(item => item.oldId));
    for (const item of prepared.divida_pagamentos) {
      if (!debtIds.has(item.data.dividaId)) throw new Error('Amortização sem dívida correspondente no backup.');
      if (item.data.valor <= 0) throw new Error('Amortização inválida no backup.');
    }
    return prepared;
  }

  return { schema, id, user, execute, columns, fromRow, readAll, write, clear, monthBounds, validDate, validateBackup };
})();

/** Inicializa o adaptador; o chamador atual apenas aguarda sua conclusão. */
async function initDB() {
  await financialDB.user();
  return supabaseClient;
}

/** @returns {Promise<Array>} */
async function dbGetAll(storeName) {
  financialDB.schema(storeName);
  return financialDB.readAll(storeName, await financialDB.user());
}

/** @returns {Promise<Object|undefined>} */
async function dbGet(storeName, id) {
  financialDB.schema(storeName);
  const userId = await financialDB.user();
  const row = await financialDB.execute(
    supabaseClient.from(storeName).select(financialDB.columns(storeName))
      .eq('user_id', userId).eq('id', financialDB.id(id)).maybeSingle(), userId
  );
  return row ? financialDB.fromRow(storeName, row) : undefined;
}

/** Insere ou substitui os campos financeiros. @returns {Promise<number>} */
async function dbPut(storeName, data) {
  return financialDB.write(storeName, data, await financialDB.user());
}

/** Insere exclusivamente; chaves duplicadas rejeitam. @returns {Promise<number>} */
async function dbAdd(storeName, data) {
  return financialDB.write(storeName, data, await financialDB.user(), true);
}

/** A FK ON DELETE SET NULL preserva pagamentos ao excluir contas. @returns {Promise<void>} */
async function dbDelete(storeName, id) {
  financialDB.schema(storeName);
  const userId = await financialDB.user();
  await financialDB.execute(
    supabaseClient.from(storeName).delete().eq('user_id', userId).eq('id', financialDB.id(id)), userId
  );
}

/** @returns {Promise<Object|null>} */
async function dbGetPagamentoPorContaMes(contaId, mesReferencia) {
  const userId = await financialDB.user();
  const row = await financialDB.execute(
    supabaseClient.from('pagamentos').select(financialDB.columns('pagamentos'))
      .eq('user_id', userId).eq('conta_id', financialDB.id(contaId))
      .eq('mes_referencia', mesReferencia).order('id', { ascending: true }).limit(1).maybeSingle(), userId
  );
  return row ? financialDB.fromRow('pagamentos', row) : null;
}

/** @returns {Promise<Array>} */
async function dbGetPagamentosPorMes(mesReferencia) {
  return financialDB.readAll('pagamentos', await financialDB.user(), query => query.eq('mes_referencia', mesReferencia));
}

/** Datas SQL são comparadas sem conversão de fuso. @returns {Promise<Array>} */
async function dbGetGastosPorMes(mesReferencia) {
  const [start, end] = financialDB.monthBounds(mesReferencia);
  return financialDB.readAll('gastos', await financialDB.user(), query => query.gte('data', start).lt('data', end));
}

/** @returns {Promise<Array>} */
async function dbGetGanhosPorMes(mesReferencia) {
  const [start, end] = financialDB.monthBounds(mesReferencia);
  return financialDB.readAll('ganhos', await financialDB.user(), query => query.gte('data', start).lt('data', end));
}

/** Limpa exclusivamente as tabelas do usuário atual. */
async function dbClearAll() {
  return financialDB.clear(await financialDB.user());
}

/** @returns {Promise<Object>} */
async function dbExportAll() {
  const userId = await financialDB.user();
  const data = {};
  for (const storeName of ALL_STORES) data[storeName] = await financialDB.readAll(storeName, userId);
  return data;
}

/** Valida antes da limpeza, gera novos IDs e remapeia contaId. @returns {Promise<void>} */
async function dbImportAll(data) {
  const userId = await financialDB.user();
  const prepared = financialDB.validateBackup(data);
  await financialDB.clear(userId);
  const accountIds = new Map();
  for (const item of prepared.contas) {
    accountIds.set(item.oldId, await financialDB.write('contas', item.data, userId, true));
  }
  const debtIds = new Map();
  for (const item of prepared.dividas) {
    debtIds.set(item.oldId, await financialDB.write('dividas', item.data, userId, true));
  }
  for (const storeName of ALL_STORES.filter(name => !['contas', 'dividas'].includes(name))) {
    for (const item of prepared[storeName]) {
      const record = { ...item.data };
      if (storeName === 'pagamentos') record.contaId = accountIds.get(record.contaId) ?? null;
      // Importa o histórico diretamente; o saldo do backup já inclui as amortizações.
      if (storeName === 'divida_pagamentos') record.dividaId = debtIds.get(record.dividaId);
      if (storeName === 'configuracoes') record.id = 1;
      await financialDB.write(storeName, record, userId, true);
    }
  }
}

/** Histórico somente do usuário e da dívida solicitada, mais recente primeiro. */
async function dbGetPagamentosPorDivida(dividaId) {
  const debtId = financialDB.id(dividaId);
  const rows = await financialDB.readAll('divida_pagamentos', await financialDB.user(),
    query => query.eq('divida_id', debtId));
  return rows.sort((a, b) => b.dataPagamento.localeCompare(a.dataPagamento) || b.id - a.id);
}

/** A RPC registra o histórico e reduz o saldo em uma única transação. */
async function dbAmortizarDivida(dividaId, dataPagamento, valor, observacao) {
  const userId = await financialDB.user();
  const debtId = financialDB.id(dividaId);
  if (!financialDB.validDate(dataPagamento)) throw new Error('Data de amortização inválida.');
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
    throw new Error('A amortização deve ser maior que zero.');
  }
  if (observacao != null && typeof observacao !== 'string') throw new Error('Observação inválida.');
  // O proprietário é determinado no servidor pela sessão, não por um argumento livre.
  return financialDB.execute(supabaseClient.rpc('amortizar_divida', {
    p_divida_id: debtId,
    p_data_pagamento: dataPagamento,
    p_valor: valor,
    p_observacao: observacao?.trim() || null
  }), userId);
}
