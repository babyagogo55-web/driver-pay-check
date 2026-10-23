import { parseRoutes, type RoutePlan } from './lib/route';
import type { MapRoute } from './lib/types';

// Googleマップ（Routes API）への問い合わせ。アプリで外に通信するのはここだけ。
// 送る内容：営業所と行き先の住所、高速の有無（planRoute が作る body）。

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

export async function fetchRoute(apiKey: string, plan: RoutePlan): Promise<MapRoute | { error: string }> {
  if (!navigator.onLine) return { error: '電波がありません。つながる所でもう一度' };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // 距離と時間だけ頼む（余計な項目を頼むと料金区分が上がる）
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify(plan.body),
    });
    const r = parseRoutes(await res.json());
    if ('error' in r) return r;
    return { key: plan.key, km10: r.km10, seconds: r.seconds, at: new Date().toISOString() };
  } catch (e) {
    return { error: '地図に問い合わせできませんでした（' + String(e) + '）' };
  }
}
