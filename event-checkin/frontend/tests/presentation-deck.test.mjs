import test from 'node:test'
import assert from 'node:assert/strict'
import {presentationDeckSource} from '../src/components/live/presentationDeck.mjs'
const origin='https://festio.events',url=origin+'/presentations/mumineen-zakat/'
test('native HTML deck navigation drives the remote display and clamps slide bounds',()=>{
 const row={source_url:url};assert.deepEqual(presentationDeckSource(row,7,origin),{url:url+'?embed=1&page=7',total_pages:14})
 assert.equal(presentationDeckSource(row,99,origin).url,url+'?embed=1&page=14')
 assert.equal(presentationDeckSource(row,-3,origin).url,url+'?embed=1&page=1')
})
test('PDFs, external links and lookalike external paths preserve their previous source',()=>{
 for(const source_url of ['https://example.com/presentations/mumineen-zakat/','https://example.com/deck.pdf'])assert.equal(presentationDeckSource({source_url},4,origin).url,source_url)
})
