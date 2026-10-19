import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import {authenticatedOrganizerReturn,safeOrganizerDestination} from '../src/pages/organizerGuidance.mjs'

test('all reported registered workspace destinations survive authenticated returns',()=>{
  const event={id:'B',org_id:'org'}
  for(const route of ['/design-studio-redesign','/design-studio-redesign/website','/communications-redesign','/conference-center']){
    assert.equal(safeOrganizerDestination(route,'B',[event]),route+'?event=B')
    assert.equal(authenticatedOrganizerReturn(route+'?event=B',[event]),route+'?event=B')
    assert.equal(authenticatedOrganizerReturn(route+'?event=B',[]),null)
  }
})

test('every literal guide recipe destination is registered and survives safe navigation',()=>{
  const pages=new URL('../src/pages/',import.meta.url),app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
  for(const file of readdirSync(pages).filter(x=>/^guide.*\.mjs$/.test(x))){
    const source=readFileSync(new URL(file,pages),'utf8')
    for(const [,route] of source.matchAll(/\broute:\s*['"]([^'"]+)['"]/g)){
      const pathname=new URL(route,'https://festio.events').pathname
      assert.ok(app.includes(`path="${pathname}"`),`${file}: ${route} must be a registered workspace`)
      assert.ok(safeOrganizerDestination(route,'B',[{id:'B',org_id:'org'}]),`${file}: ${route} must remain usable`)
    }
  }
})

function harness(){
  let selected='A',cursor=0,effects=[],pending=[],resolveEvents
  const states=[],deps=[],cleanups=[]
  const user={id:'owner',role:'admin'}
  const location={pathname:'/setup-redesign',search:'?event=B&view=audience&task=rsvp'}
  const selections=[]
  const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=value}]},
    useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((x,j)=>x!==deps[i][j])){deps[i]=next;pending.push(()=>{cleanups[i]?.();cleanups[i]=fn()})}}}
  const jsx=(type,props)=>({type,props})
  const modules={react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-router-dom':{Navigate:'Navigate',useLocation:()=>location},
    '../context/AuthContext':{useAuth:()=>({user,loading:false})},'../api':{api:{listEvents:()=>new Promise(resolve=>{resolveEvents=resolve})}},
    '../hooks/useCurrentEvent':{useCurrentEvent:()=>[selected,id=>{selected=id;selections.push(id)}]},
    '../pages/organizerGuidance.mjs':{authenticatedOrganizerReturn}}
  const source=readFileSync(new URL('../src/components/ProtectedRoute.jsx',import.meta.url),'utf8')
  const code=transformSync(source,{loader:'jsx',format:'cjs',jsx:'automatic'}).code
  const module={exports:{}}
  runInNewContext(code,{module,exports:module.exports,require:name=>{assert.ok(name in modules,name);return modules[name]},URLSearchParams})
  const render=()=>{cursor=0;const result=module.exports.default({children:'event-tasks'});for(const fn of pending.splice(0))fn();return result}
  return {render,resolve:events=>resolveEvents(events),selections,get selected(){return selected}}
}

test('logged-in deep link authorizes and selects event B before mounting tasks',async()=>{
  const h=harness()
  assert.notEqual(h.render(),'event-tasks');assert.equal(h.selected,'A')
  h.resolve([{id:'B',org_id:'org'}]);await Promise.resolve();await Promise.resolve()
  assert.equal(h.render(),'event-tasks');assert.equal(h.selected,'B');assert.deepEqual(h.selections,['B'])
})

test('unavailable or wrong-tenant event never mounts the previously selected event tasks',async()=>{
  const h=harness();assert.notEqual(h.render(),'event-tasks');h.resolve([{id:'A',org_id:'other-org'}]);await Promise.resolve();await Promise.resolve()
  assert.equal(h.render().props.role,'alert');assert.equal(h.selected,'A');assert.deepEqual(h.selections,[])
})
