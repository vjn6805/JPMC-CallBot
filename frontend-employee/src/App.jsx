import Portal from './Portal'

const DEMO_EMPLOYEE = {
  name: 'Veer Jain',
  sid: 'EMP001',
  department: 'Engineering',
  building: 'Tower A',
  floor: 4,
  phone: '+917485963139'
}

export default function App() {
  return <Portal employee={DEMO_EMPLOYEE} onLogout={() => {}} />
}
