### Manual crops vs the automatic crop today (66 manual crops on holds with a pose, 236 holds with a pose)

Contained in the automatic crop (2 % tolerance): 16 of 66. Holds with a low-visibility landmark outside the automatic crop: 1.

| Side | Beyond auto (count) | Median | p75 | Max |
|---|---|---|---|---|
| left | 24 | -1 % | 5 % | 48 % |
| right | 33 | 2 % | 9 % | 36 % |
| top | 41 | 9 % | 16 % | 84 % |
| bottom | 28 | 0 % | 6 % | 66 % |

Extent beyond the automatic crop in units of its width (left/right) or height (top/bottom); negative = tighter.

| Cause | left | right | top | bottom | All |
|---|---|---|---|---|---|
| detection error (boxes barely overlap) | 0 | 1 | 1 | 1 | 3 |
| extremity: fingers beyond the hand landmarks | 1 | 1 | 0 | 3 | 5 |
| extremity: toes beyond the foot landmarks | 2 | 4 | 0 | 0 | 6 |
| small (≤ 10 % of the box): taste / composition | 8 | 8 | 2 | 2 | 20 |
| taste / composition (no body part at that edge) | 4 | 9 | 31 | 5 | 49 |

### Fit of the box geometry (2700 sets; leave one session out)

| Held out | Fitted on the other two | Contained today | Contained with the fit | Median area ratio |
|---|---|---|---|---|
| S1 | pad 0.18, padTop 0.05, footReach 0.5 | 11 of 39 | 24 of 39 | 1.21 |
| S2 | pad 0.18, padTop 0.05, handReach 1.5 | 2 of 12 | 6 of 12 | 1.18 |
| S3 | pad 0.18, padTop 0.05 | 3 of 15 | 5 of 15 | 1.15 |

Fitted on all sessions: pad 0.18, padTop 0.05, footReach 0.5 — contained 37 of 66 (today 16), median area ratio 1.20.
Adopted (BOX_DEFAULTS, CROP_VERSION 3): pad 0.18, padTop 0.05, footReach 0.5 — contained 37 of 66, median area ratio 1.199.
