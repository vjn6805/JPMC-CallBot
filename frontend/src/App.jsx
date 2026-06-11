import { useState } from 'react'
import Login from './Login'
import Dashboard from './Dashboard'

export default function App() {
  const [authed, setAuthed] = useState(false)

  return authed
    ? <Dashboard onLogout={() => setAuthed(false)} />
    : <Login     onLogin={()  => setAuthed(true)}  />
}
