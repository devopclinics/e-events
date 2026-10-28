"""Envelope wording, identity, visibility and backward-compatible visit keys."""
import copy, json, os, subprocess, tempfile, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
config = {'enabled': True, 'frequency': 'once', 'appearance': {'style':'wax','palette':'ivory','paper':'','seal':'gold','initials':'M'}, 'use_default': False}
requests = []
fail_save = False
checks = []

def check(name, condition=True):
    assert condition, name
    checks.append(name)

with tempfile.TemporaryDirectory(prefix='envelope-admin-') as temp:
    build = Path(temp)
    script = """import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter} from "react-router-dom";import Options from "./src/components/invitations/EnvelopeSettings.jsx";import {envelopeVisitKey} from "./src/components/invitations/InvitationOpening.jsx";window.envelopeVisitKey=envelopeVisitKey;createRoot(document.getElementById("root")).render(<BrowserRouter><Options eventId="free-event" event={{name:"Community gathering",is_paid:false}} mode="design"/></BrowserRouter>);',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':JSON.stringify({VITE_FIREBASE_API_KEY:'fixture-key',VITE_FIREBASE_PROJECT_ID:'fixture-project'}),'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'}})"""
    subprocess.run([os.environ.get('FESTIO_NODE', '/home/dev/.local/lib/python3.12/site-packages/playwright/driver/node'), '--input-type=module', '-e', script, str(build/'app.js')], cwd=ROOT, check=True)
    (build/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>')
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs): super().__init__(*args, directory=temp, **kwargs)
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    def route(r):
        global config
        assert r.request.url.split('?')[0].endswith('/events/free-event/design')
        if r.request.method == 'PUT': config = {**config, **r.request.post_data_json['envelope_config']}
        r.fulfill(json={'event_id':'free-event','envelope_config':copy.deepcopy(config)})
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors=[];page.on('pageerror', lambda e:errors.append(str(e)))
        page.route('**/api/**', route)
        page.goto(f'http://127.0.0.1:{server.server_port}')
        page.get_by_text('Wording & guest names',exact=True).click()
        page.get_by_label('Initials (up to 3)',exact=True).fill('MA')
        values={'Top label':'MUMINEEN ACADEMY','Opening headline':'Together,\nwe light the way.','Envelope inscription':'For our children, with love','Card label':'Our next chapter','Card title':'Annual Fundraising Event','Card message':'Invest in Their Future. Strengthen Our Ummah.','Tap instruction':'Tap the seal to join us','Skip button text':'Explore the event','Opening status text':'Your invitation is opening…'}
        for label,value in values.items():page.get_by_label(label,exact=True).fill(value)
        expect(page.locator('.inv-opening-heading')).to_have_text('Together,\nwe light the way.')
        expect(page.locator('.inv-envelope-seal')).to_have_text('MA')
        expect(page.locator('.inv-envelope-address')).to_have_text('For our children, with love')
        expect(page.locator('.inv-envelope-card strong')).to_have_text('Annual Fundraising Event')
        page.get_by_role('button',name='Save envelope design',exact=True).first.click()
        expect(page.get_by_role('status')).to_contain_text('Saved.')
        check('wording and initials saved', config['appearance']['wording']['skip_label']=='Explore the event' and config['appearance']['initials']=='MA')
        page.reload()
        page.get_by_text('Wording & guest names',exact=True).click()
        for label,value in values.items():expect(page.get_by_label(label,exact=True)).to_have_value(value)
        check('saved wording restored')
        page.get_by_role('checkbox',name='Show opening headline',exact=True).uncheck()
        page.get_by_role('checkbox',name='Show initials',exact=True).uncheck()
        expect(page.locator('.inv-opening-heading')).to_be_hidden()
        expect(page.locator('.inv-envelope-seal')).to_have_text('')
        page.get_by_role('button',name='Save envelope design',exact=True).first.click()
        expect(page.get_by_role('status')).to_contain_text('Saved.')
        page.reload();expect(page.locator('.inv-opening-heading')).to_be_hidden()
        page.get_by_text('Wording & guest names',exact=True).click()
        page.get_by_role('button',name='Open your invitation',exact=True).press('Enter')
        expect(page.locator('.inv-opening')).to_have_attribute('data-revealed','true')
        page.get_by_role('button',name='Finish preview',exact=True).click()
        expect(page.locator('.inv-opening')).to_have_count(0)
        check('hidden initials remain accessible and open correctly')
        page.get_by_role('button',name='Reset wording to defaults',exact=True).click()
        expect(page.locator('.inv-opening-heading')).to_be_visible()
        expect(page.locator('.inv-opening-kicker')).to_have_text('YOU ARE INVITED')
        check('reset wording preserves seal identity',config['appearance']['initials']=='MA')
        page.get_by_label('Opening headline',exact=True).fill('<img src=x onerror=alert(1)>')
        expect(page.locator('.inv-opening-heading img')).to_have_count(0)
        expect(page.locator('.inv-opening-heading')).to_have_text('<img src=x onerror=alert(1)>')
        check('wording rendered as plain text')
        page.set_viewport_size({'width':320,'height':844})
        page.get_by_label('Opening headline',exact=True).fill('W'*120)
        for label,limit in [('Top label',60),('Envelope inscription',80),('Card label',60),('Card title',140),('Card message',100),('Tap instruction',80),('Skip button text',60)]:page.get_by_label(label,exact=True).fill('W'*limit)
        check('long wording fits mobile',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        check('long words fit envelope preview',page.locator('.inv-opening').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
        check('long words fit invitation card',page.locator('.inv-envelope-card').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
        same=page.evaluate("""()=>{const raw={style:'wax',palette:'ivory',paper:'',seal:'gold',initials:'MA'};return window.envelopeVisitKey('fixture',{appearance:{...raw,show_initials:true,wording:{headline:'',show_headline:true}}})==='festio:envelope:fixture:'+JSON.stringify(raw)}""")
        check('default schema fields retain prior visit key',same)
        different=page.evaluate("""()=>{const raw={style:'wax',palette:'ivory',paper:'',seal:'gold',initials:'MA'};return window.envelopeVisitKey('fixture',{appearance:{...raw,wording:{headline:'New greeting'}}})!==window.envelopeVisitKey('fixture',{appearance:raw})}""")
        check('changed wording creates new visit key',different)
        page.get_by_label('Opening headline',exact=True).fill('Dear ')
        page.get_by_role('button',name='{{first_name}}',exact=True).click()
        expect(page.get_by_label('Opening headline',exact=True)).to_have_value('Dear {{first_name}}')
        expect(page.locator('.inv-opening-heading')).to_have_text('Dear Amina')
        page.get_by_label('Sample first name',exact=True).fill('Zara')
        expect(page.locator('.inv-opening-heading')).to_have_text('Dear Zara')
        page.get_by_label('Preview recipient',exact=True).select_option('shared')
        expect(page.locator('.inv-opening-heading')).to_have_text('Dear Guest')
        page.get_by_role('button',name='Save envelope design',exact=True).first.click()
        expect(page.get_by_role('status')).to_contain_text('Saved.')
        check('template saved without sample names',config['appearance']['wording']['headline']=='Dear {{first_name}}' and 'Zara' not in json.dumps(config))
        check('no JavaScript errors',not errors)
        browser.close()
    server.shutdown()
print(json.dumps({'passed':len(checks),'errors':errors}))
