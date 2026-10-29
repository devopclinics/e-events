"""Actionable provider errors without request payloads or credentials."""
import logging
import re

from fastapi import HTTPException


def stripe_onboarding_error(response, action, private_values=()):
    try:
        error = response.json().get("error", {})
        message = error.get("message") if isinstance(error, dict) else None
        code = error.get("code") if isinstance(error, dict) else None
    except (ValueError, AttributeError):
        message = code = None
    message = message if isinstance(message, str) else "Stripe did not provide an error description."
    for value in private_values:
        if value:
            message = message.replace(str(value), "[redacted]")
    message = re.sub(r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_]+", "[redacted]", message)
    message = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[redacted email]", message)
    message = " ".join(message.split())[:700]
    code = code if isinstance(code, str) and re.fullmatch(r"[a-z0-9_]{1,100}", code) else None
    request_id = response.headers.get("request-id", "")
    request_id = request_id if re.fullmatch(r"req_[A-Za-z0-9]{1,100}", request_id) else None
    reference = " · ".join(value for value in (code, request_id) if value)
    detail = f"Stripe could not {action}: {message}"
    if reference:
        detail += f" ({reference})"
    logging.getLogger(__name__).warning("%s [provider_status=%s]", detail, response.status_code)
    return HTTPException(502, detail)
