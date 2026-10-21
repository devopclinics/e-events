from app.journey_templates import candidates


def test_reviewed_copy_has_bounded_cadence_and_one_useful_next_step():
    templates=candidates()
    assert {t['stage'] for t in templates.values()}=={'registered','event_created'}
    for template in templates.values():
        assert len(template['steps']) in {3,4}
        times=[s['delay_hours'] for s in template['steps']]
        assert times==sorted(set(times)) and times[0]==0
        for step in template['steps']:
            assert len(step['subject'])<=65
            assert len(step['body'].split())<=85
            assert step['cta'] and step['cta_url'].startswith('https://festio.events/')
            assert not any(x in step['body'].lower() for x in ['guaranteed','unlimited','no extra charge','confirmed booking'])
    assert 'last reminder' in templates['New registration welcome']['steps'][-1]['body']


def test_infographics_are_selective_and_readable_without_images():
    from app.email_infographics import render_infographic
    for stage, index in [('registered', 0), ('registered', 2), ('event_created', 0)]:
        html, text = render_infographic({'stage': stage, 'journey_context': True}, index)
        assert 'role="presentation"' in html
        assert '<img' not in html and '<svg' not in html and '<script' not in html
        assert '<a ' not in html  # Keep the existing event CTA as the one primary action.
        assert 'Availability depends on your plan' in html
        assert 'Availability depends on your plan' in text
    assert render_infographic({'stage': 'registered'}, 0) == ('', '')
    assert render_infographic({'stage': 'registered', 'journey_context': True}, 3) == ('', '')
    html, text = render_infographic({'stage': 'registered', 'journey_context': True}, 2)
    for capability in ['ticketing', 'seating', 'meal headcounts', 'Festio Live', 'FestioMe']:
        assert capability in html and capability in text
