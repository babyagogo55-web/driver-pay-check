import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as db from './db';
import { blankMaster, blankRecord } from './lib/defaults';
import type { Master } from './lib/types';
import { emptyStatement } from './lib/reconcile';

describe('端末内保存（IndexedDB）', () => {
  it('初回は金額が空の設定で始まり、はじめの設定を出す', async () => {
    const m = await db.loadMaster();
    expect(m.isSample).toBe(false);
    expect(m.setupDone).toBe(false);
    expect(m.baseSalary).toEqual([]);
    expect(m.unitPrices).toEqual([]);
    expect(m.distanceRateX100).toEqual([]);
  });
  it('setupDone が無い古いデータは、設定済みとして扱う', () => {
    const { setupDone: _d, ...old } = blankMaster();
    expect(db.withDefaults(old as Master).setupDone).toBe(true);
    expect(db.withDefaults({ ...old, setupDone: false } as Master).setupDone).toBe(false);
  });
  it('記録の保存・読み込み・削除', async () => {
    await db.saveRecord({ ...blankRecord('2026-10-01'), memo: 'a' });
    await db.saveRecord({ ...blankRecord('2026-10-02'), dayOff: true });
    expect((await db.loadRecords()).map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02']);
    await db.deleteRecord('2026-10-01');
    expect((await db.loadRecords()).map((r) => r.date)).toEqual(['2026-10-02']);
  });
  it('バックアップにAPIキーを入れない', async () => {
    const m = await db.loadMaster();
    await db.saveMaster({ ...m, maps: { ...m.maps, apiKey: 'SECRET-KEY' } });
    const b = await db.exportAll();
    expect(b.master.maps.apiKey).toBe('');
    expect(JSON.stringify(b)).not.toContain('SECRET-KEY');
  });
  it('古い版の設定（maps なし）でも読み込める', async () => {
    const m = await db.loadMaster();
    const { maps: _drop, ...old } = m;
    await db.saveMaster(old as typeof m);
    expect((await db.loadMaster()).maps.tolerancePct).toBe(15);
  });
  it('バックアップの書き出し→戻しで同じ内容になる（戻すと既存は置き換え）', async () => {
    await db.saveStatement({ ...emptyStatement('2026-10'), operationAllowance: 12345 });
    const backup = await db.exportAll();
    await db.saveRecord({ ...blankRecord('2026-12-31'), memo: '後から足した' });
    await db.importAll(JSON.parse(JSON.stringify(backup)));
    expect((await db.loadRecords()).map((r) => r.date)).toEqual(['2026-10-02']);
    expect((await db.loadStatements())[0].operationAllowance).toBe(12345);
  });
});
