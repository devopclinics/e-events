import test from 'node:test';import assert from 'node:assert/strict';
import {presentation,sectionStyle,SECTION_ORDER} from './presentation.mjs';
import {contrastRatio} from './themeContrast.mjs';
test('invalid saved controls safely fall back without hiding sections',()=>{const p=presentation({shape:'bad',spacing:'bad',sectionOrder:['faq','faq','unknown'],sectionColors:{hero:'url(secret)',faq:'#111111',unknown:'#ffffff'}});assert.equal(p.shape,'theme');assert.equal(p.spacing,'comfortable');assert.deepEqual(p.sectionOrder,['faq',...SECTION_ORDER.filter(k=>k!=='faq')]);assert.deepEqual(p.sectionColors,{faq:'#111111'});});
test('per-section colors maintain readable ink for light dark and vivid brands',()=>{for(const background of ['#ffffff','#111111','#14b8a6','#f5c542']){const style=sectionStyle(presentation({sectionColors:{hero:background}}),'hero');assert.ok(contrastRatio(style.color,background)>=4.5);}});
