import { useMemo, useState } from 'react';
import { IntInput, PeriodNav, Toggle, copyText, download, useFlash } from '../components/ui';
import { calcPeriod } from '../lib/calc';
import { addMonths, datesInRange, periodLabel, shortJa } from '../lib/dates';
import { signedYen, yen } from '../lib/money';
import { STATUS_LABEL, parseDailyPaste, reconcile } from '../lib/reconcile';
import { reconcileCsv, reconcileReportText } from '../lib/report';
import type { ReconcileStatus, Statement } from '../lib/types';
import { useApp } from '../store';

// 会社明細との照合（このアプリの核心）

const STATUSES = Object.entries(STATUS_LABEL) as [ReconcileStatus, string][];

export function ReconcileScreen() {
  const app = useApp();
  const { master, records, period } = app;
  const statement = app.statementOf(period);
  const result = useMemo(() => calcPeriod(Object.values(records), master, period, { statement }), [records, master, period, statement]);
  const rec = useMemo(() => reconcile(result, statement, master), [result, statement, master]);
  const [showDaily, setShowDaily] = useState(rec.hasDaily);
  const [paste, setPaste] = useState('');
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);
  const [flash, setFlash] = useFlash();

  const put = (s: Partial<Statement>) => app.putStatement({ ...statement, ...s });
  const report = () => reconcileReportText(result, rec, statement, master);
  const setDaily = (date: string, v: number | null) => {
    const daily = { ...statement.daily };
    if (v === null) delete daily[date];
    else daily[date] = v;
    put({ daily });
  };

  if (printing) {
    return (
      <div className="print-view">
        <div className="no-print row-wrap">
          <button type="button" className="btn primary" onClick={() => window.print()}>
            印刷する（PDF保存もここから）
          </button>
          <button type="button" className="btn" onClick={() => setPrinting(false)}>
            戻る
          </button>
        </div>
        <pre className="report-pre">{report()}</pre>
      </div>
    );
  }

  const monthFields: { key: 'baseSalary' | 'distanceAllowance' | 'operationAllowance' | 'totalGross'; label: string }[] = [
    { key: 'operationAllowance', label: '運行内容手当' },
    { key: 'distanceAllowance', label: '距離手当' },
    { key: 'baseSalary', label: '基本給' },
    { key: 'totalGross', label: '総支給額' },
  ];

  return (
    <div className="screen">
      <PeriodNav
        label={periodLabel(period, master.closingDay)}
        onPrev={() => app.setPeriod(addMonths(period, -1))}
        onNext={() => app.setPeriod(addMonths(period, 1))}
      />
      <p className="muted-text small">会社から届いた明細の金額を写してください。差額は「会社の金額 − 自分の記録」です（マイナス＝少なく払われている疑い）。</p>

      <section className="card">
        <h2>明細の月合計</h2>
        {monthFields.map((f) => {
          const row = rec.months.find((m) => m.key === f.key)!;
          return (
            <div key={f.key} className="recon-row">
              <div className="recon-label">{f.label}</div>
              <div className="recon-cols">
                <div>
                  <span className="mini">会社</span>
                  <IntInput value={statement[f.key]} placeholder="未入力" ariaLabel={`会社明細の${f.label}`} onChange={(v) => put({ [f.key]: v })} />
                </div>
                <div>
                  <span className="mini">自分</span>
                  <span className="mine">{yen(row.mine)}</span>
                </div>
                <div>
                  <span className="mini">差</span>
                  <span className={'diff ' + diffClass(row.diff)}>{row.diff === null ? '—' : signedYen(row.diff)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <Toggle on={showDaily} onChange={setShowDaily}>
          明細に日ごとの金額が書いてある
        </Toggle>
        {showDaily && (
          <>
            <p className="muted-text small">
              比べる金額：{master.companyDailyBasis === 'operation' ? '運行内容手当（荷物' + (master.highwayInOperation ? '＋高速' : '') + '）' : '運行内容手当＋距離手当'}
              （設定で変更できます）
            </p>
            <details className="paste-box">
              <summary>まとめて貼り付け</summary>
              <textarea
                className="memo"
                rows={4}
                placeholder={'1行に1日ずつ\n10/1 12,345\n10/2 23,456'}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const { values, errors } = parseDailyPaste(paste, { start: result.start, end: result.end });
                  put({ daily: { ...statement.daily, ...values } });
                  setPasteErrors(errors);
                  setFlash(`${Object.keys(values).length}日分を取り込みました`);
                  if (errors.length === 0) setPaste('');
                }}
              >
                取り込む
              </button>
              {pasteErrors.map((e) => (
                <p key={e} className="warn-text small">
                  {e}
                </p>
              ))}
            </details>
            <div className="recon-days">
              {datesInRange(result.start, result.end).map((d) => {
                const row = rec.days.find((x) => x.date === d);
                const check = statement.dayChecks[d] ?? { status: 'unchecked' as const, note: '' };
                return (
                  <div key={d} className={'recon-day' + (row?.flagged ? ' flagged' : '')}>
                    <div className="recon-day-head">
                      <button type="button" className="link" onClick={() => app.openDate(d)}>
                        {shortJa(d)}
                      </button>
                      <span className="mine">自分 {row?.mine === null || !row ? '記録なし' : yen(row.mine)}</span>
                    </div>
                    <div className="recon-day-body">
                      <span className="mini">会社</span>
                      <IntInput value={statement.daily[d] ?? null} placeholder="—" ariaLabel={`${shortJa(d)}の会社記載額`} onChange={(v) => setDaily(d, v)} />
                      <span className={'diff ' + diffClass(row?.diff ?? null)}>{row?.diff == null ? '' : signedYen(row.diff)}</span>
                    </div>
                    {row?.flagged && (
                      <div className="recon-day-check">
                        <span className="warn-text small">{row.reason}</span>
                        <select
                          value={check.status}
                          aria-label={`${shortJa(d)}の状況`}
                          onChange={(e) =>
                            put({ dayChecks: { ...statement.dayChecks, [d]: { ...check, status: e.target.value as ReconcileStatus } } })
                          }
                        >
                          {STATUSES.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <input
                          className="text-input"
                          placeholder="メモ（例：本社に電話）"
                          value={check.note}
                          onChange={(e) => put({ dayChecks: { ...statement.dayChecks, [d]: { ...check, note: e.target.value } } })}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>照合の結果</h2>
        {rec.hasDaily ? (
          rec.flaggedDays.length === 0 ? (
            <p className="ok-text">日ごとの金額はすべて一致しています。</p>
          ) : (
            <p className="warn-text">
              差のある日が <b>{rec.flaggedDays.length}日</b>（差の合計 {signedYen(rec.flaggedDays.reduce((s, d) => s + (d.diff ?? 0), 0))}）
            </p>
          )
        ) : (
          <p className="muted-text">日ごとの金額は未入力です（月合計だけで比べています）。</p>
        )}
        <div className="field-row wrap">
          <span className="field-label">この月の状況</span>
          <select value={statement.status} aria-label="この月の照合の状況" onChange={(e) => put({ status: e.target.value as ReconcileStatus })}>
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="memo"
          rows={2}
          placeholder="メモ（例：11/5 本社の○○さんに電話。翌月加算と回答）"
          value={statement.note}
          onChange={(e) => put({ note: e.target.value })}
        />
      </section>

      <section className="card">
        <h2>会社に問い合わせるとき</h2>
        <div className="quick-grid">
          <button
            type="button"
            className="btn primary"
            onClick={async () => setFlash((await copyText(report())) ? 'レポートをコピーしました' : 'コピーできませんでした')}
          >
            レポートをコピー
          </button>
          {'share' in navigator && (
            <button
              type="button"
              className="btn"
              onClick={() => navigator.share({ title: '照合レポート', text: report() }).catch(() => undefined)}
            >
              LINE・メールで送る
            </button>
          )}
          <button type="button" className="btn" onClick={() => download(`照合レポート_${period}.csv`, reconcileCsv(rec), 'text/csv')}>
            CSVで保存
          </button>
          <button type="button" className="btn" onClick={() => setPrinting(true)}>
            印刷・PDF
          </button>
        </div>
        <details>
          <summary>レポートの中身を見る</summary>
          <pre className="report-pre">{report()}</pre>
        </details>
      </section>
      {flash && <div className="flash">{flash}</div>}
    </div>
  );
}

function diffClass(d: number | null): string {
  if (d === null) return '';
  return d === 0 ? 'zero' : d < 0 ? 'minus' : 'plus';
}
