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
const client = {
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
  previewMeeting: async () => {
    window.meetingCalls.push('preview');
    return {
      revision: meeting.revision,
      subject: `You're invited: ${meeting.draft.title}`,
      recipients: meeting.draft.attendees,
      cancellations: [],
      sending_enabled: true
    };
  },
  sendMeeting: async () => {
    window.meetingCalls.push('send');
    return meeting = {
      ...meeting,
      status: 'scheduled',
      published_revision: meeting.revision,
      sequence: 0,
      attendees: draft.attendees.map((a, i) => ({
        ...a,
        id: String(i),
        active: true,
        response: i ? 'pending' : 'accepted'
      })),
      deliveries: draft.attendees.map((a, i) => ({
        id: String(i),
        attendee_id: String(i),
        sequence: 0,
        method: 'REQUEST',
        status: i ? 'failed' : 'accepted',
        error: i ? 'Mock provider rejection' : null
      }))
    };
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
  }
};
createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path="/meeting-response/:token" element={<MeetingResponsePage client={client} />} /><Route path="*" element={<MeetingsWorkspace client={client} />} /></Routes></BrowserRouter>);
