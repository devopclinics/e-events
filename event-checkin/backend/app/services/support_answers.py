"""Approved public answers only. No LLM, guest lookup or personalised pass data."""
import re
from copy import deepcopy

DEFAULTS = dict(enabled=False, welcome='Hi! I’m Festio’s automated helper. Which event can I help with?',
    handover='I’m handing this conversation to the Festio team. Automatic replies are paused while they help you.',
    heading='Your next event. Let’s talk.',intro='Planning an event or need a hand with Festio? Message our team on WhatsApp.',
    message='Hi Festio, I would like some help with my event.',profiles=[])
TOPICS = {
    'time': ['time','date','when','start','gala','dinner'],
    'venue': ['where','venue','address','directions','location','parking'],
    'registration': ['registration','register','rsvp','book','tickets','booking'],
    'programme': ['programme','program','speaker','session','schedule'],
    'dress': ['dress','attire','wear','dress code'],
}

def defaults():return deepcopy(DEFAULTS)

def contains(text,term):return bool(re.search(r'(?<!\w)'+re.escape(term.lower())+r'(?!\w)',text))

def human_request(body):
    text=' '.join(str(body or '').lower().split())
    explicit=['human','agent','speak to someone','talk to someone','talk to staff','speak to staff','contact support','talk to support','customer support','talk to the team','speak to a person','refund','complaint','unsubscribe','stop']
    personal=['my pass','my qr','my seat','my table','my ticket','resend','registration status','payment status','confirm me','confirm my','seat number']
    return text in ['person','support','staff','team'] or any(contains(text,w) for w in explicit+personal)

def answer(config,context,body):
    """Returns (labelled text, new context, mode); pure and previewable."""
    text=' '.join(str(body or '').lower().split())
    raw=context if isinstance(context,dict) else {}
    context={}
    if isinstance(raw.get('event'),str):context['event']=raw['event']
    if isinstance(raw.get('menu'),list) and all(isinstance(x,str) for x in raw['menu']):context['menu']=raw['menu'][:20]
    profiles=[p for p in config.get('profiles',[]) if p.get('approved')]
    byid={p['id']:p for p in profiles}
    handover=lambda:('Festio automated reply\n\n'+config['handover'],context,'human')
    if human_request(text):return handover()
    from .support_product_knowledge import product_answer
    guidance=product_answer(text)
    if guidance:return 'Festio automated reply\n\n'+guidance,context,'auto'
    if any(contains(text,w) for w in ['other event','change event','switch event','events','menu']):context={}
    # Explicit names/aliases only; never infer an event or identity from a phone.
    named=[p for p in profiles if any(contains(text,n) for n in [p['name'],*p.get('aliases',[])] if n)]
    if len(named)>1:context={}
    elif len(named)==1:context={'event':named[0]['id']}
    elif text.isdecimal() and context.get('menu'):
        menu=context['menu'];index=int(text)-1
        if 0<=index<len(menu) and menu[index] in byid:context={'event':menu[index]}
    profile=byid.get(context.get('event'))
    if not profile:
        if not profiles:return handover()
        context={'menu':[p['id'] for p in profiles]}
        menu='\n'.join(f"{i+1}. {p['name']}" for i,p in enumerate(profiles))
        return 'Festio automated reply\n\n'+config['welcome']+'\n\n'+menu+'\n\nReply with the event name or number. Say “human” for the Festio team.',context,'auto'
    topics=[topic for topic,words in TOPICS.items() if any(contains(text,w) for w in words)]
    if topics:
        replies=[profile.get('answers',{}).get(t,'').strip() for t in topics]
        # Missing knowledge is handed over, never guessed or silently omitted.
        if not all(replies):return handover()
        result='\n\n'.join(dict.fromkeys(replies))
        return 'Festio automated reply\n\n'+profile['name']+'\n\n'+result+'\n\nAsk another question, say “events” to switch, or “human” for the Festio team.',context,'auto'
    if text.isdecimal() or named or text in ['hi','hello','hey','thanks','thank you','help']:
        topics=', '.join(t for t,v in profile.get('answers',{}).items() if v.strip())
        return 'Festio automated reply\n\n'+profile['name']+'\n\nAsk about '+(topics or 'the event')+'. Say “human” to speak to the Festio team.',context,'auto'
    return handover()
