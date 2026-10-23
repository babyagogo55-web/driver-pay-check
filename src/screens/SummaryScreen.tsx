import { useMemo } from 'react';
import { IntInput, PeriodNav, download } from '../components/ui';
import { calcPeriod } from '../lib/calc';
import { addMonths, periodLabel, shortJa } from '../lib/dates';
import { km, yen } from '../lib/money';
import { recordsCsv } from '../lib/report';
import { formatMinutes } from '../lib/route';
import { useApp } from '../store';

// 月の集計：総支給額（概算）と内訳

export function SummaryScreen() {
  const app = useApp();
  const { master, records, period } = app;
  const statement = app.statementOf(period);
  const result = useMemo(
    () => calcPeriod(Object.values(records), master, period, { today: app.today(), statement }),
    [records, master, period, statement],
  );
  const setDeductions = (deductions: { name: string; amount: number }[]) => app.putStatement({ ...statement, deductions });

  return (
    <div className="screen">
      <PeriodNav
        label={periodLabel(period, master.closingDay)}
        onPrev={() => app.setPeriod(addMonths(period, -1))}
        onNext={() => app.setPeriod(addMonths(period, 1))}
      />

      <section className="card total-card">
        <div className="total-row grand">
          <span>総支給額（概算）</span>
          <b>{yen(result.gross)}</b>
        </div>
        <div className="total-row">
          <span>基本給</span>
          <b>{yen(result.baseSalary)}</b>
        </div>
        <div className="total-row">
          <span>距離手当（{km(result.km10Total)}）</span>
          <b>{yen(result.distanceAllowance)}</b>
        </div>
        <div className="total-row">
          <span>運行内容手当{master.highwayInOperation && result.highwayAllowance > 0 ? '（高速加算を含む）' : ''}</span>
          <b>{yen(result.operationAllowance)}</b>
        </div>
        {result.separateHighway > 0 && (
          <div className="total-row">
            <span>高速加算</span>
            <b>{yen(result.separateHighway)}</b>
          </div>
        )}
        <p className="muted-text small">
          運行した日 {result.workDays}日／記録のない日 {result.missingDates.length}日
          {result.workMinutesTotal > 0 && `／拘束時間 合計 ${formatMinutes(result.workMinutesTotal)}`}
        </p>
        {master.isSample && <p className="warn-text">⚠ 単価・基本給が仮の値のままです（設定で変更）</p>}
      </section>

      {result.missingDates.length > 0 && (
        <section className="card">
          <h2>まだ記録していない日</h2>
          <div className="chips">
            {result.missingDates.map((d) => (
              <button key={d} type="button" className="chip alert" onClick={() => app.openDate(d)}>
                {shortJa(d)}
              </button>
            ))}
          </div>
        </section>
      )}

      {result.warnings.length > 0 && (
        <section className="card">
          <h2>確認が必要なところ</h2>
          {result.warnings.map((w, i) => (
            <button key={i} type="button" className="warn-line" onClick={() => app.openDate(w.date)}>
              ⚠ {shortJa(w.date)}　{w.message}
            </button>
          ))}
        </section>
      )}

      <section className="card">
        <h2>行き先ごと</h2>
        {result.byDestination.length === 0 && <p className="muted-text">記録がありません</p>}
        {result.byDestination.map((row) => (
          <details key={row.key} className="breakdown">
            <summary>
              <span>{row.name}</span>
              <span>
                {row.count}点　<b>{yen(row.amount)}</b>
              </span>
            </summary>
            {row.detail.map((x) => (
              <div key={x.key} className="sub-row">
                <span>{x.name}</span>
                <span>
                  {x.count}
                  {x.unit}　{yen(x.amount)}
                </span>
              </div>
            ))}
          </details>
        ))}
      </section>

      <section className="card">
        <h2>荷物の種類ごと</h2>
        {result.byCargo.map((row) => (
          <div key={row.key} className="sub-row">
            <span>{row.name}</span>
            <span>
              {row.count}
              {row.unit}　<b>{yen(row.amount)}</b>
            </span>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>日ごと</h2>
        <table className="day-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>距離</th>
              <th>運行</th>
              <th>合計</th>
            </tr>
          </thead>
          <tbody>
            {result.days.map((d) => (
              <tr key={d.date} onClick={() => app.openDate(d.date)} className={d.warnings.length ? 'warn-row' : ''}>
                <td>{shortJa(d.date)}</td>
                <td>{d.dayOff ? '休み' : d.km10 === null ? '—' : km(d.km10)}</td>
                <td>{yen(d.operationAllowance)}</td>
                <td>{yen(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>控除（任意・概算）</h2>
        <p className="muted-text small">税金・社会保険などを入れると手取りの目安が出ます。入れなくても構いません。</p>
        {statement.deductions.map((x, i) => (
          <div key={i} className="field-row">
            <input
              className="text-input"
              value={x.name}
              aria-label="控除の名前"
              onChange={(e) => setDeductions(statement.deductions.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))}
            />
            <IntInput
              value={x.amount}
              ariaLabel="控除の金額"
              onChange={(v) => setDeductions(statement.deductions.map((y, j) => (j === i ? { ...y, amount: v ?? 0 } : y)))}
            />
            <button type="button" className="btn small" onClick={() => setDeductions(statement.deductions.filter((_, j) => j !== i))}>
              消す
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn small"
          onClick={() =>
            setDeductions([...statement.deductions, { name: statement.deductions.length === 0 ? '所得税' : '控除', amount: 0 }])
          }
        >
          ＋ 控除を追加
        </button>
        {statement.deductions.length > 0 && (
          <div className="total-row grand">
            <span>手取りの目安</span>
            <b>{yen(result.net)}</b>
          </div>
        )}
      </section>

      <div className="row-wrap">
        <button
          type="button"
          className="btn"
          onClick={() =>
            download(
              `運行記録_${period}.csv`,
              recordsCsv(Object.values(records).filter((r) => r.date >= result.start && r.date <= result.end), master),
              'text/csv',
            )
          }
        >
          この月の記録をCSVで保存
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          印刷・PDF
        </button>
      </div>
    </div>
  );
}
