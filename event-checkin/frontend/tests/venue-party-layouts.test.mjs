import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const dir = mkdtempSync(path.join(tmpdir(), 'venue-party-layout-'))
const output = path.join(dir, 'render.cjs')
await build({ stdin: { contents: `
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ConventionGuestHub from './src/components/convention/ConventionReview.jsx';
export function render(screen, enabled=true, preview=false) {
 global.window={location:{hash:'#/'+screen,search:'',origin:'https://festio.events'}};
 return renderToStaticMarkup(<ConventionGuestHub event={{id:'fixture',name:'Fixture Convention',event_code:'fixture',self_checkin_enabled:enabled,venue_name:'Venue'}} hub={{guest:{name:'Fixture Guest',qr_token:'synthetic-private-pass',rsvp_status:'confirmed'}}} config={{previewOnly:false,schedule:[]}} previewMock={preview}/>);
}`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty' }, outfile: output })
const { render } = createRequire(import.meta.url)(output)
for (const screen of ['home', 'pass']) {
  test(`custom convention ${screen} includes credential-scoped venue check-in`, () => {
    const html = render(screen)
    assert.match(html, /href="\/e\/fixture#token=synthetic-private-pass"/)
    assert.match(html, /Check in at the venue/)
  })
  test(`custom convention ${screen} hides check-in when disabled`, () => {
    assert.doesNotMatch(render(screen, false), /Check in at the venue/)
  })
  test(`custom convention ${screen} preview cannot open real check-in`, () => {
    assert.doesNotMatch(render(screen, true, true), /Check in at the venue/)
  })
}
test.after(() => { delete global.window; rmSync(dir, { recursive: true, force: true }) })
