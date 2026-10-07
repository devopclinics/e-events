"""Approved structured flyer compositions. No event-specific sample content."""
import html
import math
import re
from pathlib import Path

CSS = Path(__file__).with_name('flyer-modern.css').read_text()
SIZES = {'portrait': (1080,1350), 'square': (1080,1080), 'story': (1080,1920), 'a4': (1080,1527), 'a5': (1080,1532)}
PALETTES = {'forest': ('#184b3a','#d9bd75','#f8f4e9'), 'navy': ('#213d59','#bba67e','#f9f6ef'), 'clay': ('#753f33','#daae78','#fcf0e4')}
def esc(value):
    return html.escape(str(value or ''), quote=True)
def color(value, fallback):
    return value if isinstance(value,str) and re.fullmatch(r'#[0-9a-fA-F]{6}',value) else fallback
def luminance(c):
    channels=[int(c[i:i+2],16)/255 for i in (1,3,5)]
    return sum((v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4)*weight for v,weight in zip(channels,(.2126,.7152,.0722)))
def readable(background,preferred):
    a,b=sorted((luminance(background),luminance(preferred)))
    if (b+.05)/(a+.05)>=4.5:return preferred
    return '#ffffff' if luminance(background)<.179 else '#10251c'

def image_url(value):
    value=str(value or '')
    if value.startswith(('https://','http://','data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')):
        return esc(value)
    return ''

def build_modern_flyer(ctx, size_key, qr_data_uri, fonts):
    options=ctx.get('flyerSettings') or {};layout=ctx['composition'];w=ctx.get('wording') or {}
    width,height=SIZES.get(size_key,SIZES['portrait']);colors=ctx.get('colors') or {}
    primary,accent,paper=PALETTES.get(options.get('palette'),(color(colors.get('primary'),'#184b3a'),color(colors.get('accent'),'#d9bd75'),color(colors.get('background'),'#f8f4e9')))
    text=readable(paper,color(colors.get('text'),primary) if options.get('palette','event')=='event' else primary)
    heading=fonts.get(ctx.get('fontPairing'),fonts['classic-serif'])
    cover=image_url(ctx.get('coverImageUrl'));logo=image_url(ctx.get('logoImageUrl'))
    classes=f'poster {layout}'+(' is-square' if size_key=='square' else ' is-story' if size_key=='story' else '')+(' has-image' if cover else '')
    scale=ctx.get('textScale') or 1
    scale=max(.8,min(float(scale),1.45)) if math.isfinite(float(scale)) else 1
    style=f'--text-scale:{scale};width:{width}px;height:{height}px;--p:{primary};--a:{accent};--cream:{paper};--t:{text};--heading:{heading};--on-primary:{readable(primary,paper)};--on-accent:{readable(accent,primary)}'
    if layout=='artwork-only':
        if not cover: raise ValueError('Upload a finished flyer image before rendering.')
        content=f'<img class="finished-art" src="{cover}" alt="Uploaded flyer">'
    else:
        def value(key):return esc(w.get(key))
        qr=ctx.get('qr') or {};qr_html=''
        if qr.get('enabled') and qr.get('data'):
            qr_html=f'<div class="qr"><img alt="Registration QR" src="{qr_data_uri(qr["data"])}"></div>'
        settings=ctx.get('imageSettings') or {};fit='contain' if settings.get('fit')=='contain' else 'cover'
        pos=settings.get('position','center');pos=pos if pos in ('center','top','bottom','left','right') else 'center'
        art=f'<img class="art-image" src="{cover}" style="object-fit:{fit};object-position:{pos}" alt="{esc(settings.get("alt"))}">' if cover else f'<div class="art-word">{value("footerMessage") or value("footerNote")}</div><span class="arc"></span><span class="arc two"></span><span class="arc three"></span>'
        date=''.join(f'<p>{value(k)}</p>' for k in ['time'] if w.get(k))
        facts=(f'<div><small>Mark your calendar</small><strong>{value("date")}</strong>{date}</div>' if w.get('date') or date else '')
        facts+=(f'<div><small>Meet us here</small><strong>{value("venue")}</strong><p>{value("address")}</p></div>' if w.get('venue') or w.get('address') else '')
        position={'bottom-left':'qr-left','center-bottom':'qr-center'}.get(qr.get('position'),'')
        content=f'''<header class="poster-top"><div class="organizer">{f'<img class="event-logo" src="{logo}" alt="Event logo">' if logo and options.get('showLogo',True) else ''}<div><small>{value('inviteLabel') or 'YOU ARE INVITED'}</small><b>{value('hostName')}</b></div></div></header>
<section class="poster-copy"><h1 class="poster-title">{value('eventTitle') or 'Your event'}</h1><p class="poster-subtitle">{value('eventSubtitle') or value('customMessage')}</p></section>
<div class="art-panel">{art}</div><section class="facts">{facts}</section><footer class="poster-bottom {position}"><div><span class="cta">{value('ctaLabel') or 'Register / RSVP'} ↗</span><p class="bottom-copy">{value('rsvpNote') or value('rsvpBy')}</p><p class="bottom-copy">{esc(' · '.join(str(w[k]) for k in ['phone','email'] if w.get(k)))}</p></div>{qr_html}</footer>'''
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body><article class="{classes}" style="{esc(style)}">{content}</article></body></html>'

# Fit real content before rasterization and PDF output, never crop text silently.
FIT_SCRIPT = r'''() => {
 const poster=document.querySelector('.poster'); if(!poster || poster.classList.contains('artwork-only'))return;
 const scale=parseFloat(getComputedStyle(poster).getPropertyValue('--text-scale'))||1;
 for(const e of poster.querySelectorAll('h1,p,strong,b,.cta,.art-word')){e.style.fontSize=parseFloat(getComputedStyle(e).fontSize)*scale+'px'}
 const title=poster.querySelector('.poster-title'); const copy=poster.querySelector('.poster-copy');
 let size=parseFloat(getComputedStyle(title).fontSize);
 const limit=poster.classList.contains('is-square')?340:poster.classList.contains('is-story')?660:480;
 while((copy.offsetHeight>limit || title.scrollWidth>title.clientWidth+1) && size>44){size-=2;title.style.fontSize=size+'px'}
 const bottom=poster.querySelector('.poster-bottom');
 const art=poster.querySelector('.art-word'),panel=poster.querySelector('.art-panel');
 const artFits=()=>!art||(!art.textContent.trim())||(art.getBoundingClientRect().bottom<=panel.getBoundingClientRect().bottom-15 && art.getBoundingClientRect().top>=panel.getBoundingClientRect().top);
 const fits=()=>artFits() && bottom.offsetTop+bottom.offsetHeight<=poster.clientHeight-35 && [...poster.querySelectorAll('h1,p,strong,b,.cta')].every(e=>e.scrollWidth<=e.clientWidth+1);
 for(let n=0;n<16 && !fits();n++){
  for(const e of poster.querySelectorAll('h1,p,strong,b,.cta,.art-word')){const s=parseFloat(getComputedStyle(e).fontSize);e.style.fontSize=Math.max(15,s*.95)+'px'}
 }
 if(!fits())throw Error('The flyer text is too long for this format. Shorten the title or details, or choose a larger format.');
}'''
