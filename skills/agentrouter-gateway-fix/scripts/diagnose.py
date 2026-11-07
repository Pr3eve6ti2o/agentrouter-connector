#!/usr/bin/env python3
"""Match recorded diagnostic patterns and flag weak fragments as POSSIBLE.

Exit codes: 0 unique full match, 1 unmatched, 2 ambiguous full matches,
3 partial matches requiring distinguishing context and further checks.
Historical model cases do not establish current model availability.
"""

# Recorded diagnostic pattern classifier

import re
import sys
from collections import namedtuple


Mode = namedtuple("Mode", "name source signatures")
Match = namedtuple("Match", "number fragments")

MODES = (
    Mode(
        "Upstream transient, cancelled request, or disconnect",
        "`upstream-transient: fetch failed`, "
        "`client cancelled request before upstream response: context canceled`, "
        "`RemoteDisconnected`",
        (
            ("upstream-transient: fetch failed",),
            ("client cancelled request before upstream response: context canceled",),
            ("RemoteDisconnected",),
        ),
    ),
    Mode(
        "Incomplete max_output_tokens with zero text",
        "status `incomplete`, `incomplete_details.reason` equal to "
        "`max_output_tokens`, zero text; usage output 16,000 and reasoning 16,000",
        (
            ("incomplete", "max_output_tokens"),
            ("incomplete_details.reason", "max_output_tokens"),
            ("incomplete", "zero text"),
            ("incomplete_details.reason", "zero text"),
            ("max_output_tokens", "zero text"),
            ("incomplete_details.reason", "max_output_tokens", "zero text"),
            ("usage output 16,000 and reasoning 16,000",),
            ("max_output_tokens", "usage output 16,000 and reasoning 16,000"),
            ("zero text", "usage output 16,000 and reasoning 16,000"),
        ),
    ),
    Mode(
        "Rate limit exceeded",
        "`rate_limit_exceeded` after about two seconds, worker job `6a93fedc`",
        (("rate_limit_exceeded",),),
    ),
    Mode(
        "Upstream state mismatch",
        "`upstream-state-mismatch`",
        (("upstream-state-mismatch",),),
    ),
    Mode(
        "Gateway 502 alternating with 200",
        "gateway 502 alternating with 200 on the same host and key within seconds",
        (
            ("gateway 502",),
            ("502 alternating with 200",),
        ),
    ),
    Mode(
        "Unauthorized client without codex_cli_rs headers",
        "`401 unauthorized client detected` without the `codex_cli_rs` headers",
        (("401 unauthorized client detected",),),
    ),
    Mode(
        "Astra request requires /v1/responses",
        "`please use /v1/responses instead` from an Astra request to "
        "`/v1/chat/completions`",
        (("please use /v1/responses instead",),),
    ),
    Mode(
        "claude-opus-5-5 max_tokens thinking with zero text "
        "(historical only; not currently served)",
        "`claude-opus-5-5` spending the full `max_tokens` budget thinking "
        "while returning zero text",
        (
            ("claude-opus-5-5", "zero text"),
            ("max_tokens", "zero text"),
            ("claude-opus-5-5", "max_tokens", "zero text"),
        ),
    ),
    Mode(
        "DeepSeek and Claude 503 no-channel "
        "(historical only; not currently served)",
        "DeepSeek and Claude 503 `no-channel`",
        (("no-channel",),),
    ),
    Mode(
        "Saved JSON pending after failed job",
        "a saved JSON file remaining `pending` for about two hours "
        "after the job had already failed",
        (
            (
                "saved JSON file",
                "pending",
                "about two hours",
                "after the job had already failed",
            ),
        ),
    ),
    Mode(
        "Worker SIGTERM, Pinggy expiry, proxy expiry, or curl userinfo",
        "worker remaining alive after `SIGTERM`; "
        "Pinggy free tunnel expiring after 60 minutes; "
        "proxy credentials expiring within about 60 seconds; "
        "curl not applying userinfo from proxy environment variables",
        (
            ("worker remaining alive after", "SIGTERM"),
            ("Pinggy free tunnel expiring",),
            ("proxy credentials expiring",),
            ("curl not applying userinfo from proxy environment variables",),
        ),
    ),
    Mode(
        "Old skill max_output_tokens instruction",
        "old skill line 33: `Raise max_output_tokens to 12000 for "
        "gpt-6-astra Responses audits and keep tasks sequential.`",
        (
            ("max_output_tokens to 12000",),
            (
                "Raise max_output_tokens to 12000 for gpt-6-astra "
                "Responses audits and keep tasks sequential.",
            ),
        ),
    ),
    Mode(
        "Parallel whole-file edits discard earlier change",
        "two parallel whole-file edits targeting one file, "
        "the later write discarding the earlier change",
        (
            ("parallel whole-file edits",),
            ("later write discarding the earlier change",),
        ),
    ),
)

# These fragments are hints only, never full diagnoses on their own.
POSSIBLE_FRAGMENTS = {
    2: (
        "incomplete",
        "incomplete_details.reason",
        "max_output_tokens",
        "zero text",
    ),
    8: ("zero text",),
    10: ("pending",),
    12: ("max_output_tokens",),
}


def normalize(text):
    return " ".join(text.replace("`", "").casefold().split())


def contains_fragment(text, fragment):
    literal = normalize(fragment)
    left = r"(?<!\w)" if re.match(r"\w", literal) else ""
    right = r"(?!\w)" if re.search(r"\w$", literal) else ""
    return re.search(left + re.escape(literal) + right, text) is not None


def strength(match):
    return sum(len(normalize(fragment)) for fragment in match.fragments)


def more_specific(candidate, broad):
    """Resolve shared fragments only, never rank unrelated matches."""
    if candidate.number == broad.number:
        return False
    if strength(candidate) <= strength(broad):
        return False

    specific_fragments = tuple(normalize(part) for part in candidate.fragments)
    broad_fragments = tuple(normalize(part) for part in broad.fragments)
    return all(
        any(fragment in specific for specific in specific_fragments)
        for fragment in broad_fragments
    )


def classify(text):
    """Return full recorded matches and shared-fragment preferences only."""
    text = normalize(text)
    fragments = {
        fragment
        for mode in MODES
        for signature in mode.signatures
        for fragment in signature
    }
    present = {
        fragment: contains_fragment(text, fragment)
        for fragment in fragments
    }

    matches = [
        Match(number, signature)
        for number, mode in enumerate(MODES, start=1)
        for signature in mode.signatures
        if all(present[fragment] for fragment in signature)
    ]
    survivors = [
        match
        for match in matches
        if not any(more_specific(other, match) for other in matches)
    ]
    numbers = sorted({match.number for match in survivors})

    preferences = set()
    for broad in matches:
        if broad.number in numbers:
            continue
        alternatives = [
            candidate
            for candidate in survivors
            if more_specific(candidate, broad)
        ]
        if alternatives:
            preferred = max(
                alternatives,
                key=lambda match: (len(match.fragments), strength(match)),
            )
            preferences.add(
                (
                    preferred.number,
                    preferred.fragments,
                    broad.number,
                    broad.fragments,
                )
            )

    return numbers, sorted(preferences)


def possible_matches(text):
    """Find weak fragments without promoting them to full diagnoses."""
    text = normalize(text)
    return [
        Match(number, (fragment,))
        for number, fragments in sorted(POSSIBLE_FRAGMENTS.items())
        for fragment in fragments
        if contains_fragment(text, fragment)
    ]


def show_mode(number):
    mode = MODES[number - 1]
    print(f"Mode {number}: {mode.name}")
    print(f"Source case {number}: {mode.source}")


def show_preferences(preferences):
    for specific_number, specific, broad_number, broad in preferences:
        specific_text = " + ".join(repr(fragment) for fragment in specific)
        broad_text = " + ".join(repr(fragment) for fragment in broad)
        print(
            f"Preferred more specific recorded match {specific_text} "
            f"(mode {specific_number}) over shared substring {broad_text} "
            f"(mode {broad_number})."
        )


def show_possible(matches):
    for match in matches:
        mode = MODES[match.number - 1]
        fragment_text = " + ".join(repr(fragment) for fragment in match.fragments)
        print(
            f"POSSIBLE Mode {match.number}: {mode.name}; "
            f"matched fragment {fragment_text}; "
            "distinguishing context is missing; further checks are required."
        )


def main():
    arguments = sys.argv[1:]
    text = " ".join(arguments) if arguments else sys.stdin.read()
    numbers, preferences = classify(text)

    if not numbers:
        partials = possible_matches(text)
        if partials:
            show_possible(partials)
            return 3
        print("Unmatched input: no recorded error substring matched.")
        return 1

    if len(numbers) > 1:
        print("Ambiguous input: multiple recorded modes match; no unique mode.")
        for number in numbers:
            show_mode(number)
        show_preferences(preferences)
        return 2

    show_mode(numbers[0])
    show_preferences(preferences)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
