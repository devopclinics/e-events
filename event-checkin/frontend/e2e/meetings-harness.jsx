// Local-only UI fixture: no authentication, provider, or network API calls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MeetingsWorkspace, MeetingResponsePage } from '../src/pages/MeetingsPage';
const draft = {
  title: 'Project catch-up',
  agenda: 'Review progress and agree next steps.',
  start: '2026-10-28T10:00',
  end: '2026-10-28T10:30',
  timezone: 'America/Chicago',
  start_fold: null,
  end_fold: null,
  location_type: 'online',
  location: '',
  video_url: 'https://example.com/meeting',
  attendees: [{
    name: 'Alex Morgan',
    email: 'alex@example.com'
  }, {
    name: 'Jamie Lee',
    email: 'jamie@example.com'
  }]
};
let meeting = {
  id: 'local-meeting',
  draft,
  revision: 1,
  published_revision: 0,
  sequence: -1,
  status: 'draft',
  organizer_id: 'fixture-owner',
  org_id: 'fixture-org',
  sending_enabled: true,
  attendees: [],
  deliveries: []
};
window.meetingCalls = [];
window.preferenceCalls = [];
window.updateMeetingFixture = patch => { meeting = { ...meeting, ...patch }; };
window.meetingListRequests = 0;
const recipientRows = (cancel = false) => meeting.draft.attendees.flatMap(a => (a.channels || ['email']).map(channel => ({
  name: a.name,
  channel,
  recipient: channel === 'email' ? a.email : a.phone,
  method: cancel ? 'CANCEL' : 'REQUEST',
  credit_units: channel === 'sms' ? 20 : channel === 'whatsapp' ? 15 : 0,
  readiness: 'ready',
  message: 'Meeting invitation / update: ' + meeting.draft.title + ' · ' + meeting.draft.timezone
})));
const client = {
  meetingOptions: async () => ({
    sending_enabled: true,
    user_id:'fixture-owner', default_org_id:'fixture-org', organizations:[{id:'fixture-org',name:'Fixture organization'},{id:'other-org',name:'Other organization'}],
    whatsapp_templates: [{
      id: 'approved-meeting',
      name: 'Approved meeting notification'
    }]
  }),
  listMeetings: async () => { window.meetingListRequests++; return [structuredClone(meeting)]; },
  listMeetingSummaries: async (params={}) => {
    window.meetingListRequests++;
    let rows=[meeting,...(window.additionalMeetings||[])];
    const org=params.org_id||'fixture-org';rows=rows.filter(m=>(m.org_id||'fixture-org')===org);
    const active=rows.filter(m=>!m.archived);
    const totals={meetings:active.length,pending_sends:active.filter(m=>m.send_schedule?.status==='pending').length,accepted:active.reduce((n,m)=>n+(m.attendees||[]).filter(a=>a.active&&a.response==='accepted').length,0)};
    rows=rows.filter(m=>Boolean(m.archived)===(params.view==='archived'));
    if(params.q)rows=rows.filter(m=>m.draft.title.toLowerCase().includes(params.q.toLowerCase()));
    if(params.view==='draft'||params.view==='cancelled')rows=rows.filter(m=>m.status===params.view);
    const total=rows.length,offset=Number(params.offset||0),limit=Number(params.limit||20);
    return {items:rows.slice(offset,offset+limit).map(m=>({id:m.id,draft:{title:m.draft.title,start:m.draft.start,end:m.draft.end,timezone:m.draft.timezone},revision:m.revision,published_revision:m.published_revision,sequence:m.sequence,status:m.status,archived:!!m.archived,send_schedule:m.send_schedule,response_counts:(m.attendees||[]).filter(a=>a.active).reduce((out,a)=>({...out,[a.response]:(out[a.response]||0)+1}),{})})),total,offset,limit,org_id:org,totals};
  },
  archiveMeeting: async (id,revision,archived)=>meeting={...meeting,archived},
  deleteMeetingDraft: async ()=>{window.meetingCalls.push('delete');return {deleted:true}},
  meetingDirectory:async()=>[{name:'Casey Guest',email:'casey@example.com'}],
  meetingCalendar:async()=>({filename:'meeting.ics',content:'BEGIN:VCALENDAR\r\nEND:VCALENDAR'}),
  exportMeetingResponses:async()=>({filename:'meeting-responses.csv',content:'Name,Response\nAlex,accepted'}),
  meetingAttendeeLink:async()=>({url:'https://example.invalid/personal-fixture-link'}),
  nudgeMeetingPending:async()=>{window.meetingCalls.push('nudge');return {queued:1}},
  resendMeetingAttendee:async()=>{window.meetingCalls.push('resend');return meeting},
  getMeeting: async (id) => structuredClone([meeting,...(window.additionalMeetings||[])].find(m=>m.id===id)||meeting),
  createMeeting: async data => {
    window.meetingCalls.push('save');
    return meeting = {
      ...meeting,
      draft: data
    };
  },
  updateMeeting: async (id, data) => {
    window.meetingCalls.push('save');
    return meeting = {
      ...meeting,
      draft: data,
      revision: meeting.revision + 1
    };
  },
  previewMeeting: async (id, cancel = false) => {
    window.meetingCalls.push('preview');
    return {
      revision: meeting.revision,
      html: window.meetingEmailFixtures?.[meeting.draft.invitation_style || 'aurora'] || '<html><body><h1>Project catch-up</h1><p>Meeting invitation fixture</p></body></html>',
      subject: `You're invited: ${meeting.draft.title}`,
      recipients: meeting.draft.attendees,
      cancellations: [],
      sending_enabled: true,
      calendar_mode: 'smtp',
      channel_recipients: recipientRows(cancel),
      credit_units: recipientRows(cancel).reduce((n, r) => n + r.credit_units, 0)
    };
  },
  sendMeeting: async (id, revision, confirmed, quote, schedule = {}) => {
    if (schedule.send_at) {
      window.meetingCalls.push('schedule');
      return meeting = { ...meeting, send_schedule: { status: 'pending', local_time: schedule.send_at, timezone: meeting.draft.timezone, send_at: schedule.send_at + 'Z' } };
    }
    const total = recipientRows().reduce((n, r) => n + r.credit_units, 0);
    if (total && (!confirmed || quote !== total)) throw new Error('Paid channel confirmation required');
    window.meetingCalls.push('send');
    return meeting = {
      ...meeting,
      status: 'scheduled',
      published_revision: meeting.revision,
      sequence: 0,
      attendees: meeting.draft.attendees.map((a, i) => ({
        ...a,
        id: String(i),
        active: true,
        response: i ? 'pending' : 'accepted'
      })),
      deliveries: recipientRows().map((r, i) => ({
        ...r,
        id: String(i),
        attendee_id: String(meeting.draft.attendees.findIndex(a => a.name === r.name)),
        sequence: 0,
        method: 'REQUEST',
        status: i ? 'failed' : 'accepted',
        error: i ? 'Mock provider rejection' : null
      }))
    };
  },
  cancelMeetingSchedule: async () => {
    window.meetingCalls.push('unschedule');
    return meeting = { ...meeting, send_schedule: { ...meeting.send_schedule, status: 'cancelled' } };
  },
  retryMeetingDelivery: async () => {
    window.meetingCalls.push('retry');
    return meeting = {
      ...meeting,
      deliveries: meeting.deliveries.map(d => ({
        ...d,
        status: 'accepted',
        error: null
      }))
    };
  },
  cancelMeeting: async () => {
    window.meetingCalls.push('cancel');
    return meeting = {
      ...meeting,
      status: 'cancelled'
    };
  },
  meetingResponsePreview: async token => {
    window.meetingCalls.push('read');
    if (token === 'expired') throw new Error('This invitation link is invalid or expired');
    return {
      meeting: draft,
      name: 'Alex Morgan',
      response: 'pending'
    };
  },
  respondToMeeting: async (token, response) => {
    window.meetingCalls.push(response);
    return {
      response
    };
  },
  meetingNotificationPreferences: async token => {
    if (token === 'expired') throw new Error('Invitation expired');
    return {
      email:true,reminders_stopped:false,
      phone: '+14155550123',
      stopped: []
    };
  },
  stopMeetingNotifications: async (token, channel) => {
    window.preferenceCalls.push(channel);
    return {
      stopped: channel
    };
  }
};
createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path="/meeting-response/:token" element={<MeetingResponsePage client={client} />} /><Route path="*" element={<MeetingsWorkspace client={client} />} /></Routes></BrowserRouter>);
