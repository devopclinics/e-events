import {useState} from 'react'
import {Link} from 'react-router-dom'
import {auth} from '../../firebase'
import {sendEmailVerification} from 'firebase/auth'
export default function AccessRecovery(){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 async function verify(){setBusy(true);try{if(!auth.currentUser)throw Error('Sign in to request verification.');await sendEmailVerification(auth.currentUser);setNotice('Verification email requested. Check your inbox, then refresh access.')}catch(e){setNotice(e.message)}finally{setBusy(false)}}
 async function refresh(){setBusy(true);try{await auth.currentUser?.reload();await auth.currentUser?.getIdToken(true);window.location.reload()}catch(e){setNotice(e.message);setBusy(false)}}
 return <section aria-label="Access help"><p>Marketing and Academy require separate approval. You can continue with the event setup tools while access is reviewed.</p>{auth.currentUser&&!auth.currentUser.emailVerified&&<button disabled={busy} onClick={verify}>Send verification email</button>}<button disabled={busy} onClick={refresh}>Refresh access</button>{notice&&<p role="status">{notice}</p>}<p><Link to="/setup-redesign?view=guide">Open the event Setup Guide</Link> · <a href="mailto:support@festio.events">Request access help</a></p></section>
}
