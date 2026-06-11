import { useState } from 'react'
import s from './Login.module.css'

export default function Login({ onLogin }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [err,  setErr]  = useState('')

  function attempt() {
    if (user === 'admin' && pass === 'jpmc@2025') {
      onLogin()
    } else {
      setErr('Invalid credentials')
      setTimeout(() => setErr(''), 2500)
    }
  }

  return (
    <div className={s.root}>
      <div className={s.left}>
        <div className={s.wordmark}>JPMC</div>
        <h1 className={s.headline}>Operations<br/>Dashboard</h1>
        <p className={s.sub}>Internal tool for monitoring IT tickets,<br/>room bookings, food orders & shuttle ops.</p>
        <div className={s.pills}>
          {['IT Helpdesk','Room Booking','Food Ordering','Shuttle Service'].map(f => (
            <span key={f} className={s.pill}>{f}</span>
          ))}
        </div>
      </div>

      <div className={s.right}>
        <div className={s.card}>
          <div className={s.cardTop}>
            <span className={s.cardLabel}>Admin Access</span>
            <div className={s.dot} />
          </div>
          <h2 className={s.cardTitle}>Sign in</h2>

          <div className={s.field}>
            <label>Username</label>
            <input
              value={user}
              onChange={e => setUser(e.target.value)}
              placeholder="admin"
              autoFocus
            />
          </div>
          <div className={s.field}>
            <label>Password</label>
            <input
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="••••••••"
              onKeyDown={e => e.key === 'Enter' && attempt()}
            />
          </div>

          {err && <p className={s.err}>{err}</p>}

          <button className={s.btn} onClick={attempt}>Continue →</button>

          <p className={s.hint}>Only registered admins can access this portal.</p>
        </div>
      </div>
    </div>
  )
}
