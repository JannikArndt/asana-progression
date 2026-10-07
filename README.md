# Asana Progression

Finds the moments where yoga poses are held in practice videos, lets you label them fast, and
shows each asana's progression across sessions. Runs entirely on the iPhone, in the browser —
no uploads, no backend.

**App:** https://jannikarndt.github.io/asana-progression/ (Safari → Share → Add to Home Screen)

## Status

Milestone 1 (spike): import a video, watch the posture-change graph draw itself while the video
is decoded, review the detected holds on a zoomable timeline, tune detection parameters, and
collect device diagnostics (decode speed, file handover, HDR rendering, storage quota).

## Development

```sh
npm ci
npm run dev
npm test && npm run check
npm run test:e2e
```

See [CLAUDE.md](CLAUDE.md) for architecture, the detection algorithm and design decisions.
