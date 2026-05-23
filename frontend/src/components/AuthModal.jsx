import { loginWithGoogle } from '../firebase'

export default function AuthModal({ onClose }) {
  async function handleGoogle() {
    try { await loginWithGoogle(); onClose() }
    catch (e) { console.error(e) }
  }

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ marginBottom: 16, color: 'var(--text-1)' }}>登入以同步雲端</h3>
        <button className="auth-submit" onClick={handleGoogle}>
          Google 帳號登入
        </button>
        <button className="auth-close" onClick={onClose}>✕</button>
      </div>
    </div>
  )
}
