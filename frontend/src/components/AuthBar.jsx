import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, loginWithGoogle, logout } from '../firebase'

export default function AuthBar({ onUserChange }) {
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u)
      onUserChange?.(u)
    })
  }, [onUserChange])

  if (user === undefined) return <div className="auth-bar" />

  if (user) return (
    <div className="auth-bar">
      {user.photoURL && <img src={user.photoURL} alt="" className="auth-avatar" />}
      <span className="auth-email">{user.email}</span>
      <button className="auth-btn" onClick={logout}>登出</button>
    </div>
  )

  return (
    <div className="auth-bar">
      <span className="auth-hint">登入後跨裝置同步</span>
      <button className="auth-btn auth-login" onClick={loginWithGoogle}>
        Google 登入
      </button>
    </div>
  )
}
