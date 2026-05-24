import { useEffect, useMemo, useState } from 'react'
import './App.css'

function App() {
  const apiBase = useMemo(
    () => import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080',
    [],
  )
  const [health, setHealth] = useState('Checking backend...')
  const [serverMessage, setServerMessage] = useState('')
  const [user, setUser] = useState(null)

  useEffect(() => {
    async function checkHealth() {
      try {
        const response = await fetch(`${apiBase}/api/health`)
        const data = await response.json()
        setHealth(data.ok ? 'Backend connected' : 'Backend is not ready')
      } catch (_error) {
        setHealth('Backend not reachable. Start backend with npm run dev.')
      }
    }

    checkHealth()
  }, [apiBase])

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

    if (!clientId || !window.google?.accounts?.id) {
      return
    }

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        try {
          const verifyResponse = await fetch(`${apiBase}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential }),
          })

          const verifyData = await verifyResponse.json()

          if (!verifyResponse.ok) {
            throw new Error(verifyData.error || 'Verification failed')
          }

          setUser(verifyData.user)
          setServerMessage(verifyData.message)
        } catch (error) {
          setServerMessage(error.message)
        }
      },
    })

    window.google.accounts.id.renderButton(
      document.getElementById('googleSignInButton'),
      {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
      },
    )
  }, [apiBase])

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Friends Calendar</p>
        <h1>Find the best weekend meetup time together</h1>
        <p className="lead">
          This starter app already connects your frontend to backend and is ready
          for Google login setup.
        </p>
      </section>

      <section className="card">
        <h2>1) Backend status</h2>
        <p>{health}</p>
        <p className="muted">API Base URL: {apiBase}</p>
      </section>

      <section className="card">
        <h2>2) Sign in with Google</h2>
        <p className="muted">
          Add your OAuth client ID in <code>.env</code> to activate this button.
        </p>
        <div id="googleSignInButton" />
        {serverMessage && <p>{serverMessage}</p>}
        {user && (
          <div className="userBox">
            <img src={user.picture} alt={user.name} />
            <div>
              <p>{user.name}</p>
              <p className="muted">{user.email}</p>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>3) Next implementation steps</h2>
        <ol>
          <li>Request calendar read permission from each signed-in user.</li>
          <li>Let users choose which tags/categories are shareable.</li>
          <li>Convert chosen events into busy time blocks.</li>
          <li>Show overlap windows on a shared group calendar.</li>
        </ol>
      </section>
    </main>
  )
}

export default App
