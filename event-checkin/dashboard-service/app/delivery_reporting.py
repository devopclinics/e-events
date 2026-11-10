"""Classify provider outcomes without equating acceptance with delivery."""
import re
from collections import defaultdict

CHANNELS = ('email', 'sms', 'whatsapp', 'mms')
FAILED = {'failed', 'undelivered', 'undeliverable', 'error', 'rejected', 'refunded', 'failed_refunded', 'sending_failed', 'delivery_failed', 'skipped', 'deleted', 'invalid_recipient', 'country_not_enabled', 'insufficient_credit', 'bounced', 'complained', 'suppressed'}
DELIVERED = {'delivered', 'read', 'opened', 'clicked'}
PENDING = {'sent', 'success', 'queued', 'accepted', 'reserved', 'sending', 'pending', 'scheduled', 'delayed', 'delivery_delayed'}
LABELS = {'invitations':'Invitations', 'reminders':'Reminders', 'check_in_receipts':'Check-in receipts', 'broadcasts':'Broadcasts', 'other':'Other messages'}

def is_test(kind):
    return bool(set(re.split(r'[^a-z0-9]+', (kind or '').lower())) & {'test', 'tests', 'sample', 'preview', 'qa'})

def message_type(kind):
    key = (kind or '').lower().replace('-', '_')
    if 'reminder' in key: return 'reminders'
    if key.startswith('broadcast'): return 'broadcasts'
    if any(word in key for word in ('checkin', 'check_in', 'admission', 'session_attendance', 'unadmit')): return 'check_in_receipts'
    if 'invit' in key: return 'invitations'
    return 'other'

def outcome(status):
    key = (status or '').lower()
    if key in FAILED: return 'failed'
    if key in DELIVERED: return 'delivered'
    if key in PENDING: return 'pending'
    return 'unknown'

def totals(records):
    counts = {key:0 for key in ('sent', 'delivered', 'failed', 'pending', 'unknown')}
    for record in records:
        counts['sent'] += 1
        counts[outcome(record['status'])] += 1
    counts['rate'] = round(counts['delivered'] / counts['sent'] * 100) if counts['sent'] else None
    return counts

def build_delivery_report(message_rows, email_rows):
    messages = {}
    # One mutable ledger row per send; a matching refund always wins.
    for row_id, channel, action, status, provider_id, reason, guest_test in sorted(message_rows, key=lambda row: row[2] == 'refund'):
        if channel not in CHANNELS or action not in ('spend', 'reserve', 'refund'): continue
        key = (channel, provider_id or f'ledger:{row_id}')
        if action == 'refund' and key not in messages: continue  # a wallet adjustment is not another message
        record = messages.setdefault(key, {'channel':channel, 'status':status, 'kind':reason, 'test':False})
        record['test'] |= bool(guest_test) or is_test(reason)
        if action == 'refund' or outcome(status) == 'failed': record['status'] = 'failed'
        elif outcome(record['status']) != 'failed' and outcome(status) == 'delivered': record['status'] = status
        if message_type(record['kind']) == 'other' and reason: record['kind'] = reason
    # Input is newest-first. Keep the latest status, but retain test metadata
    # even when a subsequent provider callback omitted the message kind.
    for provider_id, provider_event_id, row_id, status, occurred_at, kind, guest_test in email_rows:
        key = ('email', provider_id or provider_event_id or row_id)
        record = messages.setdefault(key, {'channel':'email', 'status':status, 'kind':kind, 'test':False})
        record['test'] |= bool(guest_test) or is_test(kind)
        if not record['kind'] and kind: record['kind'] = kind
    excluded = {channel:0 for channel in CHANNELS}
    live = []
    for record in messages.values():
        if record['test']: excluded[record['channel']] += 1
        else: live.append(record)
    channels = {channel:totals(r for r in live if r['channel'] == channel) for channel in CHANNELS}
    channels['email']['reached'] = channels['email']['delivered']
    breakdown = defaultdict(int)
    for record in live:
        if record['channel'] == 'email':
            key = record['status'] or 'unknown'
            breakdown['delayed' if key == 'delivery_delayed' else key] += 1
    for key in ('sent','delivered','opened','clicked','delayed','bounced','failed','complained','suppressed','unknown'): breakdown.setdefault(key,0)
    channels['email']['breakdown'] = {**breakdown, 'tracked':channels['email']['sent']}
    by_type = []
    for key,label in LABELS.items():
        rows = [r for r in live if message_type(r['kind']) == key]
        if rows:
            by_type.append({'key':key,'label':label,'overall':totals(rows),'channels':{c:totals(r for r in rows if r['channel']==c) for c in CHANNELS}})
    broadcasts = {c:totals(r for r in live if message_type(r['kind'])=='broadcasts' and r['channel']==c) for c in CHANNELS}
    broadcasts['email']['reached'] = broadcasts['email']['delivered']
    return {**channels,'overall':totals(live),'by_type':by_type,'excluded_tests':excluded,'broadcast':broadcasts,'message_delivery':[{'channel':c,**channels[c]} for c in CHANNELS if c!='email' and channels[c]['sent']]}
