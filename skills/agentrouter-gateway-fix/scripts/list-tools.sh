#!/bin/bash
set -euo pipefail
set +x

# Discover the tools using the configured lane environment

if [[ $# -lt 1 ]]; then
    printf '%s\n' 'Pass the configured lane directory as the first argument.' >&2
    exit 1
fi

cd -- "$1"
if [[ ! -r mcp-chat.mjs ]]; then
    printf '%s\n' 'Use a configured lane directory containing mcp-chat.mjs.' >&2
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

printf '%s\n' \
    'Expect 12 tools. Inspect their exact names and calling schemas.' \
    'Investigate failed discovery or a different count before proceeding; a count alone does not prove generation works.'

# Keep both captures in memory. FD 3 carries stdout to the outer capture.
# Append stderr there only on failure; never display that capture unmasked.
if response=$(
    exec 3>&1 || exit 1
    if diagnostics=$(node mcp-chat.mjs --list 2>&1 1>&3 3>&-); then
        exit 0
    else
        status=$?
        printf '\n%s' "$diagnostics"
        exit "$status"
    fi
); then
    status=0
    printf '%s\n' "$response"
else
    status=$?
    printf '%s\n' 'Discovery failed. Check the configured lane environment before proceeding.' >&2
    print_sanitized_diagnostics "$response"
fi
unset response

printf 'Discovery command exit status: %s\n' "$status"
exit "$status"
