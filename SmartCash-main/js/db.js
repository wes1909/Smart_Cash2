/**
 * SmartCash — db.js
 * Módulo de Banco de Dados (IndexedDB)
 * -----------------------------------------------
 * Gerencia todas as operações CRUD via IndexedDB.
 * Expõe funções assíncronas baseadas em Promise
 * para uso pelos demais módulos da aplicação.
 */

'use strict';

// ============================================================
// CONSTANTES
// ============================================================
const DB_NAME    = 'smartcashDB';
const DB_VERSION = 2;

/** Referência global à instância do banco */
let db = null;

// ============================================================
// INICIALIZAÇÃO
// ============================================================

/**
 * Abre (ou cria) o banco de dados IndexedDB.
 * Cria todos os object stores necessários no `onupgradeneeded`.
 * @returns {Promise<IDBDatabase>}
 */
function initDB() {
  return new Promise((resolve, reject) => {

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Executado quando o banco é criado ou atualizado
    request.onupgradeneeded = (event) => {
      const idb = event.target.result;

      // ── configuracoes ──────────────────────────────────────
      if (!idb.objectStoreNames.contains('configuracoes')) {
        idb.createObjectStore('configuracoes', { keyPath: 'id' });
      }

      // ── contas ─────────────────────────────────────────────
      if (!idb.objectStoreNames.contains('contas')) {
        const s = idb.createObjectStore('contas', { keyPath: 'id', autoIncrement: true });
        s.createIndex('ativa',    'ativa',    { unique: false });
        s.createIndex('categoria','categoria',{ unique: false });
      }

      // ── pagamentos ─────────────────────────────────────────
      if (!idb.objectStoreNames.contains('pagamentos')) {
        const s = idb.createObjectStore('pagamentos', { keyPath: 'id', autoIncrement: true });
        s.createIndex('contaId',      'contaId',      { unique: false });
        s.createIndex('mesReferencia','mesReferencia',{ unique: false });
      }

      // ── gastos ─────────────────────────────────────────────
      if (!idb.objectStoreNames.contains('gastos')) {
        const s = idb.createObjectStore('gastos', { keyPath: 'id', autoIncrement: true });
        s.createIndex('data',  'data',  { unique: false });
        s.createIndex('semana','semana',{ unique: false });
      }

      // ── ganhos ─────────────────────────────────────────────
      // Lançamentos de renda: cada entrada de dinheiro recebido
      // (salário, bico, freelance, etc.), com data e valor próprios.
      if (!idb.objectStoreNames.contains('ganhos')) {
        const s = idb.createObjectStore('ganhos', { keyPath: 'id', autoIncrement: true });
        s.createIndex('data', 'data', { unique: false });
      }

      // ── dividas ────────────────────────────────────────────
      if (!idb.objectStoreNames.contains('dividas')) {
        idb.createObjectStore('dividas', { keyPath: 'id', autoIncrement: true });
      }

      // ── investimentos ──────────────────────────────────────
      if (!idb.objectStoreNames.contains('investimentos')) {
        idb.createObjectStore('investimentos', { keyPath: 'id', autoIncrement: true });
      }

      // ── reservas ───────────────────────────────────────────
      if (!idb.objectStoreNames.contains('reservas')) {
        const s = idb.createObjectStore('reservas', { keyPath: 'id', autoIncrement: true });
        s.createIndex('mesReferencia','mesReferencia',{ unique: false });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('[DB] Erro ao abrir banco:', event.target.error);
      reject(event.target.error);
    };
  });
}

// ============================================================
// OPERAÇÕES GENÉRICAS
// ============================================================

/**
 * Retorna todos os registros de um store.
 * @param {string} storeName
 * @returns {Promise<Array>}
 */
function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const st  = tx.objectStore(storeName);
    const req = st.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Retorna um registro pelo ID.
 * @param {string} storeName
 * @param {number|string} id
 * @returns {Promise<Object|undefined>}
 */
function dbGet(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const st  = tx.objectStore(storeName);
    const req = st.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Insere ou atualiza um registro (usa `put` — upsert).
 * Se o objeto tiver `id`, atualiza; caso contrário, insere.
 * @param {string} storeName
 * @param {Object} data
 * @returns {Promise<number>} ID do registro
 */
function dbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const st  = tx.objectStore(storeName);
    const req = st.put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Insere um novo registro (sem ID — usa `add`).
 * @param {string} storeName
 * @param {Object} data
 * @returns {Promise<number>} ID gerado
 */
function dbAdd(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const st  = tx.objectStore(storeName);
    const req = st.add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Remove um registro pelo ID.
 * @param {string} storeName
 * @param {number|string} id
 * @returns {Promise<void>}
 */
function dbDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const st  = tx.objectStore(storeName);
    const req = st.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ============================================================
// OPERAÇÕES ESPECÍFICAS
// ============================================================

/**
 * Busca o pagamento de uma conta num determinado mês.
 * @param {number} contaId
 * @param {string} mesReferencia  Formato: "YYYY-MM"
 * @returns {Promise<Object|null>}
 */
function dbGetPagamentoPorContaMes(contaId, mesReferencia) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pagamentos', 'readonly');
    const st    = tx.objectStore('pagamentos');
    const index = st.index('contaId');
    const req   = index.getAll(contaId);

    req.onsuccess = () => {
      const found = (req.result || []).find(p => p.mesReferencia === mesReferencia) || null;
      resolve(found);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Busca todos os pagamentos de um determinado mês.
 * @param {string} mesReferencia  Formato: "YYYY-MM"
 * @returns {Promise<Array>}
 */
function dbGetPagamentosPorMes(mesReferencia) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pagamentos', 'readonly');
    const st    = tx.objectStore('pagamentos');
    const index = st.index('mesReferencia');
    const req   = index.getAll(mesReferencia);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Busca todos os gastos de um determinado mês (filtra pela data).
 * @param {string} mesReferencia  Formato: "YYYY-MM"
 * @returns {Promise<Array>}
 */
function dbGetGastosPorMes(mesReferencia) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('gastos', 'readonly');
    const st  = tx.objectStore('gastos');
    const req = st.getAll();

    req.onsuccess = () => {
      const todos    = req.result || [];
      const filtrado = todos.filter(g => g.data && g.data.startsWith(mesReferencia));
      resolve(filtrado);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Busca todos os ganhos (renda) de um determinado mês (filtra pela data).
 * @param {string} mesReferencia  Formato: "YYYY-MM"
 * @returns {Promise<Array>}
 */
function dbGetGanhosPorMes(mesReferencia) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('ganhos', 'readonly');
    const st  = tx.objectStore('ganhos');
    const req = st.getAll();

    req.onsuccess = () => {
      const todos    = req.result || [];
      const filtrado = todos.filter(g => g.data && g.data.startsWith(mesReferencia));
      resolve(filtrado);
    };
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// UTILITÁRIOS DE MASSA
// ============================================================

/** Lista de todos os stores do banco */
const ALL_STORES = [
  'configuracoes', 'contas', 'pagamentos',
  'gastos', 'ganhos', 'dividas', 'investimentos', 'reservas'
];

/**
 * Limpa todos os dados de todos os stores.
 * @returns {Promise<void>}
 */
function dbClearAll() {
  const promises = ALL_STORES.map(storeName => {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const st  = tx.objectStore(storeName);
      const req = st.clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  });
  return Promise.all(promises);
}

/**
 * Exporta todos os dados do banco em um objeto JSON.
 * @returns {Promise<Object>}
 */
async function dbExportAll() {
  const data = {};
  for (const storeName of ALL_STORES) {
    data[storeName] = await dbGetAll(storeName);
  }
  return data;
}

/**
 * Importa dados para o banco (substitui tudo via `put`).
 * @param {Object} data  Objeto com chaves = nome do store
 * @returns {Promise<void>}
 */
async function dbImportAll(data) {
  await dbClearAll();

  for (const storeName of ALL_STORES) {
    const registros = data[storeName] || [];
    for (const item of registros) {
      try {
        await dbPut(storeName, item);
      } catch (err) {
        console.warn(`[DB] Erro ao importar ${storeName}:`, err);
      }
    }
  }
}
