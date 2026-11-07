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
