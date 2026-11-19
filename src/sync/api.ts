import { typedJsonReplacer, typedJsonReviver } from '../storage';
import { SyncError, type PullPage, type PushOp, type RemoteFile, type ServerStatus, type SyncApi } from './types';

export interface HttpApiOptions {
  /** Server origin, '' for the page's own (cookie sign-in). */
  base: string;
  fetch?: typeof fetch;
}

/** Gzips a body when the platform can (CompressionStream: Safari 16.4+, Node 18+). */
export async function gzip(data: Blob): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined') return null;
  return new Response(data.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export async function gunzip(data: Blob): Promise<Blob> {
  return new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
}

async function failure(res: Response): Promise<SyncError> {
  let msg = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) msg = body.error;
  } catch {
    /* not JSON */
  }
  return new SyncError(msg, res.status);
}

/** The sync endpoints over HTTP. Record bodies keep typed arrays (`{$typed, b64}`). */
export function httpApi(opts: HttpApiOptions): SyncApi {
  const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await f(`${opts.base}${path}`, { ...init, credentials: 'same-origin' });
    } catch (e) {
      throw new SyncError(`Server not reachable (${(e as Error).message})`, 0);
    }
    if (!res.ok) throw await failure(res);
    return res;
  }

  return {
    async status() {
      return (await (await call('/api/sync/status')).json()) as ServerStatus;
    },
    async push(ops: PushOp[]) {
      const json = new Blob([JSON.stringify({ ops }, typedJsonReplacer)], { type: 'application/json' });
      const zipped = json.size > 4096 ? await gzip(json) : null;
      const res = await call('/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(zipped ? { 'content-encoding': 'gzip' } : {}) },
        body: zipped ?? json,
      });
      return ((await res.json()) as { rev: number }).rev;
    },
    async pull(since: number) {
      const res = await call(`/api/sync/pull?since=${since}`);
      return JSON.parse(await res.text(), typedJsonReviver) as PullPage;
    },
    async listFiles(prefix: string) {
      const res = await call(`/api/files?prefix=${encodeURIComponent(prefix)}`);
      return ((await res.json()) as { files: RemoteFile[] }).files;
    },
    async putFile(key: string, data: Blob, rawBytes?: number) {
      await call(`/api/files/${key}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', ...(rawBytes !== undefined ? { 'x-raw-bytes': String(rawBytes) } : {}) },
        body: data,
      });
    },
    async getFile(key: string) {
      try {
        return await (await call(`/api/files/${key}`)).blob();
      } catch (e) {
        if (e instanceof SyncError && e.status === 404) return null;
        throw e;
      }
    },
  };
}
