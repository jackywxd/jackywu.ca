import { describe, expect, it } from 'vitest';
import { apiBaseFromEnv } from '../src/lib/publish-deps';

describe('apiBaseFromEnv', () => {
  it('沒設或預設值 → undefined（用 api.github.com）', () => {
    expect(apiBaseFromEnv(undefined)).toBeUndefined();
    expect(apiBaseFromEnv('')).toBeUndefined();
    expect(apiBaseFromEnv('https://api.github.com')).toBeUndefined();
  });
  it.each(['http://127.0.0.1:9999', 'http://localhost:8080', 'http://[::1]:1'])('本機位址 %s 放行', (v) => expect(apiBaseFromEnv(v)).toBe(v));
  it.each(['https://evil.example.com', 'http://127.0.0.1.evil.com', 'http://evil.com:80', 'https://127.0.0.1', 'http://localhost.evil.com'])('其他位址 %s → 丟錯（token 不能被送到別的主機）', (v) =>
    expect(() => apiBaseFromEnv(v)).toThrow(/GITHUB_API_BASE/));
});
