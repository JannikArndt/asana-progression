/** Promise-based modal dialog state (rendered by Dialog.svelte). */
export interface DialogOption {
  id: string;
  label: string;
  detail?: string;
  kind?: 'primary' | 'danger' | 'quiet';
}

export interface DialogRequest {
  title: string;
  message?: string;
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
