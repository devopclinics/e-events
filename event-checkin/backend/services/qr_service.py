import io
import qrcode
import qrcode.constants


def generate_qr_for_url(url: str) -> bytes:
    """QR PNG encoding an arbitrary URL (used for the self check-in event link)."""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate_qr_bytes(qr_token: str, base_url: str) -> bytes:
    return generate_qr_for_url(f"{base_url.rstrip('/')}/scan/{qr_token}")
