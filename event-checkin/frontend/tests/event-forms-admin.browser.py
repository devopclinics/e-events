"""Browser integration of the real organizer editor against isolated API fixtures."""
import json, os, subprocess, tempfile, threading
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('FESTIO_FORMS_ARTIFACTS','/tmp/festio-forms-admin-browser'));OUT.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='festio-forms-editor-') as temp:
    build=Path(temp)
    script="""import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import Editor from "./src/components/forms/EventFormsAdmin.jsx";createRoot(document.getElementById("root")).render(React.createElement(Editor,{eventId:"demo"}));',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':JSON.stringify({VITE_FIREBASE_API_KEY:'fixture-key',VITE_FIREBASE_PROJECT_ID:'fixture-project'}),'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'}})"""
    subprocess.run([os.environ.get('FESTIO_NODE','/home/dev/.local/lib/python3.12/site-packages/playwright/driver/node'),'--input-type=module','-e',script,str(build/'app.js')],cwd=ROOT,check=True)
    (build/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>')
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*a,**kw):super().__init__(*a,directory=temp,**kw)
        def log_message(self,*a):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
    forms=[];grants=[];errors=[];checks=[];fail_publish=False
    def check(name,ok=True):assert ok,name;checks.append(name)
    def api(route):
        p=urlparse(route.request.url).path;m=route.request.method;data=[]
        if not p.startswith('/api/'):return route.continue_()
        body=route.request.post_data_json if m in ['POST','PUT'] else {}
        if p.endswith('/forms'):
            if m=='POST':forms.append({**body,'id':str(len(forms)+1),'version':1,'published_version':None,'archived':False})
            data=forms[-1] if m=='POST' else forms
        elif '/forms/' in p:
            f=next(f for f in forms if f['id']==p.split('/forms/')[1].split('/')[0])
            if p.endswith('/publish'):
                if fail_publish:return route.fulfill(status=503,content_type='application/json',body=json.dumps({'detail':'Publication failed. Please retry.'}))
                f['published_version']=f['version']
            elif m=='PUT':f.update({**body,'version':f['version']+1})
            elif m=='DELETE':f['archived']=True
            data=f
        elif p.endswith('/form-options'):data={'zones':[{'id':'sports','name':'Sports'}],'sessions':[],'tickets':[]}
        elif p.endswith('/form-people'):data=[{'id':'child','name':'Sara Demo'},{'id':'adult','name':'Amina Demo'}]
        elif p.endswith('/consent-authorities'):
            if m=='PUT':grants[:]=[{**body,'id':'grant1'}]
            data=grants
        elif p.endswith('/form-records'):data=[{'title':'Sports','version':1,'guest_name':'Sara Demo','status':'pending'}]
        else:raise AssertionError('Unexpected request '+p)
        route.fulfill(content_type='application/json',body=json.dumps(data))
    with sync_playwright() as pw:
        engine=os.environ.get('FESTIO_FORMS_BROWSER','chromium');options={'headless':True}
        if engine!='webkit':options['args']=['--no-sandbox']
        if engine=='edge':options['executable_path']='/tmp/festio-browser-runtime/edge/opt/microsoft/msedge/msedge'
        browser=(pw.webkit if engine=='webkit' else pw.chromium).launch(**options);page=browser.new_page(viewport={'width':1280,'height':900});page.set_default_timeout(8000);page.on('pageerror',lambda e:(errors.append(str(e)),print('BROWSER ERROR:',e,flush=True)));page.route('**/*',api)
        page.goto(f'http://127.0.0.1:{server.server_port}');page.get_by_label('Choose draft template').select_option('2')
        page.get_by_label('Require completion before entering zone').select_option('sports')
        page.get_by_role('button',name='Save draft version').click();page.get_by_role('button',name='Publish saved version 1').wait_for();check('template creates unpublished independent draft',forms[0]['published_version'] is None and forms[0]['zone_id']=='sports')
        page.get_by_label('Form title',exact=True).fill('Sports final draft');check('cannot publish unsaved edits',page.get_by_role('button',name='Publish saved version 1').is_disabled())
        page.get_by_role('button',name='Save draft version').click();page.get_by_role('button',name='Publish saved version 2').click();page.get_by_role('status').filter(has_text='published').wait_for();check('explicit publish saves selected version',forms[0]['published_version']==2)
        def feedback_in_view():
            return page.locator('.form-feedback').evaluate('(el)=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}')
        check('publication confirmation stays in viewport at action buttons',feedback_in_view())
        check('published button visibly confirms saved state',page.get_by_role('button',name='✓ Published version 2',exact=True).is_disabled())
        check('persistent publication status is beside actions','Published · Version 2' in page.locator('.form-publication').inner_text())
        page.set_viewport_size({'width':390,'height':844});check('confirmation fits phone',feedback_in_view())
        page.get_by_role('button',name='Dismiss confirmation').click();check('dismiss retains publication status','Published · Version 2' in page.locator('.form-publication').inner_text())
        page.get_by_label('Form title',exact=True).fill('Sports reviewed again');page.get_by_role('button',name='Save draft version').click();page.get_by_role('button',name='Publish saved version 3').wait_for()
        check('draft save confirms without scrolling away',feedback_in_view())
        check('unpublished revision distinguishes previous live version','Draft version 3 · Version 2 is published' in page.locator('.form-publication').inner_text())
        fail_publish=True;page.get_by_role('button',name='Publish saved version 3').click();page.get_by_role('alert').filter(has_text='Publication failed').wait_for()
        check('publish error is visible and never claims success',feedback_in_view() and forms[0]['published_version']==2)
        page.screenshot(path=str(OUT/'phone-publication-error.png'),full_page=True)
        fail_publish=False;page.get_by_role('button',name='Publish saved version 3').click();page.get_by_role('status').filter(has_text='version 3 published').wait_for()
        check('retry confirms only after successful publication',forms[0]['published_version']==3 and feedback_in_view())
        page.screenshot(path=str(OUT/'phone-publication-confirmed.png'),full_page=True)
        page.reload();page.get_by_role('button',name='Sports reviewed again').click();check('published state survives reload','Published · Version 3' in page.locator('.form-publication').inner_text())
        page.set_viewport_size({'width':1280,'height':900})
        page.get_by_label('Choose draft template').select_option('1');page.get_by_role('button',name='Save draft version').click();page.get_by_role('status').filter(has_text='Draft saved').wait_for();check('food template stays information form',len(forms)==2 and forms[1]['kind']=='information')
        page.get_by_text('Parent / legal guardian signing permissions',exact=True).click();page.get_by_label('Child / attendee').select_option('child');page.get_by_label('Parent / legal guardian').select_option('adult');check('verification required',page.get_by_role('button',name='Grant signing permission').is_disabled())
        page.get_by_label("I have verified this adult").check();page.get_by_role('button',name='Grant signing permission').click();page.get_by_role('button',name='Revoke',exact=True).wait_for();check('verified permission can be granted')
        page.get_by_role('button',name='Revoke',exact=True).click();page.get_by_role('status').filter(has_text='revoked').wait_for();check('permission can be revoked',not grants[0]['active'])
        page.get_by_text('Completion records and export',exact=True).click();page.get_by_role('button',name='Current completion status',exact=True).click();page.get_by_role('button',name='Export CSV',exact=True).wait_for()
        with page.expect_download() as info:page.get_by_role('button',name='Export CSV',exact=True).click()
        check('completion CSV downloads',info.value.suggested_filename=='event-form-records.csv')
        page.screenshot(path=str(OUT/'organizer-forms.png'),full_page=True);check('no runtime errors',not errors)
        (OUT/'validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'browser':browser.version,'scope':'Real organizer component; isolated API fixtures, no live writes'},indent=2));print(json.dumps({'passed':len(checks),'errors':errors}));browser.close()
    server.shutdown()
