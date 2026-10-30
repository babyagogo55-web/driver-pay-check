import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as db from './db';
import { periodOf, todayStr } from './lib/dates';
import { isEmptyRecord } from './lib/defaults';
import { emptyStatement } from './lib/reconcile';
import type { BackupFile, DailyRecord, DateStr, Master, PeriodStr, Statement } from './lib/types';

// 画面全体で共有する状態。変更はその場で IndexedDB に書く（保存ボタンなし）。

export type Tab = 'record' | 'calendar' | 'summary' | 'reconcile' | 'settings';

interface AppState {
  master: Master;
  records: Record<DateStr, DailyRecord>;
  statements: Record<PeriodStr, Statement>;
  tab: Tab;
  date: DateStr;
  period: PeriodStr;
  lastSaved: string;
  setTab: (t: Tab) => void;
  setDate: (d: DateStr) => void;
  setPeriod: (p: PeriodStr) => void;
  openDate: (d: DateStr) => void;
  updateMaster: (fn: (m: Master) => Master) => void;
  putRecord: (r: DailyRecord) => void;
  statementOf: (p: PeriodStr) => Statement;
  putStatement: (s: Statement) => void;
  replaceAll: (b: BackupFile) => Promise<void>;
  /** 記録・明細を全部消して、設定を入れ替える（見本で試したあと自分の値で始めるとき） */
  resetAll: (m: Master) => Promise<void>;
  today: () => DateStr;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<{
    master: Master;
    records: Record<DateStr, DailyRecord>;
    statements: Record<PeriodStr, Statement>;
  } | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('record');
  const [date, setDate] = useState<DateStr>(() => todayStr());
  const [period, setPeriod] = useState<PeriodStr>(() => periodOf(todayStr(), 0));
  const [lastSaved, setLastSaved] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [master, records, statements] = await Promise.all([db.loadMaster(), db.loadRecords(), db.loadStatements()]);
        const t = todayStr(new Date(), master.dayStartHour);
        setDate(t);
        setPeriod(periodOf(t, master.closingDay));
        setLoaded({
          master,
          records: Object.fromEntries(records.map((r) => [r.date, r])),
          statements: Object.fromEntries(statements.map((s) => [s.period, s])),
        });
        void db.requestPersist();
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const saved = useCallback((p: Promise<unknown>) => {
    p.then(
      () => setLastSaved(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })),
      (e) => setError('保存に失敗しました：' + String(e)),
    );
  }, []);

  const value = useMemo<AppState | null>(() => {
    if (!loaded) return null;
    const { master, records, statements } = loaded;
    return {
      master,
      records,
      statements,
      tab,
      date,
      period,
      lastSaved,
      setTab: (t) => {
        setTab(t);
        window.scrollTo(0, 0);
      },
      setDate,
      setPeriod,
      openDate: (d) => {
        setDate(d);
        setTab('record');
        window.scrollTo(0, 0);
      },
      updateMaster: (fn) => {
        setLoaded((cur) => {
          if (!cur) return cur;
          const next = fn(cur.master);
          saved(db.saveMaster(next));
          return { ...cur, master: next };
        });
      },
      putRecord: (r) => {
        setLoaded((cur) => {
          if (!cur) return cur;
          const records = { ...cur.records };
          if (isEmptyRecord(r)) {
            delete records[r.date];
            saved(db.deleteRecord(r.date));
          } else {
            const withTime = { ...r, updatedAt: new Date().toISOString() };
            records[r.date] = withTime;
            saved(db.saveRecord(withTime));
          }
          return { ...cur, records };
        });
      },
      statementOf: (p) => statements[p] ?? emptyStatement(p),
      putStatement: (s) => {
        const withTime = { ...s, updatedAt: new Date().toISOString() };
        setLoaded((cur) => (cur ? { ...cur, statements: { ...cur.statements, [s.period]: withTime } } : cur));
        saved(db.saveStatement(withTime));
      },
      replaceAll: async (b) => {
        // 戻したファイルにはAPIキーがないので、この端末のキーを引き継ぐ
        const restored = db.withDefaults(b.master);
        const merged = { ...b, master: { ...restored, maps: { ...restored.maps, apiKey: restored.maps.apiKey || master.maps.apiKey } } };
        await db.importAll(merged);
        setLoaded({
          master: merged.master,
          records: Object.fromEntries(b.records.map((r) => [r.date, r])),
          statements: Object.fromEntries(b.statements.map((s) => [s.period, s])),
        });
      },
      resetAll: async (m) => {
        const fresh = { ...m, maps: { ...m.maps, apiKey: master.maps.apiKey } };
        await db.importAll({ app: 'driver-pay-check', schemaVersion: 1, exportedAt: new Date().toISOString(), master: fresh, records: [], statements: [] });
        setLoaded({ master: fresh, records: {}, statements: {} });
        setTab('record');
      },
      today: () => todayStr(new Date(), master.dayStartHour),
    };
  }, [loaded, tab, date, period, lastSaved, saved]);

  if (error) {
    return (
      <div className="fatal">
        <p>データの読み書きでエラーが起きました。</p>
        <p className="small">{error}</p>
        <p className="small">プライベートブラウズ（シークレット）では保存できません。通常の画面で開いてください。</p>
      </div>
    );
  }
  if (!value) return <div className="loading">読み込み中…</div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
