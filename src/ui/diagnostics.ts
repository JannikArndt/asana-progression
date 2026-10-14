import type { Analysis, Hold, Video } from '../model';
import { missingPoseFrames } from './state/session-data';
import type { DecoderSupport, VideoMeta } from '../source';

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

/** Source metadata for reports and exports that get shared: the recording location only says whether there is one. */
export function withoutLocation(m: VideoMeta): Omit<VideoMeta, 'location'> & { location: 'present' | null } {
  return { ...m, location: m.location ? 'present' : null };
}

/** A stored video for a shared report: its metadata snapshot without the coordinates. */
export function videoForReport<T extends { meta?: Record<string, unknown> }>(v: T): T {
  if (!v.meta || !v.meta['location']) return v;
  return { ...v, meta: { ...v.meta, location: 'present' } };
}

/**
 * Diagnostics of one video (no location): stored record, source metadata, handover verdict,
 * decoder support (null unless checked with the file attached), processing stats and analysis.
 */
export function videoDiagnostics(video: Video, analysis: Analysis | null | undefined, decoderSupport: DecoderSupport | null = null, capture: CaptureDiagnostics | null = null) {
  const meta = video.meta as unknown as VideoMeta | undefined;
  return {
    video: { ...video, meta: undefined },
    source: meta ? withoutLocation(meta) : null,
    handover: meta ? assessHandover(meta) : null,
    decoderSupport,
    processing: analysis?.stats ?? null,
    analysis: analysis
      ? { samples: analysis.sampleCount, frame: `${analysis.frameWidth}×${analysis.frameHeight}`, candidates: analysis.candidates.length, threshold: analysis.threshold, singleStill: analysis.singleStill }
      : null,
    capture,
  };
}

export interface CaptureDiagnostics {
  /** The video file is selected in this page session. */
  fileSelected: boolean;
  /** Labeled holds of the video, by capture status (this page session; "unknown" = not requested yet). */
  holds: Record<string, number>;
  /** Failed captures and failed clips (the still was saved): hold best-frame time and message. */
  errors: Array<{ bestS: number; status: string; message: string }>;
  /** Candidate best frames without a pose, and the last frame-pose failure. */
  framePoses: { missing: number; error: string | null };
}

/** Capture state of a video's holds for a diagnostics report (statuses and messages live in the capture queue). */
export function captureDiagnostics(
  holds: Hold[],
  status: Record<string, string>,
  errors: Record<string, string>,
  analysis: Analysis | null | undefined,
  fileSelected: boolean,
  frameError?: string,
): CaptureDiagnostics {
  const counts: Record<string, number> = {};
  const failed: CaptureDiagnostics['errors'] = [];
  for (const h of [...holds].sort((a, b) => a.bestS - b.bestS)) {
    const st = status[h.id] ?? 'unknown';
    counts[st] = (counts[st] ?? 0) + 1;
    if (errors[h.id]) failed.push({ bestS: Math.round(h.bestS * 100) / 100, status: st, message: errors[h.id]! });
  }
  return {
    fileSelected,
    holds: counts,
    errors: failed,
    framePoses: { missing: analysis ? missingPoseFrames(analysis).length : 0, error: frameError || null },
  };
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
