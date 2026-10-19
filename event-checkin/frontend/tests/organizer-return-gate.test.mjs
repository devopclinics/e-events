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
    useContext(){return null},useRef(initial){const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i]},
    useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((x,j)=>x!==deps[i][j])){deps[i]=next;pending.push(()=>{cleanups[i]?.();cleanups[i]=fn()})}}}
  const jsx=(type,props)=>type==='Provider'||type==='div'&&!props.role&&'aria-busy' in props?props.children:({type,props})
  const modules={react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-router-dom':{Navigate:'Navigate',useLocation:()=>location,useNavigate:()=>()=>{},UNSAFE_LocationContext:{Provider:'Provider'},UNSAFE_RouteContext:{Provider:'Provider'},UNSAFE_NavigationContext:{}},
    '../context/AuthContext':{useAuth:()=>({user,loading:false})},'../api':{api:{listEvents:()=>new Promise(resolve=>{requests.push(resolve)})}},
    '../hooks/useCurrentEvent':{useCurrentEvent:()=>[selected,setCurrent]},
    '../pages/organizerGuidance.mjs':{eventIdentityFromQuery,authenticatedOrganizerReturn}}
  const source=readFileSync(new URL('../src/components/ProtectedRoute.jsx',import.meta.url),'utf8')
  const code=transformSync(source,{loader:'jsx',format:'cjs',jsx:'automatic'}).code
  const module={exports:{}}
  runInNewContext(code,{module,exports:module.exports,require:name=>{assert.ok(name in modules,name);return modules[name]},URLSearchParams})
  const render=()=>{cursor=0;const result=module.exports.default({children:'event-tasks',paidOnly});for(const fn of pending.splice(0))fn();return result}
  return {user,render,resolve:(events,index=0)=>requests[index](events),selections,switchEvent:setCurrent,
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

test('returning to a previous deep link performs a fresh selection instead of reusing an applied marker',async()=>{
  let allowB=true
  const h=harness({guard:id=>id!=='B'||allowB})
  h.render();h.resolve([{id:'B'},{id:'C'}]);await Promise.resolve();await Promise.resolve();h.render()
  h.navigate('/admin');h.render();h.switchEvent('C');allowB=false
  h.navigate('/setup-redesign?event=B&view=audience&task=rsvp')
  const checking=h.render();assert.notEqual(checking,'event-tasks');assert.notEqual(checking.type,'Navigate')
  h.resolve([{id:'B'},{id:'C'}],1);await Promise.resolve();await Promise.resolve()
  const blocked=h.render();assert.equal(blocked.props.role,'alert');assert.equal(h.selected,'C')
})

test('same-event view/task changes keep the verified workspace mounted without another authorization read',async()=>{
  const h=harness({path:'/event-results-redesign',search:'?event=B&view=summary'})
  h.render();h.resolve([{id:'B'}]);await Promise.resolve();await Promise.resolve();assert.equal(h.render(),'event-tasks')
  for(const search of ['?event=B&view=details','?event=B&view=details&task=closeout','?view=summary&event_id=B']){
    h.navigate('/event-results-redesign'+search)
    assert.equal(h.render(),'event-tasks');assert.equal(h.requestCount,1)
  }
})

// Real React lifecycles + MemoryRouter history, with only network/auth mocked.
// An editor cleanup actually unregisters the shared change guard here.
for(const direction of ['back','forward','replace'])for(const outcome of ['cancelled','denied','lookup-error','conflict'])test(`mounted dirty editor survives ${outcome} ${direction} and preserves history`,async()=>{
  const React=await import('react'),Router=await import('react-router-dom')
  const {create,act}=await import('react-test-renderer')
  const {createRequire}=await import('node:module'),require=createRequire(import.meta.url)
  const evaluate=(path,modules)=>{
    const module={exports:{}}
    const code=transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code
    runInNewContext(code,{module,exports:module.exports,require:name=>modules[name]??require(name),URLSearchParams,
      localStorage:{getItem:()=> 'A',setItem(){},removeItem(){}}})
    return module.exports
  }
  const current=evaluate('../src/hooks/useCurrentEvent.js',{})
  const user={id:'owner',role:'admin'},requests=[]
  const Protected=evaluate('../src/components/ProtectedRoute.jsx',{
    '../context/AuthContext':{useAuth:()=>({user,loading:false})},'../api':{api:{listEvents:()=>new Promise((resolve,reject)=>requests.push(Object.assign(resolve,{reject})))}},
    '../hooks/useCurrentEvent':current,'../pages/organizerGuidance.mjs':{eventIdentityFromQuery}}).default
  let navigation,routerLocation,index,selected,edit,allow=false,mounts=0,unmounts=0,guardCalls=0
  function Probe(){navigation=Router.useNavigate();routerLocation=Router.useLocation();index=React.useContext(Router.UNSAFE_NavigationContext).navigator.index;[selected]=current.useCurrentEvent();return null}
  function Editor(){
    const [draft,setDraft]=React.useState('');edit=setDraft
    const loc=Router.useLocation()
    React.useEffect(()=>{mounts++;const unregister=current.registerEventChangeGuard(()=>{guardCalls++;return allow});return()=>{unmounts++;unregister()}},[])
    return React.createElement('input',{value:draft,'data-location':loc.search})
  }
  const a='/design-studio-redesign/website?event=A&view=edit#draft-a',b='/design-studio-redesign/website?event=B&view=edit'+(outcome==='conflict'?'&event_id=C':'')+'#target-b'
  let root
  await act(async()=>{root=create(React.createElement(Router.MemoryRouter,{initialEntries:direction==='replace'?[a]:direction==='back'?[b,a]:[a,b],initialIndex:direction==='back'?1:0},
    React.createElement(Probe),React.createElement(Protected,null,React.createElement(Editor))))})
  await act(async()=>requests.shift()([{id:'A'},{id:'B'}]))
  await act(async()=>edit('unsaved synthetic draft'))
  const originalIndex=index
  await act(async()=>direction==='replace'?navigation(b,{replace:true}):navigation(direction==='back'?-1:1))
  assert.equal(selected,'A');assert.equal(unmounts,0);assert.equal(mounts,1)
  assert.equal(root.root.findByType('input').props.value,'unsaved synthetic draft')
  assert.match(root.root.findByType('input').props['data-location'],/event=A/)
  if(outcome!=='conflict')await act(async()=>{const request=requests.shift();if(outcome==='lookup-error')request.reject(new Error('synthetic unavailable'));else request(outcome==='denied'?[{id:'A'}]:[{id:'A'},{id:'B'}])})
  assert.equal(guardCalls,outcome==='cancelled'?1:0);assert.equal(selected,'A');assert.equal(index,originalIndex)
  assert.equal(routerLocation.search,'?event=A&view=edit');assert.equal(routerLocation.hash,'#draft-a');assert.equal(unmounts,0)
  if(direction==='replace'){
    // Persistently failing lookup must not leave the restored editor inert.
    const unexpected=requests.splice(0)
    await act(async()=>unexpected.forEach(request=>request.reject(new Error('synthetic persistent outage'))))
    assert.equal(unexpected.length,0,'restoring verified A must not look up A again')
    assert.equal(requests.length,0)
    assert.equal(root.root.findByProps({'aria-busy':false}).props.inert,undefined)
  }
  assert.equal(root.root.findByType('input').props.value,'unsaved synthetic draft')
  await act(async()=>navigation('?event=A&view=details&task=closeout',{replace:true}))
  assert.equal(unmounts,0);assert.equal(requests.length,0)
  assert.equal(root.root.findByType('input').props.value,'unsaved synthetic draft')
  // The existing opposite entry is still available after the cancellation.
  allow=true
  await act(async()=>outcome==='conflict'?navigation(b.replace('&event_id=C',''),{replace:true}):direction==='replace'?navigation(b,{replace:true}):navigation(direction==='back'?-1:1))
  await act(async()=>requests.shift()([{id:'A'},{id:'B'}]))
  assert.equal(selected,'B');assert.equal(guardCalls,outcome==='cancelled'?2:1);assert.match(routerLocation.search,/event=B/)
  await act(async()=>root.unmount())
})


test('saved return authorization cannot be restored for a different authenticated user',async()=>{
  const h=harness({search:'?event=A'})
  h.render();h.resolve([{id:'A'}]);await Promise.resolve();await Promise.resolve();assert.equal(h.render(),'event-tasks')
  h.navigate('/setup-redesign?event=B');h.render()
  h.user.id='different-owner';assert.notEqual(h.render(),'event-tasks')
  // Neither the new user's denied lookup nor the old pending callback can
  // reuse the saved authorization/selection to mount the previous tasks.
  h.resolve([],2);await Promise.resolve();await Promise.resolve();assert.equal(h.render().props.role,'alert')
  h.resolve([{id:'B'}],1);await Promise.resolve();await Promise.resolve();assert.equal(h.render().props.role,'alert')
  assert.equal(h.selected,'A')
})
