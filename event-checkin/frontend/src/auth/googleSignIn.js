import { Capacitor } from '@capacitor/core'
import { signInWithPopup, signInWithCredential, GoogleAuthProvider } from 'firebase/auth'
import { auth, googleProvider } from '../firebase'

// Google sign-in that works on both web and the Capacitor native app.
//
// Web  → Firebase popup (unchanged behaviour).
// Native → the native Google flow (the web popup does NOT work inside a
//   WebView), then sign the returned credential into the SAME Firebase JS SDK
//   session. Everything downstream (AuthContext, onAuthStateChanged, the
//   /api/auth token) is therefore identical to the web path.
//
// Returns the Firebase UserCredential, so callers can use `cred.user` exactly
// as they did with signInWithPopup.
export async function googleSignIn() {
  if (!Capacitor.isNativePlatform()) {
    return signInWithPopup(auth, googleProvider)
  }
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  const result = await FirebaseAuthentication.signInWithGoogle({
    skipNativeAuth: true,
    useCredentialManager: false,
  })
  const idToken = result?.credential?.idToken
  if (!idToken) {
    const err = new Error('Google sign-in cancelled')
    err.code = 'auth/popup-closed-by-user' // reuse the code callers already ignore
    throw err
  }
  const credential = GoogleAuthProvider.credential(idToken)
  return signInWithCredential(auth, credential)
}
