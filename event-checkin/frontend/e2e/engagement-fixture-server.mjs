// Fully local fixture server. Never loads .env or real Firebase/Chatwoot services.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { consoleData } from './fixtures/console-data.mjs'

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
  api: `const consoleSeed = ${JSON.stringify(consoleData())};
    const consoleRead = (key, fallback) => window.fixtureConsolePopulated ? structuredClone((window.fixtureConsoleSeed ||= consoleSeed)[key]) : fallback;
    const consoleWrite = (name, args, result = {ok:true}) => { (window.fixtureConsoleWrites ||= []).push({name,args}); return result; };
    const operation = (name, value) => { (window.fixtureOperationCalls ||= []).push(name); return value; };
    export const api = {
    quickInvites: async () => [],
    createQuickInvite: async body => { (window.fixtureQuickWrites ||= []).push({action:'create',body});return window.fixtureQuickWorkspace={id:'quick-one',invitation:body,url:location.origin+'/i/fixture',status:'active',email_limit:75,email_attempts:0,recipients:[]}; },
    quickInviteWorkspace: async () => window.fixtureQuickWorkspace,
    updateQuickInvite: async (id,body) => { (window.fixtureQuickWrites ||= []).push({action:'edit',body});window.fixtureQuickWorkspace.invitation=body;return window.fixtureQuickWorkspace; },
    sendQuickInvite: async (id,body) => { if(window.fixtureQuickSendError)throw new Error('Verify your email before sending');(window.fixtureQuickWrites ||= []).push({action:'send',body});window.fixtureQuickWorkspace.recipients=body.recipients.map((p,i)=>({...p,id:String(i),send_status:'sent'}));window.fixtureQuickWorkspace.email_attempts+=body.recipients.length;return {queued:body.recipients.length,skipped:0}; },
    publicQuickInvite: async (token,reply) => { if(window.fixtureQuickPublicError)throw new Error('This invitation is closed');return {invitation:window.fixtureQuickWorkspace?.invitation||{name:'Dinner under the stars',event_date:'2027-06-20T23:00:00Z',timezone:'America/Chicago',message:'An evening together',style:'arch',colour:'lavender',venue_name:'The garden'},recipient:reply?{name:window.fixtureQuickReply?.name||'Ada',response:window.fixtureQuickReply?.response}:null}; },
    replyQuickInvite: async (token,body) => { (window.fixtureQuickWrites ||= []).push({action:'reply',body});window.fixtureQuickReply=body;return {response:body.response,reply_token:'private-reply-fixture'}; },
    listEvents: async () => [{id:'event-one',name:'Academy fundraiser'},{id:'event-two',name:'Academy next occasion'}],
    listSharedMedia: async eventId => { if(window.fixtureMediaError)throw new Error('Shared files unavailable');return {organization:{id:'org-one',name:'Academy'},assets:window.fixtureMediaAssets ||= [{id:'media-one',title:'Academy logo',filename:'logo.png',url:'/media/help2-event-setup.png',content_type:'image/png',byte_size:1200,width:80,height:40},{id:'media-pdf',title:'Programme',filename:'programme.pdf',url:'/media/festio-onepager.pdf',content_type:'application/pdf',byte_size:2500}]}; },
    uploadSharedMedia: async (eventId,file) => { (window.fixtureMediaWrites ||= []).push({action:'upload',eventId,name:file.name});const asset={id:'media-uploaded',title:file.name,filename:file.name,url:'/media/help2-org-start.png',content_type:file.type,byte_size:file.size};(window.fixtureMediaAssets ||= []).push(asset);return asset; },
    renameSharedMedia: async (eventId,id,title) => { (window.fixtureMediaWrites ||= []).push({action:'rename',eventId,id,title});const row=window.fixtureMediaAssets.find(a=>a.id===id);row.title=title;return row; },
    removeSharedMedia: async (eventId,id) => { (window.fixtureMediaWrites ||= []).push({action:'remove',eventId,id});window.fixtureMediaAssets=window.fixtureMediaAssets.filter(a=>a.id!==id);return {ok:true}; },
    adminAccountsSummary: async () => { if (window.fixtureOperationError) throw new Error('Account snapshot unavailable'); return operation('adminAccountsSummary', [{id:'org-one',name:'Academy',owner_email:'owner@example.test',is_active:true,event_types:[],member_count:1,event_count:3,message_credits_spent:7,created_at:'2026-10-01'}, {id:'org-two',name:'Community',owner_email:'team@example.test',is_active:false,event_types:[],member_count:1,event_count:2,message_credits_spent:1,created_at:'2026-10-02'}]); },
    adminOverview: async () => operation('adminOverview', consoleRead('overview', [])),
    adminListAccounts: async () => operation('adminListAccounts', consoleRead('accounts', [])),
    adminUsageReport: async () => operation('adminUsageReport', consoleRead('usage', {orgs: []})),
    adminListTrials: async () => operation('adminListTrials', consoleRead('trials', [])),
    qaChecklistSubmissions: async () => operation('qaChecklistSubmissions', consoleRead('qa', [])),
    adminAllReferrals: async () => operation('adminAllReferrals', consoleRead('referrals', [])),
    adminListPlans: async () => operation('adminListPlans', consoleRead('plans', [])),
    adminListOrgPlans: async () => operation('adminListOrgPlans', consoleRead('orgPlans', [])),
    adminListAffiliateStores: async () => operation('adminListAffiliateStores', consoleRead('stores', [])),
    adminListOperators: async () => operation('adminListOperators', consoleRead('operators', [])),
    adminListGlobalCreditRates: async () => operation('adminListGlobalCreditRates', consoleRead('rates', [])),
    qaChecklistSubmission: async () => consoleRead('qaDetail', {}),
    adminSavePlan: async (...args) => consoleWrite('adminSavePlan', args),
    adminSaveOrgPlan: async (...args) => consoleWrite('adminSaveOrgPlan', args),
    adminDeleteOrgPlan: async (...args) => consoleWrite('adminDeleteOrgPlan', args),
    adminUpdateAffiliateStore: async (...args) => consoleWrite('adminUpdateAffiliateStore', args),
    adminCreateAffiliateStore: async (...args) => consoleWrite('adminCreateAffiliateStore', args),
    adminDeleteAffiliateStore: async (...args) => consoleWrite('adminDeleteAffiliateStore', args),
    adminOrgAddonOverrides: async () => ({addons:['addon_seating','addon_engagement'],overrides:{addon_seating:true}}),
    adminEventAddonOverrides: async () => ({addons:['addon_seating','addon_engagement'],overrides:{}}),
    adminSetOrgAddonOverrides: async (id, overrides) => consoleWrite('adminSetOrgAddonOverrides',[id,overrides],{addons:['addon_seating','addon_engagement'],overrides}),
    adminSetEventAddonOverrides: async (id, overrides) => consoleWrite('adminSetEventAddonOverrides',[id,overrides],{addons:['addon_seating','addon_engagement'],overrides}),
    adminEventControls: async () => ({blocked_messaging_channels:[],blocked_comm_features:[]}),
    adminSetEventControls: async (id, data) => consoleWrite('adminSetEventControls',[id,data],data),
    adminGrant: async (...args) => consoleWrite('adminGrant',args),
    adminPreviewReadinessReport: async (...args) => consoleWrite('adminPreviewReadinessReport',args),
    adminSendReadinessReport: async (...args) => consoleWrite('adminSendReadinessReport',args,{email:'owner@example.test'}),
    adminSetOrgRedesignCohort: async (...args) => consoleWrite('adminSetOrgRedesignCohort',args),
    adminSetOrgActive: async (...args) => consoleWrite('adminSetOrgActive',args),
    adminDeleteOrg: async (...args) => consoleWrite('adminDeleteOrg',args),
    adminSetMemberRole: async (...args) => consoleWrite('adminSetMemberRole',args),
    adminRemoveMember: async (...args) => consoleWrite('adminRemoveMember',args),
    adminSetUserActive: async (...args) => consoleWrite('adminSetUserActive',args),
    adminDeleteUser: async (...args) => consoleWrite('adminDeleteUser',args),
    adminGetOrgEventPass: async () => ({tier:'tier300'}),
    adminUpdateOrgEventPass: async (...args) => consoleWrite('adminUpdateOrgEventPass',args),
    adminResolveTrial: async (...args) => consoleWrite('adminResolveTrial',args),
    adminAddOperator: async (...args) => consoleWrite('adminAddOperator',args),
    adminRemoveOperator: async (...args) => consoleWrite('adminRemoveOperator',args),
    adminSaveGlobalCreditRate: async (...args) => consoleWrite('adminSaveGlobalCreditRate',args),
    adminListOrgCreditRates: async () => consoleRead('orgRates',[]),
    adminSaveOrgCreditRate: async (...args) => consoleWrite('adminSaveOrgCreditRate',args),
    adminDeleteOrgCreditRate: async (...args) => consoleWrite('adminDeleteOrgCreditRate',args),
    adminSetAddonPolicy: async (...args) => consoleWrite('adminSetAddonPolicy',args),
    updatePlatformSettings: async data => consoleWrite('updatePlatformSettings',[data],{support_chat_enabled:data.support_chat_enabled ?? false, addon_promo_until:data.addon_promo_until || null}),
    marketingModule: async module => module === 'campaigns' ? (window.fixtureCampaigns ||= [{id:'campaign-one',name:'First event invitation',status:'draft',owner_email:'operator@example.test',payload:{audience:'segment-one',subject:'Create your first event',body:'Let us help you get started.',custom_tracking:'preserve-me',steps:[{subject:'Create your first event',body:'Let us help you get started.',cta:'Create event',cta_url:'https://festio.events/setup-redesign',delay_hours:0},{subject:'Future reference',body:'Retain this saved step.'}]}}]) : module === 'segments' ? [{id:'segment-one',name:'Organizers ready to start',status:'active',payload:{field:'stage',operator:'eq',value:'registered'}}] : [{ id: 'sequence-one', name: 'Sample welcome sequence', status: 'draft', payload: { stage: 'registered', steps: [{ subject: 'Welcome to Festio', body: 'Create your first event.', cta: 'Create event', cta_url: 'https://festio.events/setup-redesign' }] } }],
    marketingDeleteRecord: async (module,id) => {(window.fixtureMarketingWrites ||= []).push({action:'delete',module,id});window.fixtureCampaigns=(window.fixtureCampaigns||[]).filter(row=>row.id!==id);return {ok:true};},
    marketingCreateRecord: async (module,body) => { (window.fixtureMarketingWrites ||= []).push({action:'create',module,body});const row={...structuredClone(body),id:'campaign-new'};(window.fixtureCampaigns ||= []).push(row);return row; },
    marketingUpdateRecord: async (module,id,body) => { (window.fixtureMarketingWrites ||= []).push({action:'update',module,id,body});const row={...structuredClone(body),id};window.fixtureCampaigns=(window.fixtureCampaigns||[]).map(old=>old.id===id?row:old);return row; },
    marketingExecuteCampaign: async (id,dryRun=false) => { (window.fixtureMarketingWrites ||= []).push({action:dryRun?'audience':'send',id});return dryRun?{eligible:2,recipients:[{id:'client-one',name:'Ada Organizer',email:'ada@example.test'},{id:'client-two',name:'Sam Organizer',email:'sam@example.test'}]}:{eligible:2,sent:1,failed:1}; },
    marketingPreviewCampaign: async id => { (window.fixtureMarketingWrites ||= []).push({action:'test',id});return window.fixtureMarketingTestFails?{status:'failed',error:'Provider unavailable'}:{status:'sent'}; },
    marketingAnalytics: async () => ({daily:{'2026-10-28':4,'2026-10-29':8,'2026-10-30':5},sources:{website:12,referral:5},campaigns:{'Welcome campaign':3}}),
    marketingProviders: async () => ({email:{configured:true},sms:{configured:false},whatsapp:{configured:false},social:{}}),
    marketingPreferences: async () => ({consent_email:false,consent_sms:false,consent_whatsapp:false}),
    marketingTags: async () => [],
    marketingAudit: async () => [],
    marketingJourneySafety: async () => ({status:'local fixture'}),
    marketingLeads: async () => {if(window.fixtureMarketingPeopleError)throw new Error('People temporarily unavailable');return [{ id:'client-one',name:'Sample organiser',email:'organiser@example.test',stage:'registered',consent_email:true,automation:{automatic_eligible:false} }];},
    marketingSavedViews: async () => [],
    marketingHandoffs: async () => [{id:'case-one',status:'open',owner:'operator@example.test',notification:'delivered',attempts:1,history:[]},{id:'case-two',status:'open',owner:null,notification:'pending',attempts:0,history:[]}],
    marketingCommerceMetrics: async () => ({organizer_acquired:window.fixturePayingOrganizers ?? 0,free_orders:0}),
    marketingHandoffContext: async id => ({name:id==='case-one'?'Sample organiser':'Another organiser',note:'Open the original conversation to review and reply.',source_url:'https://example.test/conversation'}),
    marketingHandoffAction: async (id,action) => { (window.fixtureHandoffActions ||= []).push({id,action});return {ok:true}; },
    marketingMe: async () => ({ name: 'Sample marketing operator', email: 'example@example.test', role: window.fixtureMarketingRole || 'manager' }),
    marketingDashboard: async () => ({ total_leads: 24, conversion: { registered: 24, event_created: 8, paid: 0 }, automation: { runtime: { state: 'running', scheduler_running: true, blockers: [], conversion: { enrolled: 24, first_event_created: window.fixtureVerifiedFirstEvents ?? 8, rate: 33 }, last_run: { checked_at: '2026-10-21T14:00:00Z' } }, sequences: [] }, stages: {} }),

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
  '../context/AuthContext': 'auth', '../../context/AuthContext': 'auth', '../api': 'api', '../../api': 'api', '../firebase': 'firebase',
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
