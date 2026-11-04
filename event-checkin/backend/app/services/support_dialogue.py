"""Small explicit dialogue state. No private records or inferred prices."""
import re
from .support_product_knowledge import product_answer

def normalise(text):
    text=' '.join(str(text or '').lower().split())
    for typo,word in {'evevnt':'event','evnt':'event','creat':'create','seeting':'seating','registation':'registration'}.items():
        text=re.sub(r'\b'+typo+r'\b',word,text)
    return re.sub(r'\bhow d i\b','how do i',text)

def pricing_intent(text):
    return bool(re.search(r'\b(price|pricing|cost|charge|charges|fee|fees|quote|quotation)\b|how much',normalise(text)))

def fact_intent(text):
    text=normalise(text)
    if re.search(r'^how.*\b(create|set up|use|manage|import|arrange|configure|enable)\b',text):return False
    return not pricing_intent(text) and bool(re.search(r'\b(date|venue|address|when)\b|what time|where is|where will',text))

def product_dialogue(text,context):
    text=normalise(text);ctx=dict(context)
    if pricing_intent(text):
        service='Seating' if 'seat' in text or 'table' in text or ctx.get('topic')=='seating' else 'the service'
        guests=re.search(r'\b(\d{1,6})\s*(?:nigerian\s+)?guests?\b',text)
        currency='NGN' if any(w in text for w in ['nigeria','nigerian','ngn','naira','₦']) else 'your event currency'
        scope=(' for '+guests[1]+' guests') if guests else ''
        ctx.update(topic='seating' if service=='Seating' else 'pricing',awaiting='quote_scope')
        return ('I can’t confirm an exact '+currency+' price for '+service+scope+' from the approved information available in this chat. I won’t calculate a price from guest count or reuse another client’s quote.\n\nReview current pricing: /pricing\nFor an existing event, select it and open Billing to check included access and add-on prices before purchasing.\n\nDo you need software access only, or software plus event-day staff?',ctx)
    if fact_intent(text):return None,ctx
    if ctx.get('awaiting')=='quote_scope' and any(w in text for w in ['software','staff','support','both']):
        ctx['awaiting']='quote_request'
        return ('Thanks. A quote needs to distinguish software access from event-day staffing. Current public prices are at /pricing; staffing needs a tailored quote. I can’t confirm an exact amount here. Choose Talk to the team if you want that quote reviewed.',ctx)
    if ctx.get('topic')=='seating' and ctx.get('awaiting')=='existing_event' and (text.startswith('yes') or 'already have' in text):
        ctx['awaiting']='guest_list'
        return ('Use your existing event; you don’t need to create another one.\n\n1. Select it in the event selector and confirm its name.\n2. Open Seating from that event’s workspace; review Billing if access needs enabling.\n3. Add or import your guest list.\n4. Create tables, enter seats per table, then assign guests and review total capacity.\n\nOpen Setup Guide: /setup-redesign?view=wizard\nSeating Help: /guide.html#org-seating\n\nDo you already have your guest list ready?',ctx)
    if ctx.get('topic')=='seating' and ctx.get('awaiting')=='guest_list' and text.startswith('yes'):
        ctx['awaiting']='tables'
        return ('Next, open Seating for the selected event. Create your table groups if needed, then tables with names and capacities. Check total capacity against your guest count before assigning guests.\n\nRead the seating steps: /guide.html#org-seating',ctx)
    if ctx.get('topic')=='seating' and ctx.get('awaiting')=='existing_event' and text.startswith('no'):
        ctx['awaiting']='existing_event'
        return ('Start by creating your event in Setup Guide and choose Arrange tables & seating. After saving, return to Seating to add guests and tables.\n\n/setup-redesign?view=wizard',ctx)
    guidance=product_answer(text)
    if guidance:
        if any(w in text for w in ['seating','arrange tables','seat guests','seats per table','floor plan']):ctx.update(topic='seating',awaiting='existing_event')
        elif any(w in text for w in ['create event','create an event','setup guide']):ctx.update(topic='event_creation',awaiting='first_tool')
        else:ctx.pop('awaiting',None);ctx.pop('topic',None)
        return guidance,ctx
    return None,ctx
