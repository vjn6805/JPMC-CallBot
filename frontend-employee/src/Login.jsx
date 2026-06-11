import { useState } from 'react'
import s from './Login.module.css'

export default function Login({ onLogin }) {
  const [phone, setPhone] = useState('')
  const [err,   setErr]   = useState('')
  const [loading, setLoading] = useState(false)

  async function attempt() {
    const cleaned = phone.trim()
    if (!cleaned) { setErr('Enter your registered phone number'); return }
    setLoading(true)
    setErr('')
    try {
      const r = await fetch('/employee/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned })
      })
      const data = await r.json()
      if (!r.ok) { setErr(data.error || 'Login failed'); return }
      onLogin(data.employee)
    } catch {
      setErr('Could not reach server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={s.root}>
      <div className={s.left}>
        <div className={s.wordmark}>JPMC</div>
        <h1 className={s.headline}>Employee<br/>Portal</h1>
        <p className={s.sub}>Manage your bookings, orders, and IT tickets — all in one place.</p>
        <div className={s.features}>
          {[
            { icon: '🎫', label: 'IT Tickets',      desc: 'View & track support requests' },
            { icon: '🏢', label: 'Room Bookings',    desc: 'View & cancel meeting rooms' },
            { icon: '🍽️', label: 'Food Orders',      desc: 'View your orders & pay' },
            { icon: '🚌', label: 'Shuttle Bookings', desc: 'View & cancel shuttle seats' },
          ].map(f => (
            <div key={f.label} className={s.featureItem}>
              <span className={s.featureIcon}>{f.icon}</span>
              <div>
                <div className={s.featureLabel}>{f.label}</div>
                <div className={s.featureDesc}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={s.right}>
        <div className={s.card}>
          <div className={s.cardTop}>
            <span className={s.cardLabel}>Employee Access</span>
            <div className={s.liveDot} />
          </div>
          <h2 className={s.cardTitle}>Sign in</h2>
          <p className={s.cardSub}>Use your JPMC-registered phone number</p>

          <div className={s.field}>
            <label>Phone Number</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+91XXXXXXXXXX"
              onKeyDown={e => e.key === 'Enter' && attempt()}
              autoFocus
            />
          </div>

          {err && <p className={s.err}>{err}</p>}

          <button className={s.btn} onClick={attempt} disabled={loading}>
            {loading ? 'Verifying…' : 'Continue →'}
          </button>

          <p className={s.hint}>Your number is matched against JPMC employee records.</p>
        </div>
      </div>
    </div>
  )
}
