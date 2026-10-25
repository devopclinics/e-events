"""Paid-sale prerequisites. Confirmation never changes money or bank details."""
import hashlib
from datetime import datetime
from sqlalchemy import select
from .config import settings
from .models import PayoutAccount,OperationsSubscription


def provider_fingerprint(name):
    key=settings.paystack_secret_key if name=='paystack' else settings.stripe_secret_key
    return hashlib.sha256((name+'|'+settings.public_base_url+'|'+key).encode()).hexdigest()


async def checklist(db,cfg,event_currency=None):
    checks=getattr(cfg,'setup_checks',None) or {}
    account=None
    if cfg and cfg.provider_account_id:
        account=await db.scalar(select(PayoutAccount).where(PayoutAccount.org_id==cfg.org_id,
            PayoutAccount.provider==cfg.provider,PayoutAccount.provider_account_id==cfg.provider_account_id))
    alert=await db.scalar(select(OperationsSubscription).where(OperationsSubscription.event_id==cfg.event_id,OperationsSubscription.enabled.is_(True),OperationsSubscription.include_alerts.is_(True))) if cfg else None
    name=cfg.provider if cfg else None
    key=settings.paystack_secret_key if name=='paystack' else settings.stripe_secret_key
    prefix='sk_live_' if settings.environment=='production' else 'sk_test_'
    webhook=bool(cfg and checks.get('webhook_provider')==name and checks.get('webhook_fingerprint')==provider_fingerprint(name)
        and checks.get('webhook_confirmed'))
    currency=bool(cfg and checks.get('currency_confirmed') and checks.get('currency')==cfg.currency)
    modes=bool(cfg and ((name=='paystack' and cfg.currency=='NGN') or (name=='stripe' and cfg.currency=='USD')))
    payout_valid=bool(account and account.currency==cfg.currency and account.charges_enabled and account.payouts_enabled
        and ((account.provider=='paystack' and account.account_name and account.status in {'created','verified'}) or account.status=='verified'))
    payout_confirmed=bool(payout_valid and checks.get('payout_confirmed_account_id')==cfg.provider_account_id and checks.get('payout_fingerprint')==provider_fingerprint(name))
    rows=[
        {'id':'currency','label':'Confirm ticket currency','ready':currency,'detail':f'Tickets charge in {cfg.currency if cfg else "the selected currency"}. Existing prices are never converted.'},
        {'id':'provider','label':'Matching payment provider and credentials','ready':bool(modes and key.startswith(prefix)),'detail':'Paystack / NGN or Stripe / USD with credentials for this environment.'},
        {'id':'payout','label':'Confirm organizer payout routing','ready':payout_confirmed,'detail':'Connect an active account, review its resolved name and last four digits, and explicitly confirm it belongs to the organizer.'},
        {'id':'webhook','label':'Confirm provider dashboard webhook','ready':webhook,'detail':'Explicit dashboard confirmation for the current provider, endpoint and credentials. This does not prove a completed settlement.'},
        {'id':'alerts','label':'Confirm operations alert destination','ready':bool(checks.get('alert_confirmed') and alert and alert.recipient),'detail':'Set and enable an operations report destination before confirming it.'},
    ]
    return {'ready':all(item['ready'] for item in rows),'checks':rows,'currency':cfg.currency if cfg else None,
        'event_currency':event_currency,'webhook_url':settings.public_base_url.rstrip('/')+'/api/ticketing/webhooks/'+(name or 'paystack'),
        'test_mode':settings.environment!='production','paid_checkout_blocked':settings.environment=='production' and not all(item['ready'] for item in rows)}
