from .render import render_site


def content(**changes):
    return dict(convention_editorial=True,event_name='IEDPU review',headline='Our roots. Our people. Our future.',intro_title='Building bridges.',sessions=[{'date':'2026-11-26','time':'4 PM CST','title':'Arrival & registration','description':'Finish to be confirmed.'},{'date':'2026-11-27','time':'10 AM CST','title':'Sightseeing','description':'Hotel lobby'},{'date':'2026-11-28','time':'6 PM CST','title':'Gala Night','description':'Finish awaiting approval.'}],primary_action={'label':'Family RSVP','url':'https://staging.festio.events/rsvp/test'},**changes)


def test_opt_in_renders_mockup_composition_and_all_three_days():
    page=render_site(content(),'editorial')
    assert 'Our roots.<br>Our people.<br><em>Our future.</em>' in page
    assert 'Thursday, November 26' in page and 'Friday, November 27' in page and 'Saturday, November 28' in page
    assert 'https://staging.festio.events/rsvp/test' in page
    assert page.index('Reconnect') < page.index('YOUR CONVENTION, DAY BY DAY')


def test_content_is_escaped_and_unsafe_actions_are_not_links():
    c=content(summary='<script>alert(1)</script>');c['primary_action']['url']='javascript:alert(2)'
    page=render_site(c,'editorial')
    assert '<script>alert(1)</script>' not in page and '&lt;script&gt;' in page
    assert 'javascript:' not in page


def test_existing_layouts_do_not_switch_without_opt_in():
    c=content();c['convention_editorial']=False
    assert 'Carrying Ilorin' not in render_site(c,'editorial')


def test_generated_visuals_are_separate_from_live_text_and_are_labelled():
    page=render_site(content(convention_artwork_url='https://staging.festio.events/site-assets/concept.png'),'editorial')
    assert page.count('<svg class="concept-visual"') == 5
    assert 'generated promotional imagery' in page
    assert 'AI-generated design concept' in page
    assert 'https://staging.festio.events/rsvp/test' in page


def test_bvn_artwork_and_existing_donation_campaign_are_linked():
    page=render_site(content(feature_sections=[{'id':'bvn','title':'BVN registration','image_url':'https://festio.events/media/bvn.svg'},{'id':'donate','title':'Support our community','action':{'label':'Donate','url':'https://festio.events/give/permanent-token'}}]),'editorial')
    assert 'src="https://festio.events/media/bvn.svg"' in page
    assert 'href="https://festio.events/give/permanent-token"' in page
    assert 'donate-nav' in page


def test_unsafe_feature_images_and_donation_links_are_rejected():
    page=render_site(content(feature_sections=[{'id':'bvn','image_url':'javascript:alert(1)'},{'id':'donate','action':{'label':'Donate','url':'javascript:alert(2)'}}]),'editorial')
    assert 'javascript:' not in page


def test_hotel_directions_preserve_map_query_parameters():
    from html import unescape
    from urllib.parse import urlparse, parse_qs
    import re
    url='https://www.google.com/maps/search/?api=1&query=4440+W+Airport+Freeway'
    page=render_site(content(venue='Wyndham Hotel',venue_address='Irving, Texas',venue_url=url),'editorial')
    target=unescape(re.search(r'href="([^"]+)"[^>]*>Get directions',page)[1])
    assert parse_qs(urlparse(target).query)['query']==['4440 W Airport Freeway']
    assert '&amp;amp;' not in page
