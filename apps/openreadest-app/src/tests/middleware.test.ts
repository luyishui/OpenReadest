import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware, config } from '@/middleware';

const BASE = 'http://localhost:3000';
const res = (path: string) => middleware(new NextRequest(BASE + path));
const coep = (path: string) => res(path).headers.get('Cross-Origin-Embedder-Policy');

describe('middleware cross-origin isolation headers', () => {
  it('serves COEP credentialless on the /s share landing', () => {
    expect(coep('/s')).toBe('credentialless');
    expect(coep('/s/Qmup0X1A8ovl2FmKJKA8mB')).toBe('credentialless');
  });

  it('keeps require-corp on every other document route', () => {
    expect(coep('/')).toBe('require-corp');
    expect(coep('/library')).toBe('require-corp');
    expect(coep('/reader/abc')).toBe('require-corp');
    // Must not be caught by a naive startsWith('/s').
    expect(coep('/settings')).toBe('require-corp');
    expect(coep('/search')).toBe('require-corp');
  });

  it('always pairs COOP same-origin on document responses', () => {
    expect(res('/library').headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res('/s/tok').headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('does not put COI headers on /api routes but keeps CORS', () => {
    const r = middleware(
      new NextRequest(BASE + '/api/metadata/x', { headers: { origin: 'tauri://localhost' } }),
    );
    expect(r.headers.get('Cross-Origin-Embedder-Policy')).toBeNull();
    expect(r.headers.get('Cross-Origin-Opener-Policy')).toBeNull();
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('tauri://localhost');
  });

  it('matcher excludes static assets', () => {
    const re = new RegExp('^' + config.matcher[0] + '$');
    expect(re.test('/library')).toBe(true);
    expect(re.test('/_next/static/chunks/a.js')).toBe(false);
    expect(re.test('/favicon.ico')).toBe(false);
  });
});
