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
