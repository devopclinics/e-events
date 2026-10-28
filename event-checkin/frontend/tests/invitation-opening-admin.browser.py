"""Default envelope activation without any Design Studio API access."""
import copy, json, os, subprocess, tempfile, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
config = {'enabled': False, 'frequency': 'once', 'appearance': None, 'use_default': False}
requests = []
fail_save = False
checks = []

def check(name, condition=True):
    assert condition, name
    checks.append(name)

with tempfile.TemporaryDirectory(prefix='envelope-admin-') as temp:
    build = Path(temp)
    script = """import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter} from "react-router-dom";import Options from "./src/components/invitations/EnvelopeSettings.jsx";createRoot(document.getElementById("root")).render(<BrowserRouter><Options eventId="free-event" event={{name:"Community gathering",is_paid:false}} mode="options"/></BrowserRouter>);',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':JSON.stringify({VITE_FIREBASE_API_KEY:'fixture-key',VITE_FIREBASE_PROJECT_ID:'fixture-project'}),'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'}})"""
    subprocess.run([os.environ.get('FESTIO_NODE', '/home/dev/.local/lib/python3.12/site-packages/playwright/driver/node'), '--input-type=module', '-e', script, str(build/'app.js')], cwd=ROOT, check=True)
    (build/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>')
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs): super().__init__(*args, directory=temp, **kwargs)
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    def route(r):
        global config
        check('request uses invitation endpoint', r.request.url.split('?')[0].endswith('/events/free-event/invitation-opening'))
        requests.append(r.request.method)
        if r.request.method == 'PUT':
            if fail_save: return r.fulfill(status=503, json={'detail': 'Opening service unavailable'})
            payload = r.request.post_data_json
            check('options cannot edit appearance', set(payload) == {'enabled', 'frequency', 'use_default'})
            config = {**config, **payload}
        r.fulfill(json={'envelope_config': copy.deepcopy(config)})
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 390, 'height': 844})
        errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/api/**', route)
        base = f'http://127.0.0.1:{server.server_port}'
        page.goto(base)
        radio = page.get_by_role('radio').nth(1)
        expect(radio).to_be_enabled(); radio.check()
        expect(page.get_by_label('Envelope design', exact=True)).to_have_value('default')
        page.get_by_role('button', name='Preview opening', exact=True).click()
        expect(page.locator('.inv-envelope-seal')).to_have_text('✧')
        page.get_by_role('button', name='Go straight to the invitation').click()
        page.get_by_role('button', name='Save opening options').click()
        expect(page.get_by_role('status')).to_contain_text('Saved.')
        check('default saved without custom design', config['enabled'] and config['use_default'] and config['appearance'] is None)
        page.reload(); expect(page.get_by_role('radio').nth(1)).to_be_checked()
        check('mobile fits', page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        config['appearance'] = {'style': 'pocket', 'palette': 'navy', 'seal': 'silver', 'paper': '', 'initials': 'AB'}
        page.reload(); page.get_by_label('Envelope design', exact=True).select_option('custom')
        page.get_by_role('button', name='Preview opening', exact=True).click()
        expect(page.locator('.inv-envelope-seal')).to_have_text('AB')
        page.get_by_role('button', name='Go straight to the invitation').click()
        page.get_by_role('button', name='Save opening options').click()
        expect(page.get_by_role('status')).to_contain_text('Saved.')
        check('saved custom design selectable', not config['use_default'])
        page.get_by_label('Envelope design', exact=True).select_option('default')
        page.get_by_role('button', name='Save opening options').click()
        expect(page.get_by_role('status')).to_contain_text('Saved.')
        check('default selection retains custom design', config['use_default'] and config['appearance']['initials'] == 'AB')
        fail_save = True; page.get_by_role('radio').first.check()
        page.get_by_role('button', name='Save opening options').click()
        expect(page.get_by_role('alert')).to_contain_text('Opening service unavailable')
        check('failed save retains server settings', config['enabled'])
        check('no JS errors', not errors)
        browser.close()
    server.shutdown()
print(json.dumps({'passed': len(checks), 'studio_requests': 0, 'errors': errors}))
