import type { PeriodResult } from './calc';
import { periodLabel, shortJa } from './dates';
import { formatFixed, km, signedYen, yen } from './money';
import { STATUS_LABEL, type Reconciliation } from './reconcile';
import type { DailyRecord, Master, Statement } from './types';

// 出力（照合レポート・CSV・カレンダー通知ファイル）。すべて文字列を返す純粋関数。

export function reconcileReportText(
  result: PeriodResult,
  rec: Reconciliation,
  statement: Statement,
  master: Master,
): string {
  const L: string[] = [];
  L.push(`【運行内容手当 照合レポート】${periodLabel(result.period, master.closingDay)}`);
  L.push(`${master.office ? master.office + '　' : ''}${master.driverName || '（氏名未設定）'}`);
  L.push('');
  L.push('■ 月合計（会社明細 − 自分の記録）');
  for (const m of rec.months) {
    if (m.company === null) {
      L.push(`・${m.label}：自分 ${yen(m.mine)}／会社 未入力`);
    } else {
      L.push(`・${m.label}：自分 ${yen(m.mine)}／会社 ${yen(m.company)}／差 ${signedYen(m.diff ?? 0)}`);
    }
  }
  L.push('');
  if (rec.flaggedDays.length === 0) {
    L.push(rec.hasDaily ? '■ 日別：差のある日はありません' : '■ 日別：会社明細の日別金額は未入力です');
  } else {
    L.push(`■ 差のある日（${rec.flaggedDays.length}日、差の合計 ${signedYen(sumDiff(rec))}）`);
    for (const d of rec.flaggedDays) {
      L.push('');
      L.push(
        `◆ ${shortJa(d.date)}　自分 ${d.mine === null ? '記録なし' : yen(d.mine)}／会社 ${
          d.company === null ? '記載なし' : yen(d.company)
        }／差 ${signedYen(d.diff ?? 0)}（${d.reason}）`,
      );
      for (const l of d.day?.lines ?? []) {
        L.push(
          `　${l.destinationName}　${l.cargoName}　${l.count}${l.unit} × ${
            l.unitPrice === null ? '単価未設定' : yen(l.unitPrice)
          } ＝ ${yen(l.amount)}`,
        );
      }
      if (d.day && master.companyDailyBasis === 'operationPlusDistance' && d.day.km10 !== null) {
        L.push(`　距離 ${km(d.day.km10)} ＝ ${yen(d.day.distanceAllowance)}`);
      }
      if (d.check.status !== 'unchecked' || d.check.note) {
        L.push(`　状況：${STATUS_LABEL[d.check.status]}${d.check.note ? '　' + d.check.note : ''}`);
      }
    }
  }
  L.push('');
  L.push(`照合の状況：${STATUS_LABEL[statement.status]}${statement.note ? '　' + statement.note : ''}`);
  L.push('※自分の日々の記録（行き先・荷物・点数・距離）と、設定した単価から計算した金額です。');
  return L.join('\n');
}

function sumDiff(rec: Reconciliation): number {
  return rec.flaggedDays.reduce((s, d) => s + (d.diff ?? 0), 0);
}

export function csvEscape(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  // Excel で文字化けしないよう先頭に BOM を付ける
  return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

/** 照合レポートの CSV（1行＝1日×1明細行） */
export function reconcileCsv(rec: Reconciliation): string {
  const rows: (string | number | null)[][] = [
    ['日付', '行き先', '荷物種別', '点数', '単価', '金額', '自分の日計', '会社記載額', '差額(会社−自分)', '要確認', '理由', '状況', 'メモ'],
  ];
  for (const d of rec.days) {
    const lines = d.day?.lines.length ? d.day.lines : [null];
    lines.forEach((l, i) => {
      const first = i === 0;
      rows.push([
        d.date,
        l?.destinationName ?? '',
        l?.cargoName ?? '',
        l?.count ?? '',
        l?.unitPrice ?? '',
        l?.amount ?? '',
        first ? d.mine : '',
        first ? d.company : '',
        first ? d.diff : '',
        first && d.flagged ? '要確認' : '',
        first ? d.reason : '',
        first ? STATUS_LABEL[d.check.status] : '',
        first ? d.check.note : '',
      ]);
    });
  }
  return toCsv(rows);
}

/** 全記録の CSV（表計算ソフトでの確認用） */
export function recordsCsv(records: DailyRecord[], master: Master): string {
  const dn = (id: string) => master.destinations.find((x) => x.id === id)?.name ?? id;
  const cn = (id: string) => master.cargoTypes.find((x) => x.id === id)?.name ?? id;
  const rows: (string | number | null)[][] = [
    ['日付', '休み', '行き先順', '行き先', '高速', '荷物種別', '点数', '走行距離km', 'メモ', '出発', '帰着', '地図の目安km', '地図の運転分'],
  ];
  const extra = (r: DailyRecord) => [
    r.startTime ?? '',
    r.endTime ?? '',
    r.mapRoute ? formatFixed(r.mapRoute.km10, 1) : '',
    r.mapRoute ? Math.round(r.mapRoute.seconds / 60) : '',
  ];
  for (const r of [...records].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const kmText =
      r.distance.mode === 'direct'
        ? formatFixed(r.distance.km10, 1)
        : r.distance.start10 !== null && r.distance.end10 !== null
          ? formatFixed(r.distance.end10 - r.distance.start10, 1)
          : '';
    if (r.dayOff || r.stops.length === 0) {
      rows.push([r.date, r.dayOff ? '休み' : '', '', '', '', '', '', kmText, r.memo, ...extra(r)]);
      continue;
    }
    r.stops.forEach((s, i) => {
      const items = s.items.length ? s.items : [null];
      items.forEach((it, j) => {
        const first = i === 0 && j === 0;
        rows.push([
          r.date,
          '',
          i + 1,
          dn(s.destinationId),
          s.highway ? '有' : '',
          it ? cn(it.cargoTypeId) : '',
          it?.count ?? '',
          first ? kmText : '',
          first ? r.memo : '',
          ...(first ? extra(r) : ['', '', '', '']),
        ]);
      });
    });
  }
  return toCsv(rows);
}

/**
 * 毎日決まった時刻に通知が鳴る予定を、スマホ標準のカレンダーに登録するための .ics ファイル。
 * （ホーム画面アプリは、サーバーなしでは決まった時刻に通知を出せないための代替策）
 */
export function reminderIcs(time: string, appUrl: string, now: Date = new Date()): string {
  const [hh, mm] = time.split(':').map((x) => x.padStart(2, '0'));
  const p = (n: number) => String(n).padStart(2, '0');
  const ymd = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//driver-pay-check//JA',
    'BEGIN:VEVENT',
    `UID:driver-pay-check-reminder-${ymd}@local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${ymd}T${hh}${mm}00`,
    'DURATION:PT5M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:今日の運行を記録（30秒）',
    `DESCRIPTION:日報アプリを開いて記録する ${appUrl}`,
    `URL:${appUrl}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:今日の運行を記録',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
