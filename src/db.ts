import { blankMaster, defaultMaps } from './lib/defaults';
import type { BackupFile, DailyRecord, Master, PeriodStr, Statement } from './lib/types';

// 端末内保存（IndexedDB）。外部サーバーには一切送らない。
// ストア：records（キー=日付）、statements（キー=支給対象月）、kv（キー='master'）

const DB_NAME = 'driver-pay-check';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('statements')) db.createObjectStore('statements', { keyPath: 'period' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : (undefined as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function loadMaster(): Promise<Master> {
  const m = await tx<Master | undefined>('kv', 'readonly', (s) => s.get('master'));
  if (m) return withDefaults(m);
  const fresh = blankMaster();
  await saveMaster(fresh);
  return fresh;
}

/** 後から増えた設定項目を補う（古い版で作ったデータでも動くように） */
export function withDefaults(m: Master): Master {
  return { ...m, setupDone: m.setupDone ?? true, maps: { ...defaultMaps(), ...(m.maps ?? {}) } };
}

export const saveMaster = (m: Master) => tx('kv', 'readwrite', (s) => s.put(m, 'master'));

export const loadRecords = () => tx<DailyRecord[]>('records', 'readonly', (s) => s.getAll());
export const saveRecord = (r: DailyRecord) => tx('records', 'readwrite', (s) => s.put(r));
export const deleteRecord = (date: string) => tx('records', 'readwrite', (s) => s.delete(date));

export const loadStatements = () => tx<Statement[]>('statements', 'readonly', (s) => s.getAll());
export const saveStatement = (st: Statement) => tx('statements', 'readwrite', (s) => s.put(st));
export const deleteStatement = (p: PeriodStr) => tx('statements', 'readwrite', (s) => s.delete(p));

export async function exportAll(): Promise<BackupFile> {
  const [master, records, statements] = await Promise.all([loadMaster(), loadRecords(), loadStatements()]);
  // APIキーはファイルに入れない（ファイルを人に渡しても悪用されないように）
  const safe = { ...master, maps: { ...master.maps, apiKey: '' } };
  return { app: 'driver-pay-check', schemaVersion: 1, exportedAt: new Date().toISOString(), master: safe, records, statements };
}

/** バックアップから全部置き換える（1つのトランザクションで、途中失敗なら何も変わらない） */
export async function importAll(b: BackupFile): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(['records', 'statements', 'kv'], 'readwrite');
    const rs = t.objectStore('records');
    const ss = t.objectStore('statements');
    rs.clear();
    ss.clear();
    for (const r of b.records) rs.put(r);
    for (const s of b.statements) ss.put(s);
    t.objectStore('kv').put(b.master, 'master');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** ブラウザに「消さないで」と頼む（iPhone の自動削除対策。許可されない端末もある） */
export async function requestPersist(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
