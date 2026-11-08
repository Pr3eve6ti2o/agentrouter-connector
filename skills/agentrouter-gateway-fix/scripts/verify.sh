#!/usr/bin/env bash
set -euo pipefail

# Verification coverage:
# - Static checks inspect source patterns and structural roles in
#   mcp-server/src/server.ts, mcp-server/src/config.ts,
#   mcp-server/src/upstream.ts and mcp-server/src/tools/jobs.ts for recorded fix
#   markers, client headers, defaults and clamps. They do not exercise gateway
#   runtime behaviour.
# - Historical audit compares the repository's unstaged diff against HEAD
#   with the 2026-11-06 repair-only snapshot (four files) when the index matches HEAD.
#   Its checks are expected to fail on a linted tree.
#   It is reported separately and does not affect the main verdict.
# - Live checks run the lane's mcp-chat.mjs for tool count, server name/version
#   and an exact probe.md response. The probe is connectivity evidence only.
# - Skill format checks scan SKILL.md and regular *.md files recursively under
#   references/ and examples/ for headings, punctuation, tables, Note prefixes,
#   Label bullets and configured secret patterns. Other files are not scanned.
# - skill.yaml is checked only for existence. scripts/diagnose.py,
#   scripts/probe.sh and scripts/list-tools.sh are checked only for executability.
# Not covered: the recorded thirteen-case classifier suite, wrapper failure
# cases, other helper behaviour, metadata contents or general output quality.
# Secret-pattern scans do not replace the required manual credential review.
# Aggregate counts describe these checks, not every supplied file's behaviour.

if [[ -z "${1:-}" || -z "${2:-}" ]]; then
    printf 'Usage: %s <repo-root> <skill-dir> [lane-dir]\n' "$0" >&2
    printf '  lane-dir defaults to $(dirname "$REPO_ROOT")/bawa-wallet/agent-g-android-api1, where REPO_ROOT is <repo-root>.\n' >&2
    exit 1
fi

REPO_ROOT="$1"
SKILL_DIR="$2"
FAILURES=0

check() {
    local description="$1"
    shift
    if "$@"; then
        printf 'PASS: %s\n' "$description"
    else
        printf 'FAIL: %s\n' "$description"
        FAILURES=$((FAILURES + 1))
    fi
}

# Match each pattern against the real output of the command following --.
matches_all() {
    local -a patterns=()
    while [[ $# -gt 0 ]]; do
        if [[ "$1" == -- ]]; then
            shift
            break
        fi
        patterns+=("$1")
        shift
    done
    [[ $# -gt 0 ]] || return 1

    local output pattern
    output=$("$@") || return 1
    for pattern in "${patterns[@]}"; do
        [[ "$output" =~ $pattern ]] || return 1
    done
}

# Inspect integer literals in their structural roles, independent of line numbers.
has_source_roles() {
    python3 - "$@" <<'PY'
import re
import sys
from pathlib import Path

kind, filename, *arguments = sys.argv[1:]
name = None
integer = r"([0-9]+(?:_[0-9]+)*)"

if kind == "optional":
    # Capture the default, lower bound and upper bound in that order.
    name, *expected = arguments
    quoted_name = rf"""(?:"{re.escape(name)}"|'{re.escape(name)}')"""
    pattern = (
        rf"\boptional\s*\(\s*{quoted_name}\s*,\s*{integer}\s*,\s*"
        rf"clampedInteger\s*\(\s*{integer}\s*,\s*{integer}\s*,?\s*\)\s*,?\s*\)"
    )
elif kind == "upstream":
    expected = arguments
    pattern = (
        rf"\bMath\s*\.\s*min\s*\(\s*options\s*\.\s*maxTokens"
        rf"\s*,\s*{integer}\s*,?\s*\)"
    )
elif kind == "jobs":
    # Capture the Astra default, non-Astra default and Astra cap in order.
    expected = arguments
    pattern = (
        rf"\?\s*\(\s*astra\s*\?\s*{integer}\s*:\s*{integer}\s*\)\s*"
        rf":\s*\(\s*astra\s*\?\s*Math\s*\.\s*min\s*\(\s*"
        rf"max_tokens\s*,\s*{integer}\s*,?\s*\)\s*:\s*max_tokens\s*\)"
    )
else:
    sys.exit(1)

try:
    source = Path(filename).read_text(encoding="utf-8")
except (OSError, UnicodeError):
    sys.exit(1)

# Ignore comments and unrelated strings so they cannot supply a passing example.
non_code = r"""//[^\n]*|/\*[\s\S]*?\*/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`"""

def mask(match):
    token = match.group(0)
    if token.startswith(("//", "/*")):
        return " "
    if name is not None and token in (f'"{name}"', f"'{name}'"):
        return token
    return "__literal__"

source = re.sub(non_code, mask, source)
matches = list(re.finditer(pattern, source))
if len(matches) != 1:
    sys.exit(1)

actual = tuple(int(value.replace("_", "")) for value in matches[0].groups())
sys.exit(0 if actual == tuple(map(int, expected)) else 1)
PY
}

has_headers() {
    local output
    output=$("$@") || return 1
    output=${output//\"/}
    output=${output//\'/}

    local originator_pattern='Originator[[:blank:]]*:[[:blank:]]*codex_cli_rs([[:space:],;}]|$)'
    local version_pattern='Version[[:blank:]]*:[[:blank:]]*0\.101\.0([[:space:],;}]|$)'
    local user_agent_pattern='User-Agent[[:blank:]]*:[[:blank:]]*codex_cli_rs/0\.101\.0 \(Mac OS 26\.0\.1; arm64\) Apple_Terminal/464([[:space:],;}]|$)'

    [[ "$output" =~ $originator_pattern &&
       "$output" =~ $version_pattern &&
       "$output" =~ $user_agent_pattern ]]
}

output_equals() {
    local expected="$1"
    shift
    local output
    output=$("$@") || return 1
    [[ "$output" == "$expected" ]]
}

# Static checks.
check 'mcp-server/src/server.ts contains readResponsesStream' matches_all \
    '(^|[^[:alnum:]_])readResponsesStream([^[:alnum:]_]|$)' -- \
    sed -n 'p' "$REPO_ROOT/mcp-server/src/server.ts"

check 'mcp-server/src/env.ts contains the recorded client headers' has_headers \
    sed -n 'p' "$REPO_ROOT/mcp-server/src/env.ts"

check 'mcp-server/src/server.ts uses the shared clientHeaders' matches_all \
    'clientHeaders' -- \
    sed -n 'p' "$REPO_ROOT/mcp-server/src/server.ts"

check 'mcp-server/src/server.ts contains the fatal incomplete-output break' matches_all \
    'gateway status: incomplete \\\(max_output_tokens\\\)' \
    '(^|[^[:alnum:]_])break([^[:alnum:]_]|$)' -- \
    sed -n 'p' "$REPO_ROOT/mcp-server/src/server.ts"

check 'mcp-server/src/server.ts contains the Astra clamp Math.min(max_tokens, config.astraMaxTokens)' matches_all \
    'Math\.min\(max_tokens, config\.astraMaxTokens\)' -- \
    sed -n 'p' "$REPO_ROOT/mcp-server/src/server.ts"

check 'mcp-server/src/server.ts contains stream: true' matches_all \
    'stream: true([^[:alnum:]_]|$)' -- \
    sed -n 'p' "$REPO_ROOT/mcp-server/src/server.ts"

check 'mcp-server/src/config.ts contains retry default 3 and clamp values 1 to 10' has_source_roles \
    optional "$REPO_ROOT/mcp-server/src/config.ts" AGENTROUTER_RETRY_ROUNDS 3 1 10

check 'mcp-server/src/config.ts contains timeout default 1200000 and clamp values 10000 to 1800000' has_source_roles \
    optional "$REPO_ROOT/mcp-server/src/config.ts" AGENTROUTER_TIMEOUT_MS 1200000 10000 1800000

check 'mcp-server/src/config.ts contains Astra cap default 32000 and clamp values 1000 to 32000' has_source_roles \
    optional "$REPO_ROOT/mcp-server/src/config.ts" AGENTROUTER_ASTRA_MAX_TOKENS 32000 1000 32000

check 'mcp-server/src/upstream.ts uses the shared clientHeaders' matches_all \
    'clientHeaders' -- \
    sed -n 'p' "$REPO_ROOT/mcp-server/src/upstream.ts"

check 'mcp-server/src/upstream.ts contains the Astra clamp Math.min(options.maxTokens, astraMaxTokens())' matches_all \
    'Math\.min\(options\.maxTokens, astraMaxTokens\(\)\)' -- \
    sed -n 'p' "$REPO_ROOT/mcp-server/src/upstream.ts"

check 'mcp-server/src/tools/jobs.ts uses the shared Astra ceiling for default and clamp, with non-Astra default 4096 and max_tokens unchanged for non-Astra' matches_all \
    'astra \? astraMaxTokens\(\) : 4096' \
    'Math\.min\(max_tokens, astraMaxTokens\(\)\)' \
    '4096' -- \
    sed -n 'p' "$REPO_ROOT/mcp-server/src/tools/jobs.ts"

# Historical patch snapshot audit, separate from portable verification.
AUDIT_CHECKS=0
AUDIT_FAILURES=0

audit_check() {
    local description="$1"
    shift
    AUDIT_CHECKS=$((AUDIT_CHECKS + 1))
    if "$@"; then
        printf 'AUDIT PASS: %s\n' "$description"
    else
        printf 'AUDIT FAIL: %s\n' "$description"
        AUDIT_FAILURES=$((AUDIT_FAILURES + 1))
    fi
}

historical_unstaged_diff() {
    # A diff against HEAD includes staged changes unless the index matches HEAD.
    # Treat that baseline as unavailable rather than silently widening the scope.
    git -C "$REPO_ROOT" diff --cached --quiet HEAD -- || return 1
    git -C "$REPO_ROOT" diff "$@" HEAD --
}

printf '%s\n' \
    'AUDIT: Historical 2026-11-06 repair-only snapshot; checks are expected to fail on a linted tree; results do not affect the main verdict.' \
    'AUDIT: Baseline: unstaged diff against HEAD (requires the index to match HEAD).' \
    'AUDIT: Covers unstaged changes only; staged, committed and untracked changes are not described by it.' \
    'AUDIT: If the index differs from HEAD, the comparison is unavailable and the audit checks fail.'

audit_check 'Historical 2026-11-06 repair-only snapshot (expected to fail on a linted tree): git diff --shortstat is 4 files changed, 84 insertions(+), 7 deletions(-)' output_equals \
    ' 4 files changed, 84 insertions(+), 7 deletions(-)' \
    historical_unstaged_diff --shortstat

audit_check 'Historical 2026-11-06 repair-only snapshot (expected to fail on a linted tree): git diff --name-only lists exactly the four fix files and excludes mcp-server/sol-work/' output_equals \
    $'mcp-server/src/config.ts\nmcp-server/src/server.ts\nmcp-server/src/tools/jobs.ts\nmcp-server/src/upstream.ts' \
    historical_unstaged_diff --name-only

# Live checks.
LANE_DIR="${3:-$(dirname "$REPO_ROOT")/bawa-wallet/agent-g-android-api1}"

# Part 1 ran the twelve main static checks above; audit checks are separate.
TOTAL_CHECKS=12

# Keep the same reporting behaviour while counting subsequent checks.
check() {
    local description="$1"
    shift
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    if "$@"; then
        printf 'PASS: %s\n' "$description"
    else
        printf 'FAIL: %s\n' "$description"
        FAILURES=$((FAILURES + 1))
    fi
}

run_in_lane() {
    (
        cd "$LANE_DIR" || exit 1
        "$@"
    )
}

has_tool_count() {
    local expected="$1"
    shift
    local output count
    output=$("$@") || return 1
    count=$(printf '%s\n' "$output" |
        grep -oE 'agentrouter_[[:alnum:]_.-]+' |
        LC_ALL=C sort -u |
        wc -l) || return 1
    [[ "$count" -eq "$expected" ]]
}

probe_connectivity() {
    local output bytes
    (
        cd "$LANE_DIR" || exit 1
        mkdir -p prompts || exit 1
        printf '%s' 'Reply with exactly these words and nothing else: The probe works.' > prompts/probe.md || exit 1
        rm -f probe.md || exit 1
        node mcp-chat.mjs prompts/probe.md probe.md || exit 1

        # Preserve trailing newlines during the read and reject dropped bytes.
        bytes=$(wc -c < probe.md) || exit 1
        output=$(cat probe.md && printf '.') || exit 1
        output=${output%.}
        [[ ${#output} -eq "$bytes" ]] || exit 1

        # Remove at most one trailing newline before comparing.
        output=${output%$'\n'}
        [[ "$output" == 'The probe works.' && ${#output} -eq 16 ]]
    )
}

check 'lane discovery lists 12 distinct agentrouter_* tools' has_tool_count \
    12 run_in_lane node mcp-chat.mjs --list

check 'lane discovery names server agentrouter version 1.0.0' matches_all \
    '(^|[^[:alnum:]_])agentrouter([^[:alnum:]_]|$)' \
    '(^|[^[:alnum:]_.])1\.0\.0([^[:alnum:]_.]|$)' -- \
    run_in_lane node mcp-chat.mjs --list

check 'probe.md is exactly The probe works. (16 characters); connectivity evidence only' \
    probe_connectivity

# Skill format checks.
no_matches() {
    local pattern="$1"
    local file="$2"
    local status
    if grep -qE -- "$pattern" "$file"; then
        return 1
    else
        status=$?
        [[ "$status" -eq 1 ]]
    fi
}

# Ignore fenced code when counting headings and detecting table structure.
markdown_structure() {
    local rule="$1"
    local file="$2"
    LC_ALL=C awk -v rule="$rule" '
        {
            line = $0
            sub(/\r$/, "", line)
            if (fence != "") {
                closing = line
                sub(/^ ? ? ?/, "", closing)
                if (substr(closing, 1, length(fence)) == fence &&
                    closing ~ ("^" substr(fence, 1, 1) "+[[:blank:]]*$")) {
                    fence = ""
                }
                next
            }
            if (match(line, /^ ? ? ?(```+|~~~+)/)) {
                fence = substr(line, RSTART, RLENGTH)
                sub(/^ */, "", fence)
                next
            }
            if (line ~ /^ ? ? ?#([[:blank:]]|$)/) {
                headings++
            }
            if (tolower(line) ~ /<table([[:blank:]\/>]|$)/ ||
                (index(line, "|") &&
                 line ~ /^[[:blank:]]*(>[[:blank:]]*)*\|?[[:blank:]]*:?-+:?[[:blank:]]*(\|[[:blank:]]*:?-+:?[[:blank:]]*)*\|?[[:blank:]]*$/)) {
                tables++
            }
        }
        END {
            if (rule == "heading") {
                exit (headings == 1 ? 0 : 1)
            }
            if (rule == "tables") {
                exit (tables == 0 ? 0 : 1)
            }
            exit 1
        }
    ' < "$file"
}

scan_markdown() {
    local file="$1"
    local punctuation_pattern=$'\342\200\223|\342\200\224|\342\200\230|\342\200\231|\342\200\234|\342\200\235'
    local note_pattern='^[[:blank:]]*(>[[:blank:]]*)*([-*+][[:blank:]]+|[[:digit:]]+[.)][[:blank:]]+)?[*_`]*Note[*_`]*:'
    local label_pattern='^[[:blank:]]*(>[[:blank:]]*)*([-*+]|[[:digit:]]+[.)])[[:blank:]]+[*_`]*Label[*_`]*:'
    # Include quoted/spaced shell/config assignments and MCP JSON for the known key names.
    local secret_pattern="sk-[[:alnum:]_-]{8,}|AGENTROUTER_KEY_[12][\"']?[[:blank:]]*=[[:blank:]]*[\"']?[^[:space:]<\"'\$\`]|\"AGENTROUTER_KEY_[12]\"[[:blank:]]*:[[:blank:]]*\"[^[:space:]<\"\$]"

    check "$file has exactly one top-level # heading" markdown_structure heading "$file"
    check "$file has no em dashes, en dashes, or curly quotes" no_matches "$punctuation_pattern" "$file"
    check "$file has no tables" markdown_structure tables "$file"
    check "$file has no Note prefixes" no_matches "$note_pattern" "$file"
    check "$file has no Label bullets" no_matches "$label_pattern" "$file"
    check "$file: no configured secret patterns found" no_matches "$secret_pattern" "$file"
    printf 'MANUAL CREDENTIAL REVIEW REQUIRED: Before claiming %s contains no secrets, separately review it against credentials from the project key file, MCP server config, and project shell history. This pattern scan does not perform that review.\n' "$file"
}

MARKDOWN_FILES=("$SKILL_DIR/SKILL.md")

collect_markdown_files() {
    local file status
    while IFS= read -r -d '' file; do
        if [[ -z "$file" ]]; then
            IFS= read -r -d '' status || return 1
            [[ "$status" -eq 0 ]] || return 1
            return 0
        fi
        MARKDOWN_FILES+=("$file")
    done < <(
        # Send the real find status after an empty NUL-delimited entry.
        status=0
        find "$SKILL_DIR/references" "$SKILL_DIR/examples" -type f -name '*.md' -print0 || status=$?
        printf '\0%s\0' "$status"
    )
    return 1
}

executable_file() {
    [[ -f "$1" && -x "$1" ]]
}

check 'references/ and examples/ Markdown files can be enumerated' collect_markdown_files

for file in "${MARKDOWN_FILES[@]}"; do
    scan_markdown "$file"
done

check 'skill.yaml exists' test -f "$SKILL_DIR/skill.yaml"

for script in scripts/diagnose.py scripts/probe.sh scripts/list-tools.sh; do
    check "$script is executable" executable_file "$SKILL_DIR/$script"
done

BEHAVIOURAL_CHECKS=0
BEHAVIOURAL_FAILURES=0

behavioural_check() {
    local description="$1"
    shift
    BEHAVIOURAL_CHECKS=$((BEHAVIOURAL_CHECKS + 1))
    if "$@"; then
        printf 'BEHAVIOURAL PASS: %s\n' "$description"
    else
        printf 'BEHAVIOURAL FAIL: %s\n' "$description"
        BEHAVIOURAL_FAILURES=$((BEHAVIOURAL_FAILURES + 1))
    fi
}

behavioural_diagnose() {
    local expected_status="$1"
    local expected_mode="$2"
    local input="$3"
    local output status

    if output=$(python3 "$SKILL_DIR/scripts/diagnose.py" "$input" 2>&1); then
        status=0
    else
        status=$?
    fi

    [[ "$status" -eq "$expected_status" ]] || return 1
    if [[ -n "$expected_mode" ]]; then
        [[ "$output" == *"Mode ${expected_mode}:"* ]] || return 1
    fi
    return 0
}

behavioural_check 'diagnose.py classifies recorded Mode 1' behavioural_diagnose 0 1 \
    '`upstream-transient: fetch failed`, `client cancelled request before upstream response: context canceled`, `RemoteDisconnected`'
behavioural_check 'diagnose.py classifies recorded Mode 2' behavioural_diagnose 0 2 \
    'status `incomplete`, `incomplete_details.reason` equal to `max_output_tokens`, zero text; usage output 16,000 and reasoning 16,000'
behavioural_check 'diagnose.py classifies recorded Mode 3' behavioural_diagnose 0 3 \
    '`rate_limit_exceeded` after about two seconds, worker job `6a93fedc`'
behavioural_check 'diagnose.py classifies recorded Mode 4' behavioural_diagnose 0 4 \
    '`upstream-state-mismatch`'
behavioural_check 'diagnose.py classifies recorded Mode 5' behavioural_diagnose 0 5 \
    'gateway 502 alternating with 200 on the same host and key within seconds'
behavioural_check 'diagnose.py classifies recorded Mode 6' behavioural_diagnose 0 6 \
    '`401 unauthorized client detected` without the `codex_cli_rs` headers'
behavioural_check 'diagnose.py classifies recorded Mode 7' behavioural_diagnose 0 7 \
    '`please use /v1/responses instead` from an Astra request to `/v1/chat/completions`'
behavioural_check 'diagnose.py classifies recorded Mode 8' behavioural_diagnose 0 8 \
    '`claude-opus-5-5` spending the full `max_tokens` budget thinking while returning zero text'
behavioural_check 'diagnose.py classifies recorded Mode 9' behavioural_diagnose 0 9 \
    'DeepSeek and Claude 503 `no-channel`'
behavioural_check 'diagnose.py classifies recorded Mode 10' behavioural_diagnose 0 10 \
    'a saved JSON file remaining `pending` for about two hours after the job had already failed'
behavioural_check 'diagnose.py classifies recorded Mode 11' behavioural_diagnose 0 11 \
    'worker remaining alive after `SIGTERM`; Pinggy free tunnel expiring after 60 minutes; proxy credentials expiring within about 60 seconds; curl not applying userinfo from proxy environment variables'
behavioural_check 'diagnose.py classifies recorded Mode 12' behavioural_diagnose 0 12 \
    'old skill line 33: `Raise max_output_tokens to 12000 for gpt-6-astra Responses audits and keep tasks sequential.`'
behavioural_check 'diagnose.py classifies recorded Mode 13' behavioural_diagnose 0 13 \
    'two parallel whole-file edits targeting one file, the later write discarding the earlier change'
behavioural_check 'diagnose.py leaves bare 502 unmatched' behavioural_diagnose 1 '' '502'

wrapper_failure_exit_trap=$(trap -p EXIT)
stub=$(mktemp -d) || exit 1
trap 'rm -rf -- "$stub"' EXIT

mkdir -p "$stub/prompts" || exit 1
printf '%s\n' 'Reply with exactly these words and nothing else: The probe works.' \
    > "$stub/prompts/probe.md" || exit 1

cat > "$stub/mcp-chat.mjs" <<'EOF' || exit 1
#!/usr/bin/env node
console.error('HTTP 401 Unauthorized');
console.error('AGENTROUTER_KEY_2=sk-fake-stub-value-12345678');
console.error('Authorization: Bearer sk-fake-stub-token-12345678');
process.exitCode = 1;
EOF
chmod +x "$stub/mcp-chat.mjs" || exit 1

for script in probe.sh list-tools.sh; do
    if output=$(bash "$SKILL_DIR/scripts/$script" "$stub" 2>&1); then
        status=0
    else
        status=$?
    fi

    behavioural_check "$script exits 1 when mcp-chat.mjs fails" \
        test "$status" -eq 1
    behavioural_check "$script preserves the 401 error text" \
        grep -Fq -- 'HTTP 401 Unauthorized' <<< "$output"
    behavioural_check "$script masks fake secrets as [REDACTED]" \
        bash -c '
            [[ "$1" == *"[REDACTED]"* &&
               "$1" != *"sk-fake-stub-value-12345678"* &&
               "$1" != *"sk-fake-stub-token-12345678"* ]]
        ' _ "$output"
done

rm -rf -- "$stub"
trap - EXIT
eval "$wrapper_failure_exit_trap"

printf 'BEHAVIOURAL PASS: %s checks, BEHAVIOURAL FAIL: %s checks\n' "$((BEHAVIOURAL_CHECKS - BEHAVIOURAL_FAILURES))" "$BEHAVIOURAL_FAILURES"

printf 'PASS: %s checks, FAIL: %s checks\n' "$((TOTAL_CHECKS - FAILURES))" "$FAILURES"
printf 'AUDIT PASS: %s checks, AUDIT FAIL: %s checks\n' "$((AUDIT_CHECKS - AUDIT_FAILURES))" "$AUDIT_FAILURES"
if [[ "$FAILURES" -gt 0 || "$BEHAVIOURAL_FAILURES" -gt 0 ]]; then
    exit 1
fi
exit 0
