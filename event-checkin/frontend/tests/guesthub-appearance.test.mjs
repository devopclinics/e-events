import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_THEMES, appearanceTokens, validAppTheme, storedAppearance } from '../src/components/guesthub/appearance.mjs';
const lum = hex => hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const contrast = (a,b) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
for (const theme of APP_THEMES) test(`${theme.name} readable text, links and actions`, () => {
  const t=appearanceTokens(theme.id);
  for(const [fg,bg] of [['--ink','--white'],['--muted','--white'],['--green','--white'],['--green','--mint'],['--on-primary','--green'],['--on-sidebar','--deep'],['--on-hero','--hero-bg'],['--warm-ink','--warm-bg']]) assert.ok(contrast(t[fg],t[bg])>=4.5,`${theme.id}: ${fg} on ${bg}`);
  assert.ok(contrast('#203c2d',t['--gold'])>=4.5,'hero action contrast');
});
test('unknown published defaults fall back safely',()=>{for(const v of [null,undefined,{},'bad',''])assert.equal(validAppTheme(v),'event')});
test('blocked browser storage cannot prevent GuestHub rendering',()=>{globalThis.localStorage={getItem(){throw new Error('blocked')}};assert.equal(storedAppearance('event1'),'default');delete globalThis.localStorage});
