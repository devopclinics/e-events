import test from 'node:test';
import assert from 'node:assert/strict';
import {applyWebsiteTemplate} from './websiteDraft.mjs';
const site={template_family:'premium-convention',content:{headline:'Our real headline',use_event_branding:true,use_template_style:false,font_pairing:'elegant-serif',feature_image_url:'https://example.com/book.png',sessions:[{title:'Our programme'}]}};
test('Future templates apply their complete visual identity without deleting content or media',()=>{
 for(const family of ['noor-future','mosaic-future','orbit-future']){
  const next=applyWebsiteTemplate(site,family);
  assert.equal(next.template_family,family);
  assert.equal(next.content.use_event_branding,false);
  assert.equal(next.content.use_template_style,true);
  assert.equal(next.content.use_template_artwork,true);
  assert.equal(next.content.feature_image_url,site.content.feature_image_url);
  assert.equal(next.content.headline,site.content.headline);
  assert.deepEqual(next.content.sessions,site.content.sessions);
 }
 assert.equal(site.content.use_event_branding,true);
});
test('Existing template selection retains its previous style and image settings',()=>{
 for(const family of ['orbit','mosaic','premium-convention'])assert.equal(applyWebsiteTemplate(site,family).content,site.content);
});
