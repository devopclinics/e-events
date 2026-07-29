import { signInWithPopup } from 'firebase/auth'
import { auth, oidcProvider } from '../firebase'

// Generic OIDC staff SSO (web only — native app users use Google sign-in).
// Requires an OIDC provider configured in the Firebase console and
// VITE_OIDC_PROVIDER_ID set; the login button that calls this is hidden
// entirely when oidcProvider is null (see firebase.js).
export async function oidcSignIn() {
  if (!oidcProvider) {
    throw new Error('SSO is not configured for this environment.')
  }
  return signInWithPopup(auth, oidcProvider)
}
