export function consoleData() {
  return {
    overview: [{id:'org-one',name:'Academy',region:'US',currency:'USD',events:[{id:'event-one',name:'Annual gathering',is_paid:true,plan_tier:'tier300',message_credits:250,status:'upcoming'}]}],
    accounts: [{id:'org-one',name:'Academy',is_active:true,event_count:3,redesign_cohort:'redesign_default',members:[{user_id:'owner-one',name:'Ada Organizer',email:'ada@example.test',role:'owner',is_active:true,is_platform_superadmin:false},{user_id:'staff-one',name:'Sam Guest Services',email:'sam@example.test',role:'staff',is_active:true,is_platform_superadmin:false}]}],
    plans: [{key:'tier300',kind:'tier',label:'Gathering',guest_cap:300,credits:500,usd:4900,ngn:7500000,active:true,sort_order:1},{key:'addon_seating',kind:'addon',label:'Seating & floor plans',guest_cap:null,credits:0,usd:2000,ngn:3000000,active:true,sort_order:2}],
    orgPlans: [{key:'api_access',label:'Connected organization',usd_monthly:1900,ngn_monthly:2800000,features:['api_write'],active:true,sort_order:1}],
    stores: [{id:'store-one',domain:'amazon.com',label:'Amazon US',param_key:'tag',param_value:'festio-20',active:true,sort_order:1}],
    operators: [{id:'operator',name:'Current Operator',email:'operator@example.test'},{id:'operator-two',name:'Alex Platform',email:'alex@example.test'}],
    trials: [{id:'trial-one',org_id:'org-one',org_name:'Academy',requester_email:'ada@example.test',contact_name:'Ada Organizer',phone:'+15550102000',event_name:'Annual gathering',guest_count:200,use_case:'Welcome guests and manage seating.',status:'pending'},{id:'trial-two',org_id:'org-one',org_name:'Academy',contact_name:'Sam Guest Services',event_name:'Community dinner',status:'approved',resolution_note:'Initial setup reviewed.'}],
    usage: {orgs:[{org_id:'org-one',org_name:'Academy',channels:{email:{sends:120},sms:{sends:35},whatsapp:{sends:25},mms:{sends:0}},total_sends:180,total_credits:200,total_cost_cents:890}]},
    referrals: [{org_name:'Community',org_created_at:'2026-10-02',referrer_name:'Academy',referrer_code:'academy',converted:true},{org_name:'Arts Society',org_created_at:'2026-10-03',referrer_name:'Academy',referrer_code:'academy',converted:false}],
    qa: [{id:'qa-one',tester_name:'Sam QA',created_at:'2026-10-29T12:00:00Z',tested_count:14,pass_count:12,issue_count:1,blocked_count:1,na_count:0}],
    qaDetail: {tester_name:'Sam QA',created_at:'2026-10-29T12:00:00Z',summary:'Registration and event access',results:[{section_id:'registration',section_title:'Registration',case_id:'invite',case_title:'Invitation opens',status:'pass',note:'Email template matches the invitation.',evidence:'390px mobile'},{section_id:'registration',section_title:'Registration',case_id:'access',case_title:'Guest access',status:'issue',note:'Follow-up review needed.',evidence:'Test observation'}]},
    rates: [{channel:'email',credits_per_unit:0.1},{channel:'sms',credits_per_unit:1},{channel:'whatsapp',credits_per_unit:2},{channel:'mms',credits_per_unit:3}],
    orgRates: [{channel:'email',credits_per_unit:0.2,is_override:true,effective_rate:0.2},{channel:'sms',credits_per_unit:null,is_override:false,effective_rate:1}],
  }
}
