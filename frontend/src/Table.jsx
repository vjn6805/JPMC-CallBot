import s from './Table.module.css'

export default function Table({ cols, rows, loading, error }) {
  return (
    <div className={s.wrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {cols.map(c => <th key={c.key}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={cols.length} className={s.center}>
              <span className={s.spinner} /> Loading…
            </td></tr>
          ) : error ? (
            <tr><td colSpan={cols.length} className={s.center} style={{ color: 'var(--red)' }}>
              Failed to load data
            </td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={cols.length} className={s.center}>No records</td></tr>
          ) : rows.map((row, i) => (
            <tr key={i}>
              {cols.map(c => (
                <td key={c.key} style={c.style}>{c.render ? c.render(row) : row[c.key] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
