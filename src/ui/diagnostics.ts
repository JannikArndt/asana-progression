import type { VideoMeta } from '../source';

export interface HandoverAssessment {
  verdict: 'original' | 'transcoded' | 'unknown';
  reasons: string[];
}

/**
 * Heuristic: does this look like the camera original or a copy transcoded by the iOS picker?
 * Facts are listed so the verdict can be checked by hand.
 */
export function assessHandover(m: VideoMeta): HandoverAssessment {
  const reasons: string[] = [];
  const apple = Boolean(m.make || m.model || m.quicktimeCreationDate);
  reasons.push(apple ? 'Apple camera metadata present (make/model/creationdate)' : 'No Apple camera metadata');
  reasons.push(`Codec ${m.profile ?? m.codec ?? 'unknown'}`);
  if (m.color?.transfer) reasons.push(`Transfer ${m.color.transfer}${m.hdr ? ' (HDR)' : ''}`);
  if (m.averageBitrate) reasons.push(`≈ ${(m.averageBitrate / 1e6).toFixed(1)} Mbit/s`);
  if (/^IMG_\d+\.(mov|mp4)$/i.test(m.fileName)) reasons.push('Camera-style file name (IMG_####)');
  else reasons.push(`File name "${m.fileName}"`);
  let verdict: HandoverAssessment['verdict'] = 'unknown';
  if (apple && (m.codec === 'hevc' || m.hdr)) verdict = 'original';
  else if (!apple && m.codec === 'avc') verdict = 'transcoded';
  else if (apple) verdict = 'original';
  return { verdict, reasons };
}

export interface DeviceInfo {
  userAgent: string;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  screen: string;
  standalone: boolean;
  webCodecs: boolean;
  offscreenCanvas: boolean;
  wakeLock: boolean;
  opfs: boolean;
  jsHeapUsedMb: number | null;
}

export function deviceInfo(): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    userAgent: nav.userAgent,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    screen: `${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
    standalone: matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
    webCodecs: typeof VideoDecoder !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    wakeLock: 'wakeLock' in nav,
    opfs: typeof nav.storage?.getDirectory === 'function',
    jsHeapUsedMb: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null,
  };
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** Copies text to the clipboard, falling back to a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Shares a file via the share sheet when possible (iOS: save to Files, AirDrop), else downloads it. */
export async function shareOrDownload(name: string, blob: Blob): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
