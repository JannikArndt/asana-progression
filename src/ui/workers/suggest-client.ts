import { suggest, type HistoryEntry, type ReviewItem, type Suggestion, type SuggestionOptions } from '../../labeling';
import type { Asana, SequenceTemplate } from '../../model';

export interface SuggestRequest {
  id: number;
  items: ReviewItem[];
  catalog: Asana[];
  template: SequenceTemplate | null;
  history: HistoryEntry[];
  options: SuggestionOptions;
}

export type SuggestResponse = { id: number; result: Record<string, Suggestion[]> } | { id: number; error: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: SuggestResponse) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./suggest.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SuggestResponse>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    return worker;
  } catch {
    return null;
  }
}

/** Suggestions computed in a worker (falls back to the main thread if workers are unavailable). */
export function suggestInWorker(req: Omit<SuggestRequest, 'id'>): Promise<Record<string, Suggestion[]>> {
  const w = getWorker();
  if (!w) return Promise.resolve(suggest(req.items, req.catalog, req.template, req.history, req.options));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => ('error' in r ? reject(new Error(r.error)) : resolve(r.result)));
    w.postMessage({ id, ...req });
  });
}
