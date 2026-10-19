// Execute the real auth listener, page handlers, and API client without a
// browser or any Firebase/network calls. Only React rendering/hooks and external
// boundaries are stubbed; attribution and request construction are production.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url))
const copy = value => JSON.parse(JSON.stringify(value))

export function createAcquisitionHarness({
  href = 'https://festio.example.test/register', referrer = '', stored,
  storageUnavailable = false, order = 'listener-first', readSource = readFileSync,
} = {}) {
  const requests = []
  const values = new Map(stored === undefined ? [] : [['festioMarketingAttribution', typeof stored === 'string' ? stored : JSON.stringify(stored)]])
  const storage = {
    getItem(key) { if (storageUnavailable) throw new Error('Storage blocked'); return values.get(key) ?? null },
    setItem(key, value) { if (storageUnavailable) throw new Error('Storage blocked'); values.set(key, value) },
    removeItem(key) { if (storageUnavailable) throw new Error('Storage blocked'); values.delete(key) },
  }
  const hostWindow = { location: new URL(href), setTimeout: () => 1, clearTimeout: () => {} }
  const firebaseUser = { getIdToken: async force => force ? 'signup-token' : 'listener-token' }
  const auth = { currentUser: null }
  let listener
  let contextValue
  let activeHooks
  let hookIndex = 0
  const hookStates = new Map()
  const effects = []
  const react = {
    createContext: () => ({ Provider: 'AuthProvider' }),
    useContext: () => contextValue,
    useState(initial) {
      const index = hookIndex++
      const slots = activeHooks
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useEffect(effect) {
      const index = hookIndex++
      if (!(index in activeHooks)) { activeHooks[index] = true; effects.push(effect) }
    },
  }
  const jsx = (type, props) => ({ type, props })
  const emitUser = async () => { auth.currentUser = firebaseUser; await listener?.(firebaseUser) }
  const credential = async () => {
    auth.currentUser = firebaseUser
    if (order === 'listener-first') await emitUser()
    return { user: firebaseUser }
  }
  const firebaseAuth = {
    onAuthStateChanged(_, callback) { listener = callback; return () => { listener = undefined } },
    createUserWithEmailAndPassword: credential, signInWithEmailAndPassword: credential,
    updateProfile: async () => {}, signOut: async () => {},
  }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const source = readSource(file, 'utf8')
    const { code } = transformSync(source, {
      loader: file.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs', jsx: 'automatic',
      define: { 'import.meta.env': '{}' },
    })
    const require = id => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (id === 'react-router-dom') return {
        Link: 'a', useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams(hostWindow.location.search)],
        useLocation: () => ({pathname:hostWindow.location.pathname,search:hostWindow.location.search,state:null}),
      }
      if (id === 'firebase/auth') return firebaseAuth
      if (id === '../firebase' || id === './firebase') return { auth, oidcProvider: 'fixture', oidcProviderLabel: 'Fixture SSO' }
      if (id === '../auth/googleSignIn') return { googleSignIn: credential }
      if (id === '../auth/oidcSignIn') return { oidcSignIn: credential }
      if (id === '../App') return { setPreferredView: () => {}, getPreferredView: () => '/admin' }
      const target = resolve(dirname(file), id)
      return load([target, `${target}.jsx`, `${target}.js`].find(existsSync) || target)
    }
    runInNewContext(code, {
      module, exports: module.exports, require, window: hostWindow,
      document: { referrer }, localStorage: storage, sessionStorage: storage,
      URL, URLSearchParams, AbortSignal,
      fetch: async (url, options = {}) => {
        requests.push(copy({ url, ...options }))
        return { ok: true, status: 200, json: async () => ({ id: 'organizer-1', role: 'official' }) }
      },
    }, { filename: file })
    return module.exports
  }
  function render(component) {
    if (!hookStates.has(component)) hookStates.set(component, [])
    activeHooks = hookStates.get(component)
    hookIndex = 0
    const tree = component({ children: null })
    if (tree.type === 'AuthProvider') contextValue = tree.props.value
    while (effects.length) effects.shift()()
    return tree
  }
  function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') return undefined
    if (predicate(tree)) return tree
    for (const child of [tree.props?.children].flat(Infinity)) {
      const found = find(child, predicate)
      if (found) return found
    }
  }
  render(load(resolve(sourceRoot, 'context/AuthContext.jsx')).AuthProvider)

  return {
    requests, storage, hostWindow, emitUser,
    load: relative => load(resolve(sourceRoot, relative)),
    async signup(provider = 'password', optIn = false) {
      const Page = load(resolve(sourceRoot, 'pages/RegisterPage.jsx')).default
      let tree = render(Page)
      for (const [field, value] of [['name', 'Test Person'], ['email', 'person@example.test'], ['password', 'local-test-only']]) {
        find(tree, node => node.props?.id === `register-${field}`).props.onChange({ target: { value } })
      }
      find(tree, node => node.type?.name === 'MarketingEmailConsent').props.onChange(optIn)
      tree = render(Page)
      if (provider === 'password') await find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} })
      else await find(tree, node => node.props?.onClick?.name === 'signUpWithGoogle').props.onClick()
      if (order === 'signup-first') await emitUser()
    },
    async login(provider = 'password') {
      const Page = load(resolve(sourceRoot, 'pages/LoginPage.jsx')).default
      const tree = render(Page)
      if (provider === 'password') await find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} })
      else await find(tree, node => node.props?.onClick?.name === (provider === 'google' ? 'signInWithGoogle' : 'signInWithSso')).props.onClick()
      if (order === 'signup-first') await emitUser()
    },
    async apiRequest() { await load(resolve(sourceRoot, 'api.js')).api.platformSettings() },
  }
}

export function requestAttribution(request) {
  return JSON.parse(decodeURIComponent(request.headers?.['X-Festio-Attribution'] || '%7B%7D'))
}
