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
  sending_enabled: true,
  attendees: [],
  deliveries: []
};
window.meetingCalls = [];
window.preferenceCalls = [];
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
    whatsapp_templates: [{
      id: 'approved-meeting',
      name: 'Approved meeting notification'
    }]
  }),
  listMeetings: async () => [meeting],
  getMeeting: async () => meeting,
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
