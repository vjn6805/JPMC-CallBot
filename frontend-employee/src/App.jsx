import { useState } from 'react'
import Portal from './Portal'

export default function App() {
  const [phone, setPhone] = useState('')
  const [employee, setEmployee] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function attempt(p) {
    const cleaned = p.trim()
    if (!cleaned) return
    setLoading(true)
    setErr('')
    try {
      const r = await fetch('/employee/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned })
      })
      const data = await r.json()
      if (!r.ok) { setErr(data.error || 'Not registered'); return }
      setEmployee(data.employee)
    } catch {
      setErr('Could not reach server')
    } finally {
      setLoading(false)
    }
  }

  if (employee) return <Portal employee={employee} onLogout={() => setEmployee(null)} />

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: 4, color: 'var(--text-3)', marginBottom: 8 }}>JPMC EMPLOYEE PORTAL</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={phone}
          onChange={e => setPhone(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && attempt(phone)}
          placeholder="+91XXXXXXXXXX"
          autoFocus
          style={{ background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '10px 14px', fontSize: 14, color: 'var(--text)', outline: 'none', width: 220 }}
        />
        <button
          onClick={() => attempt(phone)}
          disabled={loading}
          style={{ padding: '10px 20px', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
        >
          {loading ? '…' : 'Go'}
        </button>
      </div>
      {err && <p style={{ color: 'var(--red)', fontSize: 13 }}>{err}</p>}
    </div>
  )
}
