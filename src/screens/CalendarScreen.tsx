import { useMemo } from 'react';
import { PeriodNav } from '../components/ui';
import { calcDay } from '../lib/calc';
import { addMonths, datesInRange, parseDate, periodLabel, periodRange, weekday, WEEKDAY_JA } from '../lib/dates';
import { yen } from '../lib/money';
import { useApp } from '../store';

// 未入力の日がひと目でわかるカレンダー（締め日で区切った1か月）

export function CalendarScreen() {
  const app = useApp();
  const { master, records, period } = app;
  const { start, end } = periodRange(period, master.closingDay);
  const today = app.today();
  const dates = datesInRange(start, end);
  const lead = weekday(start);

  // 使い始める前の日は「未入力」にしない
  const firstDay = Object.keys(records).sort()[0] ?? today + '~';
  const cells = useMemo(
    () =>
      dates.map((d) => {
        const r = records[d];
        if (!r) return { d, kind: d > today ? 'future' : d >= firstDay ? 'missing' : 'before', amount: 0, warn: false };
        if (r.dayOff) return { d, kind: 'off', amount: 0, warn: false };
        const res = calcDay(r, master);
        return { d, kind: 'done', amount: res.total, warn: res.warnings.length > 0 };
      }),
    [dates.join(), records, master, today, firstDay],
  );
  const missing = cells.filter((c) => c.kind === 'missing').length;
  const done = cells.filter((c) => c.kind === 'done' || c.kind === 'off').length;

  return (
    <div className="screen">
      <PeriodNav
        label={periodLabel(period, master.closingDay)}
        onPrev={() => app.setPeriod(addMonths(period, -1))}
        onNext={() => app.setPeriod(addMonths(period, 1))}
      />
      <div className="legend">
        <span className="lg done">記録済み {done}日</span>
        <span className="lg missing">未入力 {missing}日</span>
      </div>
      <div className="cal" role="grid">
        {WEEKDAY_JA.map((w, i) => (
          <div key={w} className={'cal-head' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={'e' + i} />
        ))}
        {cells.map((c) => {
          const { m, d } = parseDate(c.d);
          return (
            <button
              key={c.d}
              type="button"
              className={`cal-cell ${c.kind}${c.d === today ? ' today' : ''}`}
              onClick={() => app.openDate(c.d)}
              aria-label={`${m}月${d}日 ${labelOf(c.kind)}`}
            >
              <span className="cal-day">{d === 1 || c.d === start ? `${m}/${d}` : d}</span>
              <span className="cal-mark">
                {c.kind === 'done' ? (c.warn ? '⚠' : '✓') : c.kind === 'off' ? '休' : c.kind === 'missing' ? '未' : ''}
              </span>
              {c.kind === 'done' && <span className="cal-amt">{Math.round(c.amount / 1000)}千</span>}
            </button>
          );
        })}
      </div>
      <p className="muted-text">日付を押すとその日の記録を開きます。⚠は単価未設定や距離未入力がある日です。</p>
      {cells.some((c) => c.kind === 'done') && (
        <p className="muted-text small">
          金額は千円単位の目安です。正確な金額は「集計」で確認できます（この期間の手当合計{' '}
          {yen(cells.reduce((s, c) => s + c.amount, 0))}）。
        </p>
      )}
    </div>
  );
}

function labelOf(kind: string) {
  return kind === 'done' ? '記録済み' : kind === 'off' ? '休み' : kind === 'missing' ? '未入力' : '';
}
