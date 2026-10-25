export function meetingStatus(meeting) {
  if (meeting.archived) return 'Archived';
  if (meeting.status === 'cancelled') return 'Cancelled';
  if (meeting.send_schedule?.status === 'pending') return 'Send scheduled';
  if (meeting.send_schedule?.status === 'blocked') return 'Send needs attention';
  if (meeting.status === 'scheduled') {
    const counts=meeting.delivery_counts || (meeting.deliveries || []).filter(d=>d.purpose==='invitation'&&d.sequence===meeting.sequence).reduce((all,d)=>{const key=d.delivery_status||d.status;return {...all,[key]:(all[key]||0)+1}},{});
    if(counts && (counts.failed||counts.uncertain||counts.setup_required||counts.blocked||counts.bounced||counts.complained||counts.suppressed))return 'Delivery needs attention';
    if(counts && (counts.queued||counts.sending))return 'Sending invitations';
    return 'Invitations sent';
  }
  return 'Draft';
}

function csvRows(text) {
  const first = text.split(/\r?\n/,1)[0];
  const delimiter = first.includes('\t') ? '\t' : first.includes(',') ? ',' : ';';
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }
    else if(c===delimiter && !quoted){row.push(cell.trim());cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted) throw new Error('Close the quoted field in your attendee list.');
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  return rows;
}

export function parseMeetingAttendees(text) {
  if(text.length>100000) throw new Error('Use an attendee list smaller than 100 KB.');
  const rows=csvRows(text.replace(/^\uFEFF/,''));if(!rows.length)throw new Error('Paste at least one attendee.');
  const headers=rows[0].map(s=>s.toLowerCase().replaceAll('_',' '));
  const emailIndex=headers.findIndex(s=>['email','email address'].includes(s));
  const named=emailIndex>=0;
  const nameIndex=headers.findIndex(s=>['name','full name'].includes(s));
  const firstIndex=headers.indexOf('first name'),lastIndex=headers.indexOf('last name');
  const people=[];
  for(const [index,row] of rows.entries()) {
    if(named && index===0)continue;
    let email='',name='';
    if(named){email=row[emailIndex]||'';name=nameIndex>=0?row[nameIndex]:[row[firstIndex],row[lastIndex]].filter(Boolean).join(' ');}
    else {
      const emails=row.filter(s=>/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(s));
      if(emails.length===row.length){people.push(...emails.map(email=>({email:email.toLowerCase(),name:email.split('@')[0],channels:['email']})));continue;}
      const raw=row.join(' ');const match=raw.match(/([^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+)/);
      if(match){email=match[1];name=raw.replace(email,'').replace(/[<>]/g,'').trim();}
    }
    email=email.trim().toLowerCase();name=(name||email.split('@')[0]).trim();
    if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)||!name||name.length>200||/[\x00-\x1f]/.test(name))throw new Error(`Check the name and email on row ${index+1}.`);
    people.push({name,email,channels:['email']});
  }
  if(!people.length)throw new Error('Add attendee rows below the header.');
  return people;
}

export function mergeMeetingAttendees(existing, incoming) {
  const people=existing.filter(a=>a.name?.trim()||a.email?.trim()||a.phone?.trim());
  const emails=new Set(people.map(a=>a.email?.toLowerCase()).filter(Boolean));
  let added=0;
  for(const a of incoming)if(!emails.has(a.email.toLowerCase())){emails.add(a.email.toLowerCase());people.push(a);added++;}
  if(people.length>50)throw new Error('A meeting supports up to 50 attendees. No rows were added.');
  return {people,added};
}
