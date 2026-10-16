import { describe, expect, it } from 'vitest';
import { validateLink } from '../src/editor/LinkDialog';

describe('validateLink', () => {
  it.each(['https://a.com', 'http://a.com/x?y=1', 'mailto:a@b.com', '/tales/2026/x/', '#top'])('接受 %s', (v) => expect(validateLink(v)).toBeNull());
  it.each(['', '  ', 'javascript:alert(1)', 'JAVASCRIPT:1', 'data:text/html,x', '//evil.com', 'ftp://x', 'a.com', 'https://a b.com'])('拒絕 %j', (v) => expect(validateLink(v)).not.toBeNull());
});
