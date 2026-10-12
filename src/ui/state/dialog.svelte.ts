/** Promise-based modal dialog state (rendered by Dialog.svelte). */
export interface DialogOption {
  id: string;
  label: string;
  detail?: string;
  kind?: 'primary' | 'danger' | 'quiet';
}

/** Tiny analysis frames shown above the options (e.g. what a hold contains). */
export interface DialogFrames {
  videoId: string;
  width: number;
  height: number;
  /** `videoId` overrides the strip's video (frames across a video boundary). */
  items: Array<{ index: number; label: string; videoId?: string }>;
}

export interface DialogRequest {
  title: string;
  message?: string;
  frames?: DialogFrames;
  options: DialogOption[];
}

/**
 * What dismissing (✕, backdrop tap, swipe down, Escape) answers: the "cancel" option, or the only
 * option of a notice ("OK"); null = the question needs an explicit answer.
 */
export function dismissOf(req: DialogRequest): string | null {
  if (req.options.some((o) => o.id === 'cancel')) return 'cancel';
  return req.options.length === 1 ? req.options[0]!.id : null;
}

class DialogState {
  current = $state<(DialogRequest & { resolve: (id: string) => void }) | null>(null);

  ask(req: DialogRequest): Promise<string> {
    return new Promise((resolve) => {
      this.current = { ...req, resolve };
    });
  }

  answer(id: string) {
    const c = this.current;
    this.current = null;
    c?.resolve(id);
  }
}

export const dialog = new DialogState();
