import hashlib
import hmac
import json
import uuid
import time
import httpx
from fastapi import HTTPException
from .config import settings


class PaymentProvider:
    async def create_checkout(self, *, order_id, access_token, email, amount, currency, account_id, fee, direct=False):
        raise NotImplementedError

    async def refund(self, *, reference, amount, idempotency_key=None):
        raise NotImplementedError


class FakeProvider(PaymentProvider):
    async def create_checkout(self, **kw):
        ref = f"fake_{uuid.uuid4().hex}"
        return ref, (f"{settings.public_base_url}/api/ticketing/public/test-checkout/{ref}"
                     f"?token={kw['access_token']}")

    async def refund(self, **kw):
        return {"id": f"fake_refund_{uuid.uuid4().hex}", "status": "succeeded"}


class StripeProvider(PaymentProvider):
    async def create_checkout(self, *, order_id, access_token, email, amount, currency, account_id, fee, direct=False):
        if not settings.stripe_secret_key:
            raise HTTPException(503, "Stripe credentials are not configured")
        data = {
            "mode": "payment", "customer_email": email,
            "success_url": f"{settings.public_base_url}/tickets/orders/{order_id}?token={access_token}&checkout=success",
            "cancel_url": f"{settings.public_base_url}/tickets/orders/{order_id}?token={access_token}&checkout=cancelled",
            "client_reference_id": order_id, "metadata[order_id]": order_id,
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": currency.lower(),
            "line_items[0][price_data][unit_amount]": str(amount),
            "line_items[0][price_data][product_data][name]": "Festio event tickets",
        }
        if direct:
            data["payment_method_types[0]"] = "card"
        if direct and not account_id:
            raise HTTPException(409, "Select a verified organizer account before checkout")
        if account_id:
            if not direct:
                data["payment_intent_data[transfer_data][destination]"] = account_id
            data["payment_intent_data[application_fee_amount]"] = str(fee)
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post("https://api.stripe.com/v1/checkout/sessions", data=data,
                                    auth=(settings.stripe_secret_key, ""),
                                    headers={"Stripe-Account": account_id, "Idempotency-Key": f"festio-checkout-{order_id}"} if direct else {"Idempotency-Key": f"festio-checkout-{order_id}"})
        if res.status_code >= 400:
            raise HTTPException(502, "Stripe could not create checkout")
        body = res.json()
        return body["id"], body["url"]

    async def refund(self, *, reference, amount, idempotency_key=None, account_id=None):
        data = {"payment_intent": reference, "refund_application_fee": "true"}
        if not account_id:
            data["reverse_transfer"] = "true"
        if amount is not None:
            data["amount"] = str(amount)
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else {}
        if account_id:
            headers["Stripe-Account"] = account_id
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post("https://api.stripe.com/v1/refunds", data=data,
                                    auth=(settings.stripe_secret_key, ""), headers=headers)
        if res.status_code >= 400:
            raise HTTPException(502, "Stripe refund failed")
        return res.json()


class PaystackProvider(PaymentProvider):
    async def create_checkout(self, *, order_id, access_token, email, amount, currency, account_id, fee, direct=False):
        if not settings.paystack_secret_key:
            raise HTTPException(503, "Paystack credentials are not configured")
        payload = {"email": email, "amount": amount, "currency": currency,
                   "reference": f"festio_{order_id}",
                   "callback_url": f"{settings.public_base_url}/tickets/orders/{order_id}?token={access_token}&checkout=success",
                   "metadata": {"order_id": order_id}}
        if account_id:
            payload.update({"subaccount": account_id, "transaction_charge": fee, "bearer": "subaccount"})
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post("https://api.paystack.co/transaction/initialize", json=payload,
                                    headers={"Authorization": f"Bearer {settings.paystack_secret_key}"})
        if res.status_code >= 400 or not res.json().get("status"):
            raise HTTPException(502, "Paystack could not create checkout")
        data = res.json()["data"]
        return data["reference"], data["authorization_url"]

    async def refund(self, *, reference, amount, idempotency_key=None):
        payload = {"transaction": reference}
        if amount is not None:
            payload["amount"] = amount
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post("https://api.paystack.co/refund", json=payload,
                                    headers={"Authorization": f"Bearer {settings.paystack_secret_key}"})
        if res.status_code >= 400:
            raise HTTPException(502, "Paystack refund failed")
        return res.json().get("data", {})


def provider(name: str) -> PaymentProvider:
    return {"stripe": StripeProvider(), "paystack": PaystackProvider(), "fake": FakeProvider()}[name]


def verify_paystack(raw: bytes, signature: str) -> bool:
    digest = hmac.new(settings.paystack_secret_key.encode(), raw, hashlib.sha512).hexdigest()
    return bool(signature) and hmac.compare_digest(digest, signature)


def verify_stripe(raw: bytes, signature: str, *, secret: str | None = None) -> dict:
    try:
        parts = dict(item.split("=", 1) for item in signature.split(","))
        if abs(time.time() - int(parts["t"])) > 300:
            raise ValueError
        signed = f"{parts['t']}.".encode() + raw
        key = settings.stripe_webhook_secret if secret is None else secret
        if not key:
            raise ValueError
        expected = hmac.new(key.encode(), signed, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, parts["v1"]):
            raise ValueError
        return json.loads(raw)
    except Exception as exc:
        raise HTTPException(400, "Invalid Stripe signature") from exc
