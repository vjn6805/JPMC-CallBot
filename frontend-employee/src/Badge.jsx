import s from './Badge.module.css'

const MAP = {
  OPEN:            'yellow',
  CONFIRMED:       'green',
  CANCELLED:       'red',
  PENDING_PAYMENT: 'blue',
  RESOLVED:        'green',
}

export default function Badge({ status }) {
  const color = MAP[status] || 'purple'
  return <span className={`${s.badge} ${s[color]}`}>{status?.replace(/_/g, ' ') ?? '—'}</span>
}
