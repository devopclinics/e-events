import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdtemp,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
const dir=await mkdtemp(path.join(os.tmpdir(),'juniors-team-'))
await build({entryPoints:['src/utils/juniorVolunteers.js'],outfile:path.join(dir,'hub.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom'],loader:{'.css':'empty','.svg':'dataurl'},packages:'external'})
// Keep React resolution in the application's dependency tree.
const target=path.join(process.cwd(),'node_modules','.junior-hub-test.mjs')
await writeFile(target,await(await import('node:fs/promises')).readFile(path.join(dir,'hub.mjs')))
const {parseVolunteers}=await import(pathToFileURL(target));await(await import('node:fs/promises')).unlink(target)
test('Spreadsheet and comma-separated volunteer rows retain optional international phone',()=>{assert.deepEqual(parseVolunteers('Amina Yusuf\tamina@example.com\t+12025550146\nMusa Bello\tmusa@example.com'),[{name:'Amina Yusuf',email:'amina@example.com',phone:'+12025550146'},{name:'Musa Bello',email:'musa@example.com',phone:null}]);assert.equal(parseVolunteers('Amina, amina@example.com')[0].name,'Amina')})
test('Ambiguous columns fail instead of assigning the wrong contact',()=>{assert.throws(()=>parseVolunteers('Only a name'),/Row 1/);assert.throws(()=>parseVolunteers('Last, First, email@example.com, +12025550146'),/Row 1/)})
