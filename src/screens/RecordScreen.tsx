import { useMemo, useState } from 'react';
import { FixedInput, Segmented, Stepper, Toggle, ConfirmButton, useFlash } from '../components/ui';
import { VoiceInput } from '../components/VoiceInput';
import { RouteCard } from '../components/RouteCard';
import { calcDay, calcPeriod } from '../lib/calc';
import { addDays, periodOf, shortJa } from '../lib/dates';
import { applyTemplate, blankRecord, copyFrom, missingSetup, newStop, templateFromRecord } from '../lib/defaults';
import { km, yen } from '../lib/money';
import type { DailyRecord, Stop } from '../lib/types';
import { useApp } from '../store';

// メイン画面：1日分の記録。目標は「テンプレートを押す→点数と距離を直す」で30秒。

export function RecordScreen() {
  const app = useApp();
  const { master, records, date } = app;
  const record = records[date] ?? blankRecord(date);
  const [flash, setFlash] = useFlash();
  const [tplName, setTplName] = useState('');
  const [showTplSave, setShowTplSave] = useState(false);

  const put = (r: DailyRecord) => app.putRecord(r);
  const result = useMemo(() => calcDay(record, master), [record, master]);

  const today = app.today();
  const missing = useMemo(() => {
    const p = periodOf(today, master.closingDay);
    return calcPeriod(Object.values(records), master, p, { today }).missingDates.filter((d) => d < today);
  }, [records, master, today]);

  const prev = useMemo(
    () =>
      Object.values(records)
        .filter((r) => r.date < date && (r.stops.length > 0 || r.dayOff))
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0],
    [records, date],
  );

  const destinations = master.destinations.filter((d) => d.active).sort((a, b) => a.order - b.order);
  const cargoTypes = master.cargoTypes.filter((c) => c.active).sort((a, b) => a.order - b.order);

  const updateStop = (i: number, s: Stop) => put({ ...record, stops: record.stops.map((x, j) => (j === i ? s : x)) });
  const setCount = (i: number, cargoTypeId: string, count: number) => {
    const s = record.stops[i];
    const has = s.items.some((it) => it.cargoTypeId === cargoTypeId);
    const items = has
      ? s.items.map((it) => (it.cargoTypeId === cargoTypeId ? { ...it, count } : it))
      : [...s.items, { cargoTypeId, count }];
    updateStop(i, { ...s, items: items.filter((it) => it.count > 0) });
  };

  const hasContent = record.stops.length > 0 || record.dayOff;

  return (
    <div className="screen">
      <div className="nav-row">
        <button type="button" className="nav-btn" aria-label="前の日" onClick={() => app.setDate(addDays(date, -1))}>
          ◀
        </button>
        <label className="nav-label date-pick">
          {shortJa(date)}
          {date === today && <span className="today-badge">今日</span>}
          <input type="date" value={date} onChange={(e) => e.target.value && app.setDate(e.target.value)} aria-label="日付を選ぶ" />
        </label>
        <button type="button" className="nav-btn" aria-label="次の日" onClick={() => app.setDate(addDays(date, 1))}>
          ▶
        </button>
      </div>
      {date !== today && (
        <button type="button" className="btn small block" onClick={() => app.setDate(today)}>
          今日に戻る
        </button>
      )}

      {master.isSample ? (
        <button type="button" className="banner warn" onClick={() => app.setTab('settings')}>
          いまは<b>見本の値</b>で試しています（金額は本物ではありません）。自分の値で始めるときは → 設定
        </button>
      ) : (
        missingSetup(master).length > 0 && (
          <button type="button" className="banner warn" onClick={() => app.updateMaster((m) => ({ ...m, setupDone: false }))}>
            まだ入っていない設定：<b>{missingSetup(master).join('・')}</b>（その分は0円で計算します）→ 入れる
          </button>
        )
      )}
      {missing.length > 0 && (
        <button type="button" className="banner alert" onClick={() => app.setTab('calendar')}>
          今月まだ記録していない日が <b>{missing.length}日</b> あります（{missing.slice(0, 3).map(shortJa).join('、')}
          {missing.length > 3 ? ' …' : ''}）→ カレンダーで確認
        </button>
      )}

      <VoiceInput record={record} onApply={put} />

      {!hasContent && (
        <section className="card">
          <h2>ワンタップで呼び出す</h2>
          <div className="quick-grid">
            {master.templates.map((t) => (
              <button key={t.id} type="button" className="btn big primary" onClick={() => put(applyTemplate(record, t))}>
                {t.name}
              </button>
            ))}
            {prev && (
              <button type="button" className="btn big" onClick={() => put(copyFrom(record, prev))}>
                前回（{shortJa(prev.date)}）をコピー
              </button>
            )}
            <button type="button" className="btn big" onClick={() => put({ ...record, stops: [newStop()] })}>
              手で入力する
            </button>
            <button type="button" className="btn big muted" onClick={() => put({ ...record, dayOff: true })}>
              休み・運行なし
            </button>
          </div>
        </section>
      )}

      {record.dayOff && (
        <section className="card center">
          <p className="big-text">この日は「休み・運行なし」</p>
          <button type="button" className="btn" onClick={() => put({ ...record, dayOff: false })}>
            取り消す
          </button>
        </section>
      )}

      {!record.dayOff &&
        record.stops.map((s, i) => (
          <section className="card stop" key={s.id}>
            <div className="stop-head">
              <h2>{i + 1}件目</h2>
              <ConfirmButton onConfirm={() => put({ ...record, stops: record.stops.filter((_, j) => j !== i) })}>この行き先を消す</ConfirmButton>
            </div>
            <div className="chips" role="radiogroup" aria-label={`${i + 1}件目の行き先`}>
              {destinations.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={s.destinationId === d.id}
                  className={'chip' + (s.destinationId === d.id ? ' on' : '')}
                  onClick={() => updateStop(i, { ...s, destinationId: d.id })}
                >
                  {d.name}
                </button>
              ))}
            </div>
            {s.destinationId &&
              cargoTypes.map((c) => (
                <Stepper
                  key={c.id}
                  label={c.name}
                  unit={c.unit}
                  value={s.items.find((it) => it.cargoTypeId === c.id)?.count ?? 0}
                  onChange={(v) => setCount(i, c.id, v)}
                />
              ))}
            {s.destinationId && (
              <Toggle on={s.highway} onChange={(v) => updateStop(i, { ...s, highway: v })}>
                高速道路を使った
              </Toggle>
            )}
          </section>
        ))}

      {!record.dayOff && hasContent && (
        <button type="button" className="btn block" onClick={() => put({ ...record, stops: [...record.stops, newStop()] })}>
          ＋ 行き先を追加
        </button>
      )}

      {!record.dayOff && hasContent && (
        <section className="card">
          <h2>走行距離</h2>
          <Segmented
            value={record.distance.mode}
            options={[
              { value: 'direct', label: '距離を入れる' },
              { value: 'meter', label: 'メーター値で' },
            ]}
            onChange={(mode) =>
              put({
                ...record,
                distance: mode === 'direct' ? { mode, km10: result.km10 } : { mode, start10: null, end10: null },
              })
            }
          />
          {record.distance.mode === 'direct' ? (
            <div className="field-row">
              <FixedInput
                value={record.distance.km10}
                digits={1}
                onChange={(v) => put({ ...record, distance: { mode: 'direct', km10: v } })}
                ariaLabel="走行距離（km）"
                className="num-input wide"
                placeholder="0"
              />
              <span className="unit">km</span>
            </div>
          ) : (
            <>
              <div className="field-row">
                <span className="field-label">出発</span>
                <FixedInput
                  value={record.distance.start10}
                  digits={1}
                  onChange={(v) => record.distance.mode === 'meter' && put({ ...record, distance: { ...record.distance, start10: v } })}
                  ariaLabel="出発時のメーター"
                  className="num-input wide"
                />
              </div>
              <div className="field-row">
                <span className="field-label">帰着</span>
                <FixedInput
                  value={record.distance.end10}
                  digits={1}
                  onChange={(v) => record.distance.mode === 'meter' && put({ ...record, distance: { ...record.distance, end10: v } })}
                  ariaLabel="帰着時のメーター"
                  className="num-input wide"
                />
              </div>
              <p className="muted-text">走った距離：{result.km10 === null ? '—' : km(result.km10)}</p>
            </>
          )}
        </section>
      )}

      {!record.dayOff && hasContent && <RouteCard record={record} put={put} />}

      {hasContent && (
        <section className="card">
          <h2>メモ（任意）</h2>
          <textarea
            className="memo"
            rows={2}
            value={record.memo}
            placeholder="例：積み残し2点あり、渋滞で遅着"
            onChange={(e) => put({ ...record, memo: e.target.value })}
          />
          <p className="muted-text small">キーボードのマイクのボタンを押すと、話して入力できます。</p>
        </section>
      )}

      {hasContent && !record.dayOff && (
        <section className="card total-card" aria-live="polite">
          <div className="total-row">
            <span>荷物の手当</span>
            <b>{yen(result.cargoAllowance)}</b>
          </div>
          {result.highwayAllowance > 0 && (
            <div className="total-row">
              <span>高速加算</span>
              <b>{yen(result.highwayAllowance)}</b>
            </div>
          )}
          <div className="total-row">
            <span>距離手当{result.km10 !== null ? `（${km(result.km10)}）` : ''}</span>
            <b>{yen(result.distanceAllowance)}</b>
          </div>
          <div className="total-row grand">
            <span>この日の手当</span>
            <b>{yen(result.total)}</b>
          </div>
          {result.warnings.map((w) => (
            <p key={w} className="warn-text">
              ⚠ {w}
            </p>
          ))}
        </section>
      )}

      {hasContent && (
        <div className="saved-line">{app.lastSaved ? `自動で保存しました（${app.lastSaved}）` : '入力すると自動で保存されます'}</div>
      )}

      {hasContent && !record.dayOff && (
        <section className="card">
          {!showTplSave ? (
            <div className="row-wrap">
              <button type="button" className="btn small" onClick={() => setShowTplSave(true)}>
                この内容を「いつものルート」に登録
              </button>
              <ConfirmButton onConfirm={() => put(blankRecord(date))}>この日の記録を全部消す</ConfirmButton>
            </div>
          ) : (
            <div className="field-row wrap">
              <input
                className="text-input"
                placeholder="名前（例：月曜の夜便）"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
              />
              <button
                type="button"
                className="btn primary"
                disabled={!tplName.trim()}
                onClick={() => {
                  const t = templateFromRecord(record, tplName.trim());
                  app.updateMaster((m) => ({ ...m, templates: [...m.templates, t] }));
                  setTplName('');
                  setShowTplSave(false);
                  setFlash(`「${t.name}」を登録しました`);
                }}
              >
                登録
              </button>
              <button type="button" className="btn" onClick={() => setShowTplSave(false)}>
                やめる
              </button>
            </div>
          )}
        </section>
      )}
      {flash && <div className="flash">{flash}</div>}
    </div>
  );
}
