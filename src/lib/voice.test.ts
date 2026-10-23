import { describe, expect, it } from 'vitest';
import { blankRecord, sampleMaster } from './defaults';
import type { DailyRecord } from './types';
import { applyVoice, kanjiToNumber, normalize, parseVoice } from './voice';

const m = sampleMaster();
const say = (text: string, record: DailyRecord = blankRecord('2026-10-23')) => applyVoice(record, parseVoice(text, m), m);
const items = (r: DailyRecord, i: number) => Object.fromEntries(r.stops[i].items.map((x) => [x.cargoTypeId, x.count]));

describe('正規化', () => {
  it.each([
    ['二百八十', 280],
    ['五十', 50],
    ['千二百', 1200],
    ['一万二千三百', 12300],
    ['三〇〇', 300],
    ['十', 10],
  ])('漢数字 %s = %i', (s, n) => expect(kanjiToNumber(s)).toBe(n));
  it('カタカナ→ひらがな・全角→半角・（仮）を除く', () => {
    expect(normalize('ケース物（仮）')).toBe('けーす物');
    expect(normalize('２８０ＫＭ')).toBe('280km');
    expect(normalize('第一柿')).toBe('第1柿');
    expect(normalize('1,234点')).toBe('1234点');
  });
});

describe('音声から記録を作る', () => {
  it('行き先・荷物・点数・高速・距離を一度に', () => {
    const { record, warnings } = say('太田垣 青果50、第一柿 青果30 ケース20、東日本 パレット4枚 高速、距離280キロ');
    expect(warnings).toEqual([]);
    expect(record.stops.map((s) => s.destinationId)).toEqual(['d1', 'd2', 'd3']);
    expect(items(record, 0)).toEqual({ c1: 50 });
    expect(items(record, 1)).toEqual({ c1: 30, c2: 20 });
    expect(items(record, 2)).toEqual({ c3: 4 });
    expect(record.stops[2].highway).toBe(true);
    expect(record.distance).toEqual({ mode: 'direct', km10: 2800 });
  });
  it('音声認識が漢数字・「点」・助詞まじりで出しても読める', () => {
    const { record } = say('えーと太田垣で青果が五十点、それから東日本はパレットを四枚です。走行距離は二百八十キロ');
    expect(items(record, 0)).toEqual({ c1: 50 });
    expect(items(record, 1)).toEqual({ c3: 4 });
    expect(record.distance).toEqual({ mode: 'direct', km10: 2800 });
  });
  it('読み仮名（呼び名）でも行き先・荷物がわかる', () => {
    const { record } = say('おおたがき せいか 12');
    expect(record.stops[0].destinationId).toBe('d1');
    expect(items(record, 0)).toEqual({ c1: 12 });
  });
  it('数が先・荷物が後の言い方', () => {
    const { record } = say('第一柿 20点 ケース');
    expect(items(record, 0)).toEqual({ c2: 20 });
  });
  it('「280点5キロ」は280.5km、「〜キロ」だけでも距離', () => {
    expect(say('距離280点5キロ').record.distance).toEqual({ mode: 'direct', km10: 2805 });
    expect(say('太田垣 青果10 312キロ').record.distance).toEqual({ mode: 'direct', km10: 3120 });
  });
  it('メーター値', () => {
    const { record } = say('出発メーター123456 帰着123736');
    expect(record.distance).toEqual({ mode: 'meter', start10: 1234560, end10: 1237360 });
  });
  it('「2件目」の数字は点数にしない', () => {
    const { record } = say('1件目 太田垣 青果10 2件目 第一柿 青果5');
    expect(record.stops).toHaveLength(2);
    expect(items(record, 0)).toEqual({ c1: 10 });
    expect(items(record, 1)).toEqual({ c1: 5 });
  });
  it('同じ行き先に2回行った日は2件になる', () => {
    expect(say('太田垣 青果10 太田垣 青果5').record.stops).toHaveLength(2);
  });
  it('メモは言った言葉のまま', () => {
    const { record } = say('太田垣 青果10 メモ 渋滞で30分遅着');
    expect(record.memo).toBe('渋滞で30分遅着');
    expect(items(record, 0)).toEqual({ c1: 10 });
  });
  it('休み', () => {
    expect(say('今日は休み').record.dayOff).toBe(true);
  });
});

describe('いつものルート＋言い直しで修正', () => {
  it('テンプレート名を言うと呼び出してから、言った所だけ直す', () => {
    const { record, changes } = say('いつもの便A、太田垣 青果55、距離290キロ');
    expect(record.stops).toHaveLength(3);
    expect(items(record, 0)).toEqual({ c1: 55 });
    expect(items(record, 1)).toEqual({ c1: 30, c2: 20 }); // 言っていない所はテンプレートのまま
    expect(record.distance).toEqual({ mode: 'direct', km10: 2900 });
    expect(changes[0]).toContain('いつもの便A');
  });
  it('入力済みの日に「第一柿 ケース25」だけ言うと、その点数だけ置き換え', () => {
    const base = say('いつもの便A').record;
    const { record } = say('第一柿 ケース25', base);
    expect(items(record, 1)).toEqual({ c1: 30, c2: 25 });
    expect(record.stops).toHaveLength(3);
  });
  it('0点と言えばその荷物を消す・高速なし', () => {
    const base = say('いつもの便A').record;
    const { record } = say('東日本 パレット0 高速なし', base);
    expect(record.stops[2].items).toEqual([]);
    expect(record.stops[2].highway).toBe(false);
  });
  it('行き先を言わずに荷物だけ：その荷物がある行き先が1つならそこを直す', () => {
    const base = say('いつもの便A').record;
    const { record } = say('パレット6', base);
    expect(items(record, 2)).toEqual({ c3: 6 });
  });
  it('荷物の種類を言わない：その行き先の荷物が1種類ならそれ', () => {
    const base = say('いつもの便A').record;
    const { record, warnings } = say('太田垣 60', base);
    expect(items(record, 0)).toEqual({ c1: 60 });
    expect(warnings).toEqual([]);
  });
});

describe('聞き取れなかった部分', () => {
  it('知らない言葉は unknown に返す（呼び名登録に使う）', () => {
    const p = parseVoice('大田垣 青果10', m);
    expect(p.unknown).toEqual(['大田垣']);
    const r = applyVoice(blankRecord('2026-10-23'), p, m);
    expect(r.warnings.join()).toContain('行き先');
  });
  it('わからない言葉から前後の助詞を落とす', () => {
    expect(parseVoice('えーと大田垣で青果10', m).unknown).toEqual(['大田垣']);
  });
  it('数のない荷物は警告', () => {
    expect(parseVoice('太田垣 青果', m).warnings.join()).toContain('数が聞き取れません');
  });
  it('呼び名を登録すると次から通じる', () => {
    const m2 = { ...m, destinations: m.destinations.map((d) => (d.id === 'd1' ? { ...d, aliases: [...(d.aliases ?? []), '大田垣'] } : d)) };
    const p = parseVoice('大田垣 青果10', m2);
    expect(p.unknown).toEqual([]);
    expect(p.stops[0].destinationId).toBe('d1');
  });
});

describe('出発・帰着の時刻', () => {
  it('「出発21時半、帰着5時」「21時出発」「帰着05:10」', () => {
    expect(say('出発21時半 帰着5時').record).toMatchObject({ startTime: '21:30', endTime: '05:00' });
    expect(say('21時出発 6時15分帰着').record).toMatchObject({ startTime: '21:00', endTime: '06:15' });
    expect(say('帰着05:10').record.endTime).toBe('05:10');
  });
  it('メーター値と時刻を混ぜても取り違えない', () => {
    const { record } = say('出発メーター123456 出発21時 帰着123736 帰着5時');
    expect(record.distance).toEqual({ mode: 'meter', start10: 1234560, end10: 1237360 });
    expect(record).toMatchObject({ startTime: '21:00', endTime: '05:00' });
  });
  it('「10時間」は時刻にしない', () => {
    expect(parseVoice('出発10時間', m).startTime).toBeNull();
  });
});
