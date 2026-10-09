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
  items: Array<{ index: number; label: string }>;
}

export interface DialogRequest {
  title: string;
  message?: string;
  frames?: DialogFrames;
  options: DialogOption[];
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
