"""Design Studio rendering smoke test — actually renders every curated
template family through Playwright and checks the output is a real,
well-formed image/PDF, not just a catalogue contract check (that's
catalog.py's template_quality_issues, a separate load-time gate).

Run as: python -m app.template_quality
Exit code 0 = every template rendered cleanly; 1 = any render crashed,
returned empty bytes, or produced output that doesn't match its expected
format signature. Invoked as the last step of deploy.sh so a broken layout/
CSS/font change is caught before "deployment complete" is declared, not
discovered later from an organizer's blank flyer download.
"""
import asyncio
import sys

from .catalog import build_catalog
from .render import render_flyer

_SAMPLE_WORDING = {
    "inviteLabel": "You're invited to celebrate",
    "eventTitle": "Sample Event",
    "eventSubtitle": "A quick smoke-test render — not a real event.",
    "hostName": "Festio",
    "date": "Saturday, January 1",
    "time": "6:00 PM",
    "venue": "Sample Venue",
    "address": "123 Sample Street",
    "rsvpBy": "Kindly reply by Dec 25",
    "phone": "+1 555 0100",
    "email": "hello@example.com",
    "footerMessage": "Can't wait to celebrate with you.",
}

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_PDF_MAGIC = b"%PDF-"


async def _render_one(template: dict, size_key: str, fmt: str) -> str | None:
    """Render one (template, size, format) combo. Returns an error string on
    failure, or None on success."""
    ctx = {
        "template": template,
        "colors": template["defaultColors"],
        "fontPairing": template["fontPairing"],
        "wording": _SAMPLE_WORDING,
        "coverImageUrl": None,
        "imagePosition": {},
        "textScale": 1,
        "qr": {"enabled": True, "position": "bottom-right", "data": "https://festio.events/r/smoke-test"},
    }
    try:
        content = await render_flyer(ctx, size_key, fmt, timeout_s=30)
    except Exception as e:
        return f"{template['id']} {size_key}.{fmt}: render crashed — {e}"
    if not content:
        return f"{template['id']} {size_key}.{fmt}: rendered zero bytes"
    magic = _PNG_MAGIC if fmt == "png" else _PDF_MAGIC
    if not content.startswith(magic):
        return f"{template['id']} {size_key}.{fmt}: output doesn't look like a {fmt.upper()} (bad magic bytes)"
    return None


async def run() -> list[str]:
    """Render one representative PNG size and one PDF size per curated
    template family — every family shares the same renderer set, so this
    catches a broken layout/CSS/font without paying for every supported size."""
    failures: list[str] = []
    for template in build_catalog():
        for size_key, fmt in (("portrait", "png"), ("a5", "pdf")):
            error = await _render_one(template, size_key, fmt)
            if error:
                failures.append(error)
    return failures


def main() -> int:
    failures = asyncio.run(run())
    if failures:
        print(f"Design Studio smoke test FAILED ({len(failures)} issue(s)):", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print(f"Design Studio smoke test OK — {len(build_catalog())} template families rendered successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
