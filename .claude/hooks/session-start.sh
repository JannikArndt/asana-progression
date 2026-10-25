#!/bin/bash
# .claude/hooks/session-start.sh — template from the app-conventions skill.
# A cloud session starts from a fresh clone: without this, the first `verify`
# falls over on a missing package. Does nothing on your own machine.
# Wire it in .claude/settings.json:
#   {"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"}]}]}}
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# install, not ci: a container that already has them keeps them
[ -f package.json ] && npm install --no-audit --no-fund

# Playwright: cloud containers ship a Chromium (PLAYWRIGHT_BROWSERS_PATH);
# fetching a second one is a download nobody needs.
if grep -q '"playwright\|"@playwright/test' package.json 2>/dev/null && [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -z "${PW_CHROMIUM_PATH:-}" ] && [ ! -d /opt/pw-browsers ]; then
  npx playwright install chromium
fi
exit 0
