// Fully local fixture server. Never loads .env or real Firebase/Chatwoot services.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const modules = {
  auth: `import React, { createContext, useContext, useState } from 'react';
    const Auth = createContext(null);
    export function AuthProvider({ children }) {
      const [user, setUser] = useState(null);
      const [loading, setLoading] = useState(false);
      window.fixtureSetUser = setUser; window.fixtureSetLoading = setLoading;
      return React.createElement(Auth.Provider, { value: { user, loading } }, children);
    }
    export const useAuth = () => useContext(Auth);`,
  api: `const operation = (name, value) => { (window.fixtureOperationCalls ||= []).push(name); return value; };
    export const api = {
    adminAccountsSummary: async () => { if (window.fixtureOperationError) throw new Error('Account snapshot unavailable'); return operation('adminAccountsSummary', [{id:'org-one',name:'Academy',owner_email:'owner@example.test',is_active:true,event_types:[],member_count:1,event_count:3,message_credits_spent:7,created_at:'2026-10-01'}, {id:'org-two',name:'Community',owner_email:'team@example.test',is_active:false,event_types:[],member_count:1,event_count:2,message_credits_spent:1,created_at:'2026-10-02'}]); },
    adminOverview: async () => operation('adminOverview', []),
    adminListAccounts: async () => operation('adminListAccounts', []),
    adminUsageReport: async () => operation('adminUsageReport', {orgs: []}),
    adminListTrials: async () => operation('adminListTrials', []),
    qaChecklistSubmissions: async () => operation('qaChecklistSubmissions', []),
    adminAllReferrals: async () => operation('adminAllReferrals', []),
    adminListPlans: async () => operation('adminListPlans', []),
    adminListOrgPlans: async () => operation('adminListOrgPlans', []),
    adminListAffiliateStores: async () => operation('adminListAffiliateStores', []),
    adminListOperators: async () => operation('adminListOperators', []),
    adminListGlobalCreditRates: async () => operation('adminListGlobalCreditRates', []),
    marketingModule: async () => [{ id: 'sequence-one', name: 'Sample welcome sequence', status: 'draft', payload: { stage: 'registered', steps: [{ subject: 'Welcome to Festio', body: 'Create your first event.', cta: 'Create event', cta_url: 'https://festio.events/setup-redesign' }] } }],
    marketingLeads: async () => [{ id:'client-one',name:'Sample organiser',email:'organiser@example.test',stage:'registered',consent_email:true,automation:{automatic_eligible:false} }],
    marketingSavedViews: async () => [],
    marketingHandoffs: async () => [{id:'case-one',status:'open',owner:'operator@example.test',notification:'delivered',attempts:1,history:[]},{id:'case-two',status:'open',owner:null,notification:'pending',attempts:0,history:[]}],
    marketingCommerceMetrics: async () => ({organizer_acquired:0,free_orders:0}),
    marketingHandoffContext: async id => ({name:id==='case-one'?'Sample organiser':'Another organiser',note:'Open the original conversation to review and reply.',source_url:'https://example.test/conversation'}),
    marketingHandoffAction: async (id,action) => { (window.fixtureHandoffActions ||= []).push({id,action});return {ok:true}; },
    marketingMe: async () => ({ name: 'Sample marketing operator', email: 'example@example.test', role: 'manager' }),
    marketingDashboard: async () => ({ total_leads: 24, conversion: { registered: 24, event_created: 8, paid: 0 }, automation: { runtime: { state: 'running', scheduler_running: true, blockers: [], conversion: { enrolled: 24, first_event_created: 8, rate: 33 }, last_run: { checked_at: '2026-10-21T14:00:00Z' } }, sequences: [] }, stages: {} }),

    platformSettings: async () => { operation('platformSettings', null);
      window.fixtureSettingsCalls = (window.fixtureSettingsCalls || 0) + 1;
      if (window.fixtureDeferSettings) return new Promise(resolve => window.fixtureResolveSettings = resolve);
      return { support_chat_enabled: window.fixtureSupportEnabled !== false };
    },
    supportIdentify: async () => {
      window.fixtureIdentifyCalls = (window.fixtureIdentifyCalls || 0) + 1;
      const identity = { identifier: 'organizer-1', identifier_hash: 'fixture-hash', name: 'Organizer', email: 'organizer@example.test', org_name: 'Private Organization', plan: 'Private Plan' };
      if (window.fixtureDeferIdentity) return new Promise(resolve => window.fixtureResolveIdentity = () => resolve(identity));
      return identity;
    },
    submitDemoRequest: async (body, key) => {
      (window.fixtureDemoRequests ||= []).push({ body, key });
      if (window.fixtureDemoFailures > 0) { window.fixtureDemoFailures--; throw new Error('Temporary network failure'); }
      return { ok: true, status: 'requested', request_id: 'local-test-request' };
    }
  };`,
  firebase: `export const auth = {};`,
  firebaseAuth: `const credential = email => ({ user: { uid: 'fixture-password-user', email, emailVerified: false, getIdToken: async () => 'fixture-auth-token' } });
    export async function createUserWithEmailAndPassword(auth, email) { window.fixtureSignupProvider = 'password'; return credential(email); }
    export async function updateProfile() {}
    export async function sendEmailVerification(user) { (window.fixtureVerificationCalls ||= []).push(user.uid); }`,
  google: `export async function googleSignIn() { window.fixtureSignupProvider = 'google'; return { user: { uid: 'fixture-google-user', email: 'person@example.test', emailVerified: true, getIdToken: async () => 'fixture-auth-token' } }; }`,
  app: `export const setPreferredView = () => {}; export const getPreferredView = () => '/admin';`,
}
const aliases = {
  '../context/AuthContext': 'auth', '../api': 'api', '../../api': 'api', '../firebase': 'firebase',
  'firebase/auth': 'firebaseAuth', '../auth/googleSignIn': 'google', '../App': 'app',
}
const definitions = {
  VITE_CHATWOOT_BASE_URL: 'https://support.chat.test',
  VITE_CHATWOOT_WEBSITE_TOKEN: 'support-fixture-inbox',
  VITE_SALES_CHAT_BASE_URL: 'https://sales.chat.test',
  VITE_SALES_CHAT_WEBSITE_TOKEN: 'sales-fixture-inbox',
  VITE_SALES_CHAT_ENABLED: 'true', VITE_SALES_CHAT_INBOX_VALIDATED: 'true',
}
const server = await createServer({
  configFile: false, envDir: false,
  optimizeDeps: process.argv.includes('--check') ? { noDiscovery: true, include: [] } : undefined,
  plugins: [{
    name: 'engagement-fixture-only',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'fixture-auth') return '\0fixture-auth';
      if (aliases[id]) return `\0fixture-${aliases[id]}`;
    },
    load(id) { if (id.startsWith('\0fixture-')) return modules[id.slice('\0fixture-'.length)]; },
    configureServer(instance) {
      instance.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/')) {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ events: [], id: 'organizer-1', role: 'official' }));
        }
        if (!['/__engagement-test', '/', '/platform-operations'].includes(req.url?.split('?')[0])) return next();
        instance.transformIndexHtml('/__engagement-test', '<!doctype html><html><body><div id="root"></div><script type="module" src="/e2e/fixtures/engagement.jsx"></script></body></html>').then(html => {
          res.setHeader('Content-Type', 'text/html');
          // Optional manual CUA run must never contact fake Chatwoot hosts or
          // external landing-page media. The Playwright suite intercepts them.
          if (process.env.ENGAGEMENT_CUA_ONLY === 'true') res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self' ws://127.0.0.1:4178; frame-src 'none';");
          res.end(html);
        });
      });
    },
  }, react()],
  define: Object.fromEntries(Object.entries(definitions).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
})
await server.listen()

// Smoke-check the fixture's transformed module graph without a browser.
if (process.argv.includes('--check')) {
  for (const url of ['/e2e/fixtures/engagement.jsx', '/src/components/SupportWidget.jsx', '/src/pages/RegisterPage.jsx', '/src/pages/LandingPage.jsx', '/src/pages/LandingRedesignPage.jsx']) {
    const transformed = await server.transformRequest(url)
    if (!transformed?.code) throw new Error(`No transformed fixture code: ${url}`)
  }
  await server.close()
  console.log('Local engagement fixture module transforms passed')
}
