"""Incomplete draft rows are retained in storage, omitted in previews, and gated at publication."""
from copy import deepcopy

REQUIRED = {
    'sessions': ('Programme', ('title',)), 'speakers': ('Speakers', ('name',)),
    'stats': ('At-a-glance cards', ('value', 'label')),
    'registration_facts': ('Registration facts', ('value',)),
    'venue_facts': ('Venue facts', ('value',)), 'faqs': ('FAQs', ('question', 'answer')),
    'tracks': ('Audience tracks', ('title',)), 'exhibitors': ('Exhibitors', ('name',)),
}

def draft_issues(content):
    issues = []
    for key, (label, fields) in REQUIRED.items():
        for i, row in enumerate(content.get(key) or []):
            for field in fields:
                if not str(row.get(field) or '').strip():
                    issues.append({'path':f'{key}.{i}.{field}', 'message':f'{label} {i+1}: enter {field.replace("_", " ")}.'})
    for i, row in enumerate(content.get('feature_sections') or []):
        if not row.get('enabled', True): continue
        if not str(row.get('title') or '').strip() and any(row.get(k) for k in ['summary','image_url','facts','action']):
            issues.append({'path':f'feature_sections.{i}.title','message':f'Content sections: feature section {i+1} needs a title or turn off Show section.'})
        for j, fact in enumerate(row.get('facts') or []):
            if not str(fact.get('value') or '').strip():
                issues.append({'path':f'feature_sections.{i}.facts.{j}.value','message':f'Feature section {i+1}, fact {j+1}: enter a value.'})
    return issues

def complete_preview(content):
    result = deepcopy(content)
    for key, (_, fields) in REQUIRED.items():
        if key in result:
            result[key] = [r for r in result[key] if all(str(r.get(f) or '').strip() for f in fields)]
    for row in result.get('feature_sections') or []:
        row['facts'] = [r for r in row.get('facts') or [] if str(r.get('value') or '').strip()]
    return result
