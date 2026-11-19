import { describe, expect, it } from 'vitest';
import { gunzip, httpApi } from './api';
import { SyncError } from './types';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('httpApi', () => {
  it('sends the upload code as a bearer token without cookies, gzips large pushes, keeps typed arrays', async () => {
    const { f, calls } = fakeFetch(() => Response.json({ rev: 7 }));
    const api = httpApi({ base: 'https://srv', token: 'ABCDE-FGHIJ', fetch: f });
    const m = new Float32Array(2000).fill(1.5);
    expect(await api.push([{ store: 'analyses', key: 'v1', body: { videoId: 'v1', m } }])).toBe(7);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://srv/api/sync/push');
    expect(init.credentials).toBe('omit');
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer ABCDE-FGHIJ');
    expect(h['content-encoding']).toBe('gzip');
    const json = JSON.parse(await (await gunzip(init.body as Blob)).text());
    expect(json.ops[0].body.m.$typed).toBe('Float32Array');
  });

  it('pulls with typed arrays restored, lists and transfers files, maps errors', async () => {
    const pulled = '{"records":[{"store":"analyses","key":"v","rev":3,"body":{"videoId":"v","m":{"$typed":"Float32Array","b64":"AADAPw=="}}}],"rev":3,"latest":3,"more":false}';
    const { f, calls } = fakeFetch((url, init) => {
      if (url.includes('/api/sync/pull')) return new Response(pulled);
      if (url.includes('/api/files?')) return Response.json({ files: [{ key: 'assets/a.jpg', bytes: 3, rawBytes: null }] });
      if (url.endsWith('/missing.jpg')) return Response.json({ error: 'No such file' }, { status: 404 });
      if (url.endsWith('/broken.jpg')) return Response.json({ error: 'Sign in first' }, { status: 401 });
      if (init.method === 'PUT') return Response.json({ ok: true });
      if (url.includes('/api/sync/status')) return Response.json({ rev: 3, records: {}, files: {} });
      return new Response(new Blob(['abc']));
    });
    const api = httpApi({ base: '', fetch: f });
    const page = await api.pull(2);
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect((page.records[0]!.body as { m: Float32Array }).m[0]).toBe(1.5);
    expect(await api.listFiles('assets/')).toEqual([{ key: 'assets/a.jpg', bytes: 3, rawBytes: null }]);
    await api.putFile('samples/v.bin.gz', new Blob(['x']), 10);
    expect((calls.at(-1)!.init.headers as Record<string, string>)['x-raw-bytes']).toBe('10');
    expect(await (await api.getFile('assets/a.jpg'))!.text()).toBe('abc');
    expect(await api.getFile('assets/missing.jpg')).toBeNull();
    await expect(api.getFile('assets/broken.jpg')).rejects.toMatchObject({ status: 401, message: 'Sign in first' });
    expect((await api.status()).rev).toBe(3);
  });

  it('reports an unreachable server as status 0', async () => {
    const api = httpApi({
      base: '',
      fetch: (async () => {
        throw new TypeError('Load failed');
      }) as unknown as typeof fetch,
    });
    const err = await api.status().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect((err as SyncError).status).toBe(0);
  });
});
