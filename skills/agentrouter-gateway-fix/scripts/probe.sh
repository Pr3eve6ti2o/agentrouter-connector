#!/bin/bash
set -euo pipefail
set +x

# Run the tiny probe using the configured lane environment

if [[ $# -lt 1 ]]; then
    printf '%s\n' 'Pass the configured lane directory as the first argument.' >&2
    exit 1
fi

cd -- "$1"
if [[ ! -r mcp-chat.mjs ]]; then
    printf '%s\n' 'Use a configured lane directory containing mcp-chat.mjs.' >&2
    exit 1
fi

if [[ ! -r prompts/probe.md ]] ||
    [[ "$(<prompts/probe.md)" != 'Reply with exactly these words and nothing else: The probe works.' ]]; then
    printf '%s\n' \
        'Put the verified prompt in prompts/probe.md:' \
        'Reply with exactly these words and nothing else: The probe works.' >&2
    exit 1
fi

print_sanitized_diagnostics() {
    [[ -n "$1" ]] || return 0

    # Only field names are back-referenced, never captured values.
    # Mask quoted assignments before bare tokens; redact headers to line end.
    if ! printf '%s\n' "$1" |
        LC_ALL=C sed -E \
            -e 's/(AGENTROUTER_KEY_[12]=)[[:blank:]]*"([^"\\]|\\.)*"/\1[REDACTED]/g' \
            -e "s/(AGENTROUTER_KEY_[12]=)[[:blank:]]*'([^'\\\\]|\\\\.)*'/\1[REDACTED]/g" \
            -e "s/(AGENTROUTER_KEY_[12]=)[[:blank:]]*[\"'].*$/\1[REDACTED]/g" \
            -e 's/(AGENTROUTER_KEY_[12]=)[[:blank:]]*[^[:space:]]*/\1[REDACTED]/g' \
            -e 's/sk-[A-Za-z0-9][A-Za-z0-9_-]*/[REDACTED]/g' \
            -e "s/([Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn][\"']?[[:blank:]]*:).*/\1 [REDACTED]/g" >&2; then
        printf '%s\n' 'Sanitised diagnostics unavailable; captured output withheld.' >&2 || :
    fi
    return 0
}

probe_response_is_exact() {
    local LC_ALL=C
    local bytes output

    [[ -r probe.md ]] || return 1

    # Match verify.sh: preserve trailing newlines and require the byte count
    # to equal the read length, rejecting dropped bytes (including NULs).
    bytes=$(wc -c < probe.md) || return 1
    output=$(cat probe.md && printf '.') || return 1
    output=${output%.}
    [[ ${#output} -eq "$bytes" ]] || return 1

    # Permit at most one file-terminating newline, and no other extra bytes.
    output=${output%$'\n'}
    [[ "$output" == 'The probe works.' && ${#output} -eq 16 ]]
}

# Remove the old directory entry, not a symlink target. Do not run the caller
# if removal fails: a readable result must belong to this invocation.
if ! rm -f -- probe.md; then
    printf '%s\n' 'Unable to remove the previous probe.md; the probe command was not run.' >&2
    exit 1
fi

if runner_output=$(node mcp-chat.mjs prompts/probe.md probe.md 2>&1); then
    status=0
else
    status=$?
fi

result_status=$status
if [[ "$status" -ne 0 ]]; then
    printf '%s\n' 'Probe failed. Check the configured lane environment before proceeding.' >&2
    print_sanitized_diagnostics "$runner_output"
elif probe_response_is_exact; then
    printf '%s\n' 'The probe works.'
else
    printf '%s\n' \
        'Expected "The probe works." (16 characters); no unverified response is printed.' >&2
    result_status=1
fi
unset runner_output

printf 'Probe child process exit status: %s\n' "$status"
exit "$result_status"
