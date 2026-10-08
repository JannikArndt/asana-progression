/**
 * Public contract of the progression module: views over holds and their asset references.
 * It does not know how assets were produced or stored.
 */
import type { Asset, Hold, Side } from '../model/types';

export type SideFilter = Side | 'both';

export interface ProgressionItem {
  hold: Hold;
  /** Session date (ISO) used for ordering and captions. */
  date: string;
  note: string;
  still: Asset | undefined;
  thumb: Asset | undefined;
  clip: Asset | undefined;
}
