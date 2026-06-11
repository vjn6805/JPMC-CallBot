import { useState, useEffect, useCallback } from 'react'
import Badge from './Badge'
import s from './Portal.module.css'

const TABS = [
  { id: 'tickets',  label: 'IT Tickets',       icon: '🎫' },
  { id: 'rooms',    label: 'Room Bookings',     icon: '🏢' },
  { id: 'food',     label: 'Food Orders',       icon: '🍽️' },
  { id: 'shuttle',  label: 'Shuttle Bookings',  icon: '🚌' },
]

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function MonoId({ id }) {
  return <code className={s.monoId}>{id}</code>
}

function CancelBtn({ onClick, disabled }) {
  return (
    <button className={s.cancelBtn} onClick={onClick} disabled={disabled}>
      Cancel
    </button>
  )
}

export default function Portal({ employee }) {
  const [tab,     setTab]     = useState('tickets')
  const [data,    setData]    = useState({ tickets: [], rooms: [], food: [], shuttles: [] })
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(null) // booking_id being cancelled
  const [confirm, setConfirm] = useState(null) // { type, id } pending confirm

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/employee/my-data?phone=${encodeURIComponent(employee.phone)}`)
      const d = await r.json()
      setData(d)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [employee.phone])

  useEffect(() => { load() }, [load])

  async function doCancel(type, id) {
    setCancelling(id)
    setConfirm(null)
    try {
      const r = await fetch(`/employee/cancel/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: employee.phone, booking_id: id })
      })
      if (r.ok) await load()
    } catch { /* silent */ }
    finally { setCancelling(null) }
  }

  const counts = {
    tickets: data.tickets?.length ?? 0,
    rooms:   data.rooms?.length   ?? 0,
    food:    data.food?.length    ?? 0,
    shuttle: data.shuttles?.length ?? 0,
  }

  const openTickets = data.tickets?.filter(t => t.status === 'OPEN').length ?? 0
  const activeRooms = data.rooms?.filter(r => r.status === 'CONFIRMED').length ?? 0
  const pendingFood = data.food?.filter(f => f.status === 'PENDING_PAYMENT').length ?? 0
  const confShuttle = data.shuttles?.filter(s => s.status === 'CONFIRMED').length ?? 0

  return (
    <div className={s.root}>
      {/* Topbar */}
      <header className={s.topbar}>
        <div className={s.topLeft}>
          <span className={s.wordmark}>JPMC</span>
          <span className={s.topSep} />
          <span className={s.topTitle}>Employee Portal</span>
        </div>
        <div className={s.topRight}>
          <button className={s.refreshBtn} onClick={load}>↻ Refresh</button>
          <div className={s.empChip}>
            <span className={s.empDot} />
            <span>{employee.name}</span>
            <span className={s.empSid}>{employee.sid}</span>
          </div>

        </div>
      </header>

      <div className={s.body}>
        {/* Sidebar */}
        <nav className={s.sidebar}>
          <div className={s.navGroup}>
            <p className={s.navLabel}>My Activity</p>
            {TABS.map(t => (
              <button
                key={t.id}
                className={`${s.navItem} ${tab === t.id ? s.navActive : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className={s.navIcon}>{t.icon}</span>
                <span className={s.navText}>{t.label}</span>
                <span className={`${s.navCount} ${tab === t.id ? s.navCountActive : ''}`}>
                  {counts[t.id]}
                </span>
              </button>
            ))}
          </div>

          <div className={s.sidebarFooter}>
            <div className={s.empInfo}>
              <div className={s.empInfoName}>{employee.name}</div>
              <div className={s.empInfoMeta}>{employee.department} · {employee.building}</div>
            </div>
          </div>
        </nav>

        {/* Content */}
        <main className={s.main}>
          {/* Stat cards */}
          <div className={s.stats}>
            <div className={s.statCard} onClick={() => setTab('tickets')} style={{ cursor: 'pointer' }}>
              <div className={s.statLabel}>Open Tickets</div>
              <div className={s.statValue} style={{ color: 'var(--yellow)' }}>{openTickets}</div>
            </div>
            <div className={s.statCard} onClick={() => setTab('rooms')} style={{ cursor: 'pointer' }}>
              <div className={s.statLabel}>Room Bookings</div>
              <div className={s.statValue} style={{ color: 'var(--blue)' }}>{activeRooms}</div>
            </div>
            <div className={s.statCard} onClick={() => setTab('food')} style={{ cursor: 'pointer' }}>
              <div className={s.statLabel}>Pending Payments</div>
              <div className={s.statValue} style={{ color: 'var(--purple)' }}>{pendingFood}</div>
            </div>
            <div className={s.statCard} onClick={() => setTab('shuttle')} style={{ cursor: 'pointer' }}>
              <div className={s.statLabel}>Shuttle Bookings</div>
              <div className={s.statValue} style={{ color: 'var(--green)' }}>{confShuttle}</div>
            </div>
          </div>

          {/* Confirm dialog */}
          {confirm && (
            <div className={s.confirmBar}>
              <span>Cancel <code>{confirm.id}</code>? This cannot be undone.</span>
              <div className={s.confirmActions}>
                <button className={s.confirmYes} onClick={() => doCancel(confirm.type, confirm.id)}>
                  Yes, cancel it
                </button>
                <button className={s.confirmNo} onClick={() => setConfirm(null)}>
                  Keep it
                </button>
              </div>
            </div>
          )}

          {/* Tab label */}
          <div className={s.tabHeader}>
            <span className={s.tabTitle}>{TABS.find(t => t.id === tab)?.label}</span>
            <span className={s.tabCount}>{counts[tab]} records</span>
          </div>

          {/* Tables */}
          {loading ? (
            <div className={s.loadingWrap}><span className={s.spinner} /> Loading your data…</div>
          ) : (
            <>
              {/* IT Tickets */}
              {tab === 'tickets' && (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead><tr>
                      <th>Ticket ID</th><th>Issue</th><th>Category</th>
                      <th>Assigned To</th><th>SLA</th><th>Status</th><th>Raised</th>
                    </tr></thead>
                    <tbody>
                      {data.tickets?.length === 0
                        ? <tr><td colSpan={7} className={s.empty}>No tickets raised</td></tr>
                        : data.tickets?.map(t => (
                          <tr key={t.ticket_id}>
                            <td><MonoId id={t.ticket_id} /></td>
                            <td className={s.issueCell}>{t.issue_description}</td>
                            <td>{t.category}</td>
                            <td>{t.assigned_team}</td>
                            <td className={s.mono}>{t.sla_hours ? `${t.sla_hours}h` : '—'}</td>
                            <td><Badge status={t.status} /></td>
                            <td className={s.ts}>{fmtDate(t.raised_at)}</td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              )}

              {/* Room Bookings */}
              {tab === 'rooms' && (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead><tr>
                      <th>Booking ID</th><th>Room</th><th>Type</th><th>Location</th>
                      <th>Date</th><th>Time</th><th>Status</th><th>Action</th>
                    </tr></thead>
                    <tbody>
                      {data.rooms?.length === 0
                        ? <tr><td colSpan={8} className={s.empty}>No room bookings</td></tr>
                        : data.rooms?.map(b => (
                          <tr key={b.booking_id}>
                            <td><MonoId id={b.booking_id} /></td>
                            <td className={s.bold}>{b.room_name}</td>
                            <td className={s.cap}>{b.room_type}</td>
                            <td>Fl {b.floor} · {b.building}</td>
                            <td>{b.date}</td>
                            <td className={s.mono}>{b.start_time} – {b.end_time}</td>
                            <td><Badge status={b.status} /></td>
                            <td>
                              {b.status === 'CONFIRMED'
                                ? <CancelBtn
                                    disabled={cancelling === b.booking_id}
                                    onClick={() => setConfirm({ type: 'room', id: b.booking_id })}
                                  />
                                : <span className={s.na}>—</span>
                              }
                            </td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              )}

              {/* Food Orders */}
              {tab === 'food' && (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead><tr>
                      <th>Order ID</th><th>Outlet</th><th>Location</th>
                      <th>Items</th><th>Total</th><th>Status</th><th>Action</th>
                    </tr></thead>
                    <tbody>
                      {data.food?.length === 0
                        ? <tr><td colSpan={7} className={s.empty}>No food orders</td></tr>
                        : data.food?.map(o => (
                          <tr key={o.order_id}>
                            <td><MonoId id={o.order_id} /></td>
                            <td className={s.bold}>{o.outlet_name}</td>
                            <td>Fl {o.floor} · {o.building}</td>
                            <td className={s.itemsList}>{(o.items || []).map(i => i.name).join(', ')}</td>
                            <td className={s.amount}>₹{o.total_amount}</td>
                            <td><Badge status={o.status} /></td>
                            <td>
                              {o.status === 'PENDING_PAYMENT' && o.payment_link
                                ? <a href={o.payment_link} target="_blank" rel="noreferrer" className={s.payBtn}>
                                    Pay now
                                  </a>
                                : <span className={s.na}>—</span>
                              }
                            </td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              )}

              {/* Shuttle Bookings */}
              {tab === 'shuttle' && (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead><tr>
                      <th>Booking ID</th><th>Route</th><th>Travel Date</th>
                      <th>Departure</th><th>Pickup</th><th>Status</th><th>Action</th>
                    </tr></thead>
                    <tbody>
                      {data.shuttles?.length === 0
                        ? <tr><td colSpan={7} className={s.empty}>No shuttle bookings</td></tr>
                        : data.shuttles?.map(b => (
                          <tr key={b.booking_id}>
                            <td><MonoId id={b.booking_id} /></td>
                            <td className={s.bold}>{b.route_name}</td>
                            <td>{b.travel_date}</td>
                            <td className={s.mono}>{b.departure_time}</td>
                            <td>{b.pickup_point}</td>
                            <td><Badge status={b.status} /></td>
                            <td>
                              {b.status === 'CONFIRMED'
                                ? <CancelBtn
                                    disabled={cancelling === b.booking_id}
                                    onClick={() => setConfirm({ type: 'shuttle', id: b.booking_id })}
                                  />
                                : <span className={s.na}>—</span>
                              }
                            </td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
