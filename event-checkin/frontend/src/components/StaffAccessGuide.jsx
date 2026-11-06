import './StaffAccessGuide.css'
export default function StaffAccessGuide({canManageAccess,onOpenDirectory,onAddTeammate}) {
 return <details id="staff-access-guide" className="staff-access-guide">
  <summary><span><strong>Set up staff access</strong><small>Choose what each teammate can see and do.</small></span><span className="staff-access-guide-toggle">View guide</span></summary>
  <div className="staff-access-guide-body">
   {!canManageAccess && <p className="staff-access-guide-note">An organization owner or administrator must configure staff permissions. Ask them to follow these steps.</p>}
   <ol>
    <li><strong>Choose the correct organization role.</strong> Open Organization directory below and set the person’s role to <b>Staff</b>. Organization owners and admins retain full access; event feature restrictions do not limit them.</li>
    <li><strong>Add the person to this event.</strong> Use Add teammate to invite them by email, or assign someone who already belongs to your organization. New event assignments start with no features enabled.</li>
    <li><strong>Open Edit access on their card.</strong> Under Feature access, choose a preset or select each tool individually. For an existing teammate, Start with no features replaces their previous role-based access with a restricted policy.</li>
    <li><strong>Grant only the access they need.</strong> No access hides and blocks a feature. View allows reading; Manage permits changes. Festio Live and ticketing offer management access only. Team and event settings also require the Event manager role.</li>
    <li><strong>Check the saved result.</strong> Each selection saves immediately after the server confirms it. A preset replaces the selected features. If a save fails, follow the error and try again; ask the teammate to refresh after changes.</li>
   </ol>
   {canManageAccess && <div className="staff-access-guide-actions"><button type="button" className="rr-btn secondary" onClick={onOpenDirectory}>Open organization directory</button><button type="button" className="rr-btn secondary" onClick={onAddTeammate}>Add teammate</button></div>}
   <h3>Start with their responsibility</h3>
   <div className="staff-access-guide-table"><table><thead><tr><th>Responsibility</th><th>Suggested access</th></tr></thead><tbody>
    <tr><td>Entrance staff</td><td>Check-in only preset. Choose scanner sections separately if needed.</td></tr>
    <tr><td>Guest desk</td><td>Guest desk preset: manage guests and check-in. Export and messaging are separate permissions.</td></tr>
    <tr><td>Seating coordinator</td><td>Seating + guest view preset: arrange tables and seats, with read-only guest-list access.</td></tr>
    <tr><td>Reporting</td><td>Dashboard & results: View. Grant Export guest data separately only when downloads are needed.</td></tr>
    <tr><td>Planner assistant</td><td>Planner: View or Manage, depending on whether they should make changes.</td></tr>
   </tbody></table></div>
   <p className="staff-access-guide-note"><strong>Before you finish:</strong> existing staff keep their previous access until you restrict it. A view-only event manager cannot make changes even if a feature says Manage. Paid tools still require the relevant event access. Existing Planner, Live and ticketing sessions can take up to 15 minutes to expire; previously downloaded data cannot be withdrawn from an offline device.</p>
   <p>Festio support-inbox access is separate from event-team access. Only Festio platform management can grant it.</p>
  </div>
 </details>
}
