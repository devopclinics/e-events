import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import {authenticatedOrganizerReturn,safeOrganizerDestination,eventIdentityFromQuery} from '../src/pages/organizerGuidance.mjs'

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

function harness({initialSelection='A',path='/setup-redesign',search='?event=B&view=audience&task=rsvp',paidOnly=false,guard=()=>true}={}){
  let selected=initialSelection,cursor=0,pending=[]
  const requests=[]
  const states=[],deps=[],cleanups=[]
  const user={id:'owner',role:'admin'}
  const location={pathname:path,search}
  const selections=[]
  const setCurrent=id=>{if(id!==selected&&!guard(id))return;if(id!==selected)selections.push(id);selected=id}
  const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=value}]},
    useRef(initial){const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i]},
    useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((x,j)=>x!==deps[i][j])){deps[i]=next;pending.push(()=>{cleanups[i]?.();cleanups[i]=fn()})}}}
  const jsx=(type,props)=>({type,props})
  const modules={react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-router-dom':{Navigate:'Navigate',useLocation:()=>location},
    '../context/AuthContext':{useAuth:()=>({user,loading:false})},'../api':{api:{listEvents:()=>new Promise(resolve=>{requests.push(resolve)})}},
    '../hooks/useCurrentEvent':{useCurrentEvent:()=>[selected,setCurrent]},
    '../pages/organizerGuidance.mjs':{eventIdentityFromQuery,authenticatedOrganizerReturn}}
  const source=readFileSync(new URL('../src/components/ProtectedRoute.jsx',import.meta.url),'utf8')
  const code=transformSync(source,{loader:'jsx',format:'cjs',jsx:'automatic'}).code
  const module={exports:{}}
  runInNewContext(code,{module,exports:module.exports,require:name=>{assert.ok(name in modules,name);return modules[name]},URLSearchParams})
  const render=()=>{cursor=0;const result=module.exports.default({children:'event-tasks',paidOnly});for(const fn of pending.splice(0))fn();return result}
  return {render,resolve:(events,index=0)=>requests[index](events),selections,switchEvent:setCurrent,
    navigate(to){const url=new URL(to,'https://festio.events');location.pathname=url.pathname;location.search=url.search},
    get selected(){return selected},get requestCount(){return requests.length}}
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

for(const [path,search] of [['/setup/guided','?event=B&recommended=tickets&suggest=setup'],['/admin','?event=B'],['/live','?present=1&event=B&workflow=synthetic']]){
  test(`registered legacy event access is independent of return allowlist: ${path}`,async()=>{
    const h=harness({path,search});assert.notEqual(h.render(),'event-tasks')
    h.resolve([{id:'B',org_id:'org'}]);await Promise.resolve();await Promise.resolve()
    assert.equal(h.render(),'event-tasks');assert.equal(h.selected,'B')
  })
}

test('conflicting duplicate and alias event parameters never authorize a selection',()=>{
  for(const search of ['?event=B&event=C','?event=B&event_id=C','?eventId=B&event_id=']){
    const h=harness({search});assert.equal(h.render().props.role,'alert');assert.equal(h.requestCount,0)
    assert.equal(safeOrganizerDestination('/setup-redesign'+search,'B',[{id:'B'}]),null)
  }
})

test('paid authorization is keyed to B and ignores an older A response',async()=>{
  const events=[{id:'A',is_paid:false},{id:'B',is_paid:true}],h=harness({paidOnly:true,path:'/conference-center'})
  h.render();assert.equal(h.requestCount,2)
  h.resolve(events,0);await Promise.resolve();await Promise.resolve()
  const checking=h.render();assert.notEqual(checking,'event-tasks');assert.notEqual(checking.type,'Navigate')
  assert.equal(h.requestCount,3)
  h.resolve(events,2);await Promise.resolve();await Promise.resolve();assert.equal(h.render(),'event-tasks')
  h.resolve([{id:'A',is_paid:false}],1);await Promise.resolve();await Promise.resolve();assert.equal(h.render(),'event-tasks')
})

test('no stored selection does not redirect paid B while its authorization is pending',async()=>{
  const h=harness({paidOnly:true,initialSelection:'',path:'/conference-center'})
  h.render();h.resolve([{id:'B',is_paid:true}],0);await Promise.resolve();await Promise.resolve()
  const checking=h.render();assert.notEqual(checking.type,'Navigate');assert.notEqual(checking,'event-tasks')
  h.resolve([{id:'B',is_paid:true}],1);await Promise.resolve();await Promise.resolve();assert.equal(h.render(),'event-tasks')
})

test('accepted user switches synchronize the event URL and blocked switches do not',async()=>{
  const h=harness({search:'?event=B&tab=workflow',guard:id=>id!=='D'})
  h.render();h.resolve([{id:'B'},{id:'C'}]);await Promise.resolve();await Promise.resolve();assert.equal(h.render(),'event-tasks')
  h.switchEvent('D');assert.equal(h.render(),'event-tasks');assert.equal(h.selected,'B')
  h.switchEvent('C');const next=h.render();assert.equal(next.type,'Navigate')
  assert.equal(new URL(next.props.to,'https://festio.events').searchParams.get('event'),'C')
  assert.match(next.props.to,/tab=workflow/);h.navigate(next.props.to);h.render()
  h.resolve([{id:'B'},{id:'C'}],1);await Promise.resolve();await Promise.resolve();assert.equal(h.render(),'event-tasks')
  assert.deepEqual(h.selections,['B','C'])
  const alias=harness({path:'/live',search:'?event_id=B&present=1&workflow=synthetic'})
  alias.render();alias.resolve([{id:'B'},{id:'C'}]);await Promise.resolve();await Promise.resolve();alias.render()
  alias.switchEvent('C');const target=new URL(alias.render().props.to,'https://festio.events')
  assert.equal(target.searchParams.get('event_id'),'C');assert.equal(target.searchParams.get('present'),'1')
})
