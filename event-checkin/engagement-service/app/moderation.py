"""Small deterministic safety layer for guest-authored public text.

The filter only flags content; it never deletes or rewrites a response. Human
moderation remains the authority whenever moderation is enabled.
"""
import re


_PROFANITY = re.compile(
    r"\b(?:fuck(?:ing|ed)?|shit(?:ty)?|bitch(?:es)?|asshole|bastard|dick|cunt)\b",
    re.IGNORECASE,
)


def flag_public_text(value: str) -> tuple[bool, str | None]:
    text = (value or "").strip()
    if _PROFANITY.search(text):
        return True, "Possible profanity"
    if re.search(r"https?://|www\.", text, re.IGNORECASE):
        return True, "Contains a public link"
    return False, None
