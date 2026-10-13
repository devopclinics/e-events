from app.schemas import SiteContent
from app.render import render_site

def content(**kw):
 return SiteContent(event_name='PAMCON 2026',headline='PAMCON',industry_editorial=True,start_date='2026-11-10',timezone='Africa/Lagos',primary_action={'label':'Register','url':'https://festio.events/rsvp/registration'},guesthub_url='https://festio.events/rsvp/registration#/guesthub',**kw).model_dump(mode='json')
def test_saved_destinations_and_preview_safety():
 html=render_site(content(),'modern-professional')
 assert 'href="https://festio.events/rsvp/registration"' in html
 assert 'href="https://festio.events/rsvp/registration#/guesthub"' in html
 assert 'onclick="showAction()"' not in html and 'DESIGN REVIEW' not in html
 preview=render_site(content(),'modern-professional',preview=True)
 assert 'Draft preview' in preview and 'onclick="showAction()"' in preview
 assert 'November 10, 2026' in html

def test_opt_in_and_escaped_event_name():
 c=content();c['event_name']='<script>alert(1)</script>'
 html=render_site(c,'modern-professional')
 assert '<script>alert(1)</script>' not in html
 c['industry_editorial']=False
 assert 'poster-date' not in render_site(c,'modern-professional')

def test_pending_venue_has_no_directions_and_confirmed_has_link():
 assert 'Open directions' not in render_site(content(),'modern-professional')
 c=content(venue='Confirmed hall',venue_url='https://maps.google.com/example')
 assert 'Open directions' in render_site(c,'modern-professional')
