import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

// Staff SSO — Google Workspace: same Google federated sign-in, optionally
// restricted to one Workspace domain via Firebase's `hd` (hosted domain)
// login hint. Firebase still verifies the token normally; `hd` only affects
// which accounts Google's own picker offers. Backend needs no changes — any
// Firebase ID token is verified uniformly regardless of upstream IdP.
const workspaceDomain = (import.meta.env.VITE_GOOGLE_WORKSPACE_DOMAIN || '').trim()
if (workspaceDomain) {
  googleProvider.setCustomParameters({ hd: workspaceDomain })
}

// Staff SSO — generic OIDC: enabled only once an OIDC provider is configured
// in the Firebase console (Authentication → Sign-in method → Add provider →
// OIDC) and its provider ID is set here. That console step is external and
// one-time, same category as the existing Firebase project setup — nothing
// else in this app needs to change once it's done.
export const oidcProviderId = (import.meta.env.VITE_OIDC_PROVIDER_ID || '').trim()
export const oidcProviderLabel = (import.meta.env.VITE_OIDC_PROVIDER_LABEL || '').trim() || 'SSO'
export const oidcProvider = oidcProviderId ? new OAuthProvider(oidcProviderId) : null
