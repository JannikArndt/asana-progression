/**
 * Public contract of the progression module: views over holds and their asset references.
 * It does not know how assets were produced or stored.
 */
import type { Asset, Hold, Side } from '../model/types';

export type SideFilter = Side | 'both';

/** Which reps to show: all, or only the first / last hold of each run of reps. */
export type RepFilter = 'all' | 'first' | 'last';

/** Position of a hold in its run of consecutive holds of the same asana and side in a session. */
export interface RepInfo {
  /** 1-based. */
  rep: number;
  of: number;
}

export interface ProgressionItem {
  hold: Hold;
  /** Session date (ISO) used for ordering and captions. */
  date: string;
  note: string;
  still: Asset | undefined;
  thumb: Asset | undefined;
  clip: Asset | undefined;
  rep: number;
  /** Number of reps in this hold's run (1 = a single hold). */
  reps: number;
}
