import { useState } from 'react'
import Login from './Login'
import Portal from './Portal'

export default function App() {
  const [employee, setEmployee] = useState(null)

  return employee
    ? <Portal employee={employee} onLogout={() => setEmployee(null)} />
    : <Login  onLogin={emp => setEmployee(emp)} />
}
