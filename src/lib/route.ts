import { roundDiv } from './money';
import type { DailyRecord, Master } from './types';

// Googleマップ（Routes API）連携の純粋関数。通信は src/maps.ts だけが行う。
// 送るのは「営業所と行き先の住所」と「高速を使うか」だけ。給与・点数・氏名は送らない。
//
// 距離手当の正はメーター（会社の計算）なので、地図の距離は
//  ① 距離を入れ忘れた日の目安（ワンタップで入れる／設定で自動）
//  ② 入力した距離の打ち間違いチェック
// に使う。

export interface RoutePlan {
  /** 道順の組み合わせ。同じなら結果を使い回す */
  key: string;
  body: object;
  /** Googleマップで開くURL（APIキー不要） */
  link: string;
}

/** 道順を作る。作れないときは理由を返す */
export function planRoute(record: DailyRecord, master: Master): RoutePlan | { error: string } {
  const office = master.maps.officeAddress.trim();
  if (!office) return { error: '設定で営業所の住所を入れてください' };
  const stops = record.stops.filter((s) => s.destinationId);
  if (stops.length === 0) return { error: '行き先がありません' };
  const addrs: string[] = [];
  const missing: string[] = [];
  for (const s of stops) {
    const d = master.destinations.find((x) => x.id === s.destinationId);
    const a = d?.address?.trim();
    if (a) addrs.push(a);
    else missing.push(d?.name ?? '?');
  }
  if (missing.length) return { error: `住所が未設定の行き先：${[...new Set(missing)].join('、')}（設定→行き先）` };

  // 1回の問い合わせで行き先ごとに高速の有無は指定できないので、1か所でも高速なら高速ありで出す
  const highway = stops.some((s) => s.highway);
  const points = [office, ...addrs, ...(master.maps.roundTrip ? [office] : [])];
  const origin = points[0];
  const destination = points[points.length - 1];
  const intermediates = points.slice(1, -1);
  if (points.length < 2 || intermediates.length > 25) return { error: '行き先が多すぎます（25か所まで）' };
  const key = JSON.stringify([points, highway]);
  const body = {
    origin: { address: origin },
    destination: { address: destination },
    intermediates: intermediates.map((address) => ({ address })),
    travelMode: 'DRIVE',
    // 渋滞を考えない最安の区分（毎日のパターンが同じなので十分）
    routingPreference: 'TRAFFIC_UNAWARE',
    routeModifiers: { avoidHighways: !highway },
    languageCode: 'ja',
    units: 'METRIC',
  };
  return { key, body, link: mapsLink(points) };
}

/** Googleマップのルート画面を開くURL（アプリがあればアプリで開く） */
export function mapsLink(points: string[]): string {
  const q = new URLSearchParams({
    api: '1',
    origin: points[0],
    destination: points[points.length - 1],
    travelmode: 'driving',
  });
  if (points.length > 2) q.set('waypoints', points.slice(1, -1).join('|'));
  return 'https://www.google.com/maps/dir/?' + q.toString();
}

/** Routes API の応答を 0.1km・秒に。読めなければ理由 */
export function parseRoutes(json: unknown): { km10: number; seconds: number } | { error: string } {
  const j = json as { routes?: { distanceMeters?: number; duration?: string }[]; error?: { message?: string; status?: string } };
  if (j?.error) return { error: explainError(j.error.status ?? '', j.error.message ?? '') };
  const r = j?.routes?.[0];
  if (!r || typeof r.distanceMeters !== 'number') return { error: 'ルートが見つかりませんでした。住所を確かめてください' };
  const seconds = Number(/^(\d+)/.exec(r.duration ?? '')?.[1] ?? 0);
  return { km10: roundDiv(r.distanceMeters, 100, 'round'), seconds };
}

function explainError(status: string, message: string): string {
  if (status === 'PERMISSION_DENIED' || /API key/i.test(message)) return 'APIキーが使えません（キー・制限・Routes APIの有効化を確認）';
  if (status === 'INVALID_ARGUMENT') return '住所が読み取れませんでした（設定の住所を確認）';
  if (status === 'RESOURCE_EXHAUSTED') return '利用上限に達しました（Google Cloudの上限設定を確認）';
  return `地図の取得に失敗しました（${status || message}）`;
}

/** 入力した距離と地図の目安の差が大きければ警告文 */
export function distanceCheck(km10: number | null, mapKm10: number | undefined, tolerancePct: number): string | null {
  if (km10 === null || !mapKm10 || tolerancePct <= 0) return null;
  const diff = Math.abs(km10 - mapKm10);
  if (diff * 100 <= mapKm10 * tolerancePct) return null;
  return `入力した距離が地図の目安（${mapKm10 / 10}km）と${tolerancePct}%以上違います。打ち間違いか、寄り道・回り道を確認`;
}

/** 秒 → 「4時間35分」 */
export function formatDuration(seconds: number): string {
  const min = roundDiv(seconds, 60, 'round');
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

/** 出発・帰着の時刻から拘束時間（分）。帰着が出発より早ければ日付またぎとみなす */
export function workMinutes(start?: string, end?: string): number | null {
  const p = (t?: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const s = p(start);
  const e = p(end);
  if (s === null || e === null) return null;
  return e >= s ? e - s : e + 24 * 60 - s;
}

export function formatMinutes(min: number): string {
  return formatDuration(min * 60);
}
