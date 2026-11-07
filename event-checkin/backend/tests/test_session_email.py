from datetime import datetime
from services.session_email import render_session_receipt


def fixture(**changes):
    return dict(first_name='Aisha',event_name='PAMCON 6.0 Conference',admitted_at=datetime(2026,11,11,9),event_timezone='Africa/Lagos',hub_url='https://festio.events/r/sample#/pass',**changes)


def test_conference_receipt_has_no_dinner_seating_and_uses_event_local_time():
    html=render_session_receipt(fixture(),{'primary_color':'#3b0a50','accent_color':'#f3bb53'})
    assert 'YOUR TABLE' not in html and '>SEAT<' not in html
    assert 'You are checked in for the conference.' in html
    assert 'No table assignment is required' not in html
    assert 'font:900 25px/1.35' in html
    assert '10:00 AM WAT' in html and 'Wed, 11 Nov 2026' in html
    assert 'background: #22c55e' not in html


def test_dinner_receipt_shows_distinct_table_and_seat_and_escapes_values():
    html=render_session_receipt(fixture(table_name='Dinner Table 01',seat_number='3'),{'primary_color':'#ffffff'})
    assert 'YOUR TABLE' in html and 'Dinner Table 01' in html and '>SEAT<' in html
    assert 'No table assignment' not in html
    malicious=render_session_receipt({'first_name':'<script>x</script>','event_name':'<img src=x>','table_name':'<b>1</b>','hub_url':'javascript:alert(1)'})
    assert '<script>' not in malicious and '<img src=x>' not in malicious and 'javascript:' not in malicious
    assert '&lt;b&gt;1&lt;/b&gt;' in malicious


def test_compact_layout_and_marketing_link_use_explicit_session():
    html=render_session_receipt(fixture(session_name='Dinner'))
    assert 'You are checked in for Dinner.' in html
    assert 'You are checked in for the conference.' not in html
    assert 'https://festio.events/create-invitation?share=invite' in html
    assert 'Create your free event' in html
    assert 'You’re here.' not in html
