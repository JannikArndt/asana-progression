# Asana Progression

Finds the moments where yoga poses are held in practice videos, lets you label them fast, and
shows each asana's progression across sessions. Runs entirely on the iPhone, in the browser —
no uploads, no backend.

**App:** https://jannikarndt.github.io/asana-progression/ (Safari → Share → Add to Home Screen)

## Status

Milestones 1–2: import a video, watch the posture-change graph draw itself while the video
is decoded, label the detected holds with one tap (suggestions follow the Primary series or your
recent practice), fix them up (choose frame, split, merge, add missed holds), browse holds per
asana, tune detection parameters, and collect device diagnostics.

## Development

```sh
npm ci
npm run dev
npm test && npm run check
npm run test:e2e
```

See [CLAUDE.md](CLAUDE.md) for architecture, the detection algorithm and design decisions.
