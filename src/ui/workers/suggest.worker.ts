/** Runs the labeling suggestion engine off the main thread. */
import { suggest } from '../../labeling';
import type { SuggestRequest, SuggestResponse } from './suggest-client';

const scope = self as unknown as {
  postMessage(message: SuggestResponse): void;
  onmessage: ((e: MessageEvent<SuggestRequest>) => void) | null;
};

scope.onmessage = (e) => {
  const { id, items, catalog, template, history, options } = e.data;
  try {
    scope.postMessage({ id, result: suggest(items, catalog, template, history, options) });
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
