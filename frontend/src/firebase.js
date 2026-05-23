import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore'

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
export const db   = getFirestore(app)

const googleProvider = new GoogleAuthProvider()
export const loginWithGoogle = () => signInWithPopup(auth, googleProvider)
export const logout          = () => signOut(auth)

export async function loadUserDoc(uid, collection) {
  const snap = await getDoc(doc(db, collection, uid))
  return snap.exists() ? snap.data() : null
}

export async function saveUserDoc(uid, collection, data) {
  await setDoc(doc(db, collection, uid), data)
}
