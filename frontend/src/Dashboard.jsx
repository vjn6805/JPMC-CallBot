import { useState, useEffect, useCallback } from 'react'
import Table from './Table'
import Badge from './Badge'
import s from './Dashboard.module.css'

const TABS = [
  { id: 'tickets',  label: 'IT Tickets',       icon: '🎫', endpoint: '/api/tickets' },
  { id: 'rooms',    label: 'Room Bookings',     icon: '🏢', endpoint: '/api/room-bookings' },
  { id: 'food',     label: 'Food Orders',       icon: '🍽️', endpoint: '/api/food-orders' },
  { id: 'shuttle',  label: 'Shuttle Bookings',  icon: '🚌', endpoint: '/api/shuttle-bookings' },
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

function EmpCell({ name, sid }) {
  return (
    <div>
      <div className={s.empName}>{name}</div>
      <div className={s.empSid}>{sid}</div>
    </div>
  )
}

const COLS = {
  tickets: [
    { key: 'ticket_id',        label: 'Ticket ID',   render: r => <MonoId id={r.ticket_id} /> },
    { key: 'employee_name',    label: 'Employee',    render: r => <EmpCell name={r.employee_name} sid={r.employee_sid} /> },
    { key: 'department',       label: 'Dept' },
    { key: 'category',         label: 'Category' },
    { key: 'assigned_team',    label: 'Assigned To' },
    { key: 'sla_hours',        label: 'SLA',         render: r => r.sla_hours ? `${r.sla_hours}h` : '—' },
    { key: 'status',           label: 'Status',      render: r => <Badge status={r.status} /> },
    { key: 'raised_at',        label: 'Raised',      render: r => <span className={s.ts}>{fmtDate(r.raised_at)}</span> },
  ],
  rooms: [
    { key: 'booking_id',       label: 'Booking ID',  render: r => <MonoId id={r.booking_id} /> },
    { key: 'employee_name',    label: 'Employee',    render: r => <EmpCell name={r.employee_name} sid={r.employee_sid} /> },
    { key: 'room_name',        label: 'Room' },
    { key: 'room_type',        label: 'Type',        render: r => <span className={s.cap}>{r.room_type}</span> },
    { key: 'location',         label: 'Location',    render: r => `Fl ${r.floor} · ${r.building}` },
    { key: 'date',             label: 'Date' },
    { key: 'time',             label: 'Time',        render: r => `${r.start_time} – ${r.end_time}` },
    { key: 'status',           label: 'Status',      render: r => <Badge status={r.status} /> },
  ],
  food: [
    { key: 'order_id',         label: 'Order ID',    render: r => <MonoId id={r.order_id} /> },
    { key: 'employee_name',    label: 'Employee',    render: r => <EmpCell name={r.employee_name} sid={r.employee_sid} /> },
    { key: 'outlet_name',      label: 'Outlet' },
    { key: 'location',         label: 'Location',    render: r => `Fl ${r.floor} · ${r.building}` },
    { key: 'items',            label: 'Items',       style: { maxWidth: 200 },
      render: r => <span className={s.itemsList}>{(r.items || []).map(i => i.name).join(', ') || '—'}</span> },
    { key: 'total_amount',     label: 'Total',       render: r => <span className={s.amount}>₹{r.total_amount}</span> },
    { key: 'status',           label: 'Status',      render: r => <Badge status={r.status} /> },
    { key: 'ordered_at',       label: 'Ordered',     render: r => <span className={s.ts}>{fmtDate(r.ordered_at)}</span> },
  ],
  shuttle: [
    { key: 'booking_id',       label: 'Booking ID',  render: r => <MonoId id={r.booking_id} /> },
    { key: 'employee_name',    label: 'Employee',    render: r => <EmpCell name={r.employee_name} sid={r.employee_sid} /> },
    { key: 'route_name',       label: 'Route' },
    { key: 'travel_date',      label: 'Travel Date' },
    { key: 'departure_time',   label: 'Departure' },
    { key: 'pickup_point',     label: 'Pickup' },
    { key: 'status',           label: 'Status',      render: r => <Badge status={r.status} /> },
    { key: 'booked_at',        label: 'Booked',      render: r => <span className={s.ts}>{fmtDate(r.booked_at)}</span> },
  ],
}

function useData(endpoint) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const r = await fetch(endpoint)
      setData(await r.json())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load }
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className={s.statCard}>
      <div className={s.statTop}>
        <span className={s.statLabel}>{label}</span>
        <span className={s.statDot} style={{ background: color }} />
      </div>
      <div className={s.statValue} style={{ color }}>{value ?? '—'}</div>
      <div className={s.statSub}>{sub}</div>
    </div>
  )
}

export default function Dashboard({ onLogout }) {
  const [tab, setTab] = useState('tickets')

  const tickets = useData('/api/tickets')
  const rooms   = useData('/api/room-bookings')
  const food    = useData('/api/food-orders')
  const shuttle = useData('/api/shuttle-bookings')

  const counts = {
    tickets: tickets.data.length,
    rooms:   rooms.data.length,
    food:    food.data.length,
    shuttle: shuttle.data.length,
  }

  const openTickets    = tickets.data.filter(t => t.status === 'OPEN').length
  const confirmedRooms = rooms.data.filter(r => r.status === 'CONFIRMED').length
  const pendingFood    = food.data.filter(f => f.status === 'PENDING_PAYMENT').length
  const confShuttle    = shuttle.data.filter(s => s.status === 'CONFIRMED').length

  const dataMap = { tickets, rooms, food, shuttle }
  const current = dataMap[tab]

  function reloadAll() {
    tickets.reload()
    rooms.reload()
    food.reload()
    shuttle.reload()
  }

  return (
    <div className={s.root}>
      {/* Topbar */}
      <header className={s.topbar}>
        <div className={s.topLeft}>
          <span className={s.wordmark}>JPMC</span>
          <span className={s.topSep} />
          <span className={s.topTitle}>Operations Dashboard</span>
        </div>
        <div className={s.topRight}>
          <button className={s.refreshBtn} onClick={reloadAll}>↻ Refresh all</button>
          <div className={s.adminChip}>
            <span className={s.adminDot} />
            admin
          </div>
          <button className={s.logoutBtn} onClick={onLogout}>Sign out</button>
        </div>
      </header>

      <div className={s.body}>
        {/* Sidebar */}
        <nav className={s.sidebar}>
          <div className={s.navGroup}>
            <p className={s.navLabel}>Modules</p>
            {TABS.map(t => (
              <button
                key={t.id}
                className={`${s.navItem} ${tab === t.id ? s.navActive : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className={s.navIcon}>{t.icon}</span>
                <span className={s.navText}>{t.label}</span>
                <span className={`${s.navCount} ${tab === t.id ? s.navCountActive : ''}`}>
                  {counts[t.id] ?? '—'}
                </span>
              </button>
            ))}
          </div>

          <div className={s.sidebarFooter}>
            <div className={s.sidebarStatus}>
              <span className={s.statusDot} />
              <span>Live</span>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <main className={s.main}>
          {/* Stat cards */}
          <div className={s.stats}>
            <StatCard label="Open Tickets"      value={openTickets}    sub="Awaiting resolution"  color="var(--yellow)" />
            <StatCard label="Active Rooms"       value={confirmedRooms} sub="Confirmed bookings"   color="var(--blue)"   />
            <StatCard label="Pending Payments"   value={pendingFood}    sub="Food orders"           color="var(--purple)" />
            <StatCard label="Shuttle Seats"      value={confShuttle}    sub="Confirmed today"       color="var(--green)"  />
          </div>

          {/* Tab header */}
          <div className={s.tabHeader}>
            <div className={s.tabMeta}>
              <span className={s.tabTitle}>{TABS.find(t => t.id === tab)?.label}</span>
              <span className={s.tabCount}>{counts[tab]} records</span>
            </div>
            <button className={s.reloadBtn} onClick={current.reload}>↻</button>
          </div>

          {/* Table */}
          <Table
            cols={COLS[tab]}
            rows={current.data}
            loading={current.loading}
            error={current.error}
          />
        </main>
      </div>
    </div>
  )
}
