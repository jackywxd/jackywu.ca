/**
 * 前台的配速與時間格式（src/lib/format.ts；前台沒有自己的單元測試執行器，在這裡跑）。
 * 防的失敗：
 *  · 配速用了總時間而不是移動時間 → 停下來吃飯的時間也算進配速
 *  · 滑雪、摩托顯示成每公里幾分鐘（應該是時速）
 *  · 出發時間被換成讀者所在的時區 → 溫哥華早上的活動，台北的讀者看到半夜
 */
import { describe, expect, it } from 'vitest';
import { clock, pace, seconds } from '../../src/lib/format';

describe('seconds', () => {
  it('ISO 8601 時長', () => {
    expect([seconds('PT2H31M5S'), seconds('PT45M'), seconds('P1DT2H'), seconds('2:31'), seconds(undefined)]).toEqual([9065, 2700, 93600, undefined, undefined]);
  });
});

describe('pace', () => {
  it('跑步與探險：每公里幾分鐘，用移動時間', () => {
    expect(pace(50, 'PT6H15M', 'PT6H40M', 'run')).toBe('7:30 /km');
    expect(pace(10, undefined, 'PT1H', 'wild')).toBe('6:00 /km'); // 沒有移動時間就用總時間
  });
  it('滑雪與摩托：時速', () => {
    expect(pace(60, 'PT2H', undefined, 'snow')).toBe('30.0 km/h');
    expect(pace(300, 'PT4H', undefined, 'road')).toBe('75.0 km/h');
  });
  it('距離或時間缺一個：不顯示', () => {
    expect([pace(undefined, 'PT1H', undefined, 'run'), pace(10, undefined, undefined, 'run'), pace(0, 'PT1H', undefined, 'run')]).toEqual([undefined, undefined, undefined]);
  });
});

describe('clock', () => {
  it('當地時間原樣顯示，不換時區', () => {
    expect([clock('2026-08-16T06:05-07:00'), clock('2026-08-17T07:30+09:00'), clock(undefined)]).toEqual(['06:05', '07:30', undefined]);
  });
});
