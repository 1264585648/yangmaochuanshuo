import { describe, it, expect } from 'vitest';
import { escapeHTML } from '../../src/ui/escape.js';

describe('escapeHTML', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHTML(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeHTML('AI 福利 ✦')).toBe('AI 福利 ✦');
  });

  it('stringifies non-strings and treats nullish as empty', () => {
    expect(escapeHTML(3)).toBe('3');
    expect(escapeHTML(null)).toBe('');
    expect(escapeHTML(undefined)).toBe('');
  });
});
