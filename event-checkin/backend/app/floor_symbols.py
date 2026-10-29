"""Plan-view symbols for the existing floor-plan PDF data contract."""
from html import escape
import math

def element_svg(el):
    w,h=el.width,el.height;cx,cy=w/2,h/2;kind=el.type;color=escape(el.color or '#e2e8f0');label=escape(el.label or kind)
    parts=[f'<g data-object-type="{escape(kind)}" transform="translate({el.pos_x} {el.pos_y}) rotate({el.rotation} {cx} {cy})"><title>{label}</title>']
    if kind in ('tree','column','water','power'):
        parts.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{w/2}" ry="{h/2}" fill="{color}" stroke="#6e8291" stroke-width="1.3"/>')
    else:
        dash=' stroke-dasharray="6 4"' if kind in ('garden','parking','aisle') else ''
        radius=1 if kind in ('wall','window','aisle') else 6
        parts.append(f'<rect width="{w}" height="{h}" rx="{radius}" fill="{color}" stroke="#7e909e"{dash}/>')
    if kind=='tent':parts.append(f'<path d="M0 {h} L{cx} 0 L{w} {h} M0 0 L{w} {h} M{w} 0 L0 {h}" fill="none" stroke="#9e9b88"/>')
    elif kind=='stage':parts.append(f'<path d="M10 {h-10} H{w-10}" stroke="#719092" stroke-width="4"/><path d="M{w-40} {h}v14h30v-14" fill="#dde9e9" stroke="#8eaaac"/>')
    elif kind=='stairs':parts.extend(f'<line x1="8" y1="{(i+1)*h/7}" x2="{w-8}" y2="{(i+1)*h/7}" stroke="#8fa0b0"/>' for i in range(6))
    elif kind=='door':parts.append(f'<path d="M5 {h-5} V5 M5 {h-5} H{w-5} M{w-5} {h-5} A{w-10} {h-10} 0 0 0 5 5" fill="none" stroke="#657d8c" stroke-dasharray="4 3"/><path d="M5 {h-5} H{w-5}" stroke="#526e82" stroke-width="4"/>')
    elif kind=='window':parts.append(f'<path d="M0 {cy} H{w}" stroke="#4c93b2" stroke-width="2"/>')
    elif kind=='tree':parts.append(f'<ellipse cx="{w*.38}" cy="{h*.4}" rx="{w*.22}" ry="{h*.22}" fill="none" stroke="#6f9875"/><ellipse cx="{w*.63}" cy="{h*.5}" rx="{w*.21}" ry="{h*.24}" fill="none" stroke="#6f9875"/>')
    elif kind=='dancefloor':parts.append(f'<path d="M{w/2} 0v{h} M0 {h/2}h{w}" stroke="#c5a96d"/>')
    elif kind=='parking':parts.extend(f'<path d="M{(i+1)*w/5} 8 V{h*.32} M{(i+1)*w/5} {h*.68} V{h-8}" stroke="#829ab1" fill="none"/>' for i in range(4))
    elif kind=='foodtruck':parts.append(f'<rect x="{w*.15}" y="-4" width="{w*.14}" height="8" rx="3" fill="#596a73"/><rect x="{w*.72}" y="-4" width="{w*.14}" height="8" rx="3" fill="#596a73"/><rect x="{w*.75}" y="10" width="{w*.17}" height="{h-20}" rx="4" fill="#fcf3e6"/>')
    elif kind in ('entrance','exit'):parts.append(f'<path d="M12 {cy}h18m-6-6 6 6-6 6" fill="none" stroke="{("#a35855" if kind=="exit" else "#3e8063")}" stroke-width="2"/>')
    elif kind=='power':parts.append(f'<path d="M{cx+4} {h*.2}l-12 {h*.35}h10l-6 {h*.25} 16-{h*.4}h-10z" fill="#9b7a28"/>')
    elif kind=='water':parts.append(f'<path d="M{cx} {h*.2}q-{w*.4} {h*.5} 0 {h*.6}q{w*.4}-{h*.1} 0-{h*.6}" fill="#73afc9"/>')
    if kind not in ('wall','window','column','tree','power','water','door'):
        parts.append(f'<text x="{cx}" y="{cy+4}" text-anchor="middle" font-family="sans-serif" font-size="{max(8,min(13,w/9))}" font-weight="600" fill="#344e5f">{label}</text>')
    parts.append('</g>');return ''.join(parts)

def table_svg(t, color):
    custom=bool(getattr(t,"color",None));ink="#ffffff" if custom and (int(color[1:3],16)*299+int(color[3:5],16)*587+int(color[5:7],16)*114)/1000<150 else "#233e50"
    paper=color if custom else "#fff";chair=color if custom else "#f7fafb"
    w=max(52,44+t.capacity*4);h=w*.7 if t.shape=='rect' else w;capacity=min(20,max(0,t.capacity));cx,cy=w/2,h/2
    parts=[f'<g data-seating-id="{escape(t.id)}" transform="translate({t.pos_x} {t.pos_y}) rotate({t.rotation} {cx} {cy})">']
    for i in range(capacity):
        if t.shape!='rect':parts.append(f'<rect x="{w/2-5}" y="-13" width="10" height="7" rx="3" fill="{chair}" stroke="{color}" transform="rotate({i/capacity*360} {cx} {cy})"/>')
        else:
            top=i<math.ceil(capacity/2);count=math.ceil(capacity/2) if top else math.floor(capacity/2);j=i if top else i-math.ceil(capacity/2)
            parts.append(f'<rect x="{(j+1)*w/(count+1)-5}" y="{-12 if top else h+5}" width="10" height="7" rx="3" fill="{chair}" stroke="{color}"/>')
    if t.shape=='rect':parts.append(f'<rect width="{w}" height="{h}" rx="8" fill="{paper}" stroke="{color}" stroke-width="2"/>')
    else:parts.append(f'<circle cx="{cx}" cy="{cy}" r="{w/2}" fill="{paper}" stroke="{color}" stroke-width="2"/><circle cx="{cx}" cy="{cy}" r="{max(1,w/2-5)}" fill="{color}" fill-opacity=".055"/>')
    parts.append(f'<text x="{cx}" y="{cy-3}" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="{ink}">{escape(t.name)}</text><text x="{cx}" y="{cy+13}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="{ink if custom else "#71828e"}">{t.seated}/{t.capacity} seats</text></g>')
    return ''.join(parts)
