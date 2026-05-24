import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STORAGE_USER_KEY = 'friends-cal.user'
const STORAGE_TOKEN_KEY = 'friends-cal.token'

function getLocalDayKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDayKey(dayKey) {
  const [year, month, day] = String(dayKey).split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function parseEventRange(block) {
  const startDateTime = block.start?.dateTime
  const endDateTime = block.end?.dateTime

  if (startDateTime && endDateTime) {
    return {
      startMs: new Date(startDateTime).getTime(),
      endMs: new Date(endDateTime).getTime(),
    }
  }

  // All-day events use "date" and Google sends end date as exclusive.
  if (block.start?.date && block.end?.date) {
    return {
      startMs: new Date(`${block.start.date}T00:00:00`).getTime(),
      endMs: new Date(`${block.end.date}T00:00:00`).getTime(),
    }
  }

  return null
}

function formatEventDateRange(event) {
  const range = parseEventRange(event)
  if (!range) return ''
  const start = new Date(range.startMs)
  const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (event.start?.dateTime) {
    const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${dateStr} · ${timeStr}`
  }
  return dateStr
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

function getEventStartMs(event) {
  const range = parseEventRange(event)
  return range?.startMs ?? Number.MAX_SAFE_INTEGER
}

function getInitials(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  if (raw.includes('@')) {
    const local = raw.split('@')[0].replace(/[^a-zA-Z0-9]/g, '')
    return local.slice(0, 2).toUpperCase()
  }

  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function App() {
  const apiBase = useMemo(
    () => import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080',
    [],
  )
  const [health, setHealth] = useState('Checking backend...')
  const [serverMessage, setServerMessage] = useState('')
  const [user, setUser] = useState(null)
  const [googleClientId, setGoogleClientId] = useState(
    () => import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  )

  // Calendar state
  const [accessToken, setAccessToken] = useState(null)
  const [calendars, setCalendars] = useState([])
  // calendarModes: { [calendarId]: 'unavailable' | 'free' | 'individual' }
  const [calendarModes, setCalendarModes] = useState({})
  // eventOverrides: { [eventId]: 'free' | 'unavailable' }
  const [eventOverrides, setEventOverrides] = useState({})
  const [tagInput, setTagInput] = useState('')
  const [busyBlocks, setBusyBlocks] = useState(null)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [requiredDays, setRequiredDays] = useState(2)
  const [includeWeekends, setIncludeWeekends] = useState(true)
  const [selectedDayKey, setSelectedDayKey] = useState(null)
  const [titleDecisions, setTitleDecisions] = useState({})
  const [showDecidedEvents, setShowDecidedEvents] = useState(false)
  const [calendarModesLoaded, setCalendarModesLoaded] = useState(false)
  const [isAutoConnecting, setIsAutoConnecting] = useState(false)
  const [showSupportModal, setShowSupportModal] = useState(false)
  const [shareStatus, setShareStatus] = useState('')
  const [members, setMembers] = useState([])
  const [groupBusyBlocks, setGroupBusyBlocks] = useState([])
  const [joinLoading, setJoinLoading] = useState(false)
  const hasJoined = members.some((m) => m.email === user?.email)
    const [excludedUsers, setExcludedUsers] = useState(new Set())
    const [leaveLoading, setLeaveLoading] = useState(false)
  const connectedUserInitial = useMemo(
    () => getInitials(user?.name || user?.email || ''),
    [user?.name, user?.email],
  )
  const calendarWindow = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)

    const end = new Date(start.getFullYear(), start.getMonth() + 5, 0)
    end.setHours(23, 59, 59, 999)

    const daysCount =
      Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1

    return { start, end, daysCount }
  }, [])

  const loadCalendarsForToken = useCallback(
    async (token) => {
      const res = await fetch(`${apiBase}/api/calendar/list`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load calendars')
      }

      const orderedCalendars = [...data.calendars].sort(
        (a, b) => Number(b.primary) - Number(a.primary),
      )
      setCalendars(orderedCalendars)

      // Default all calendars to 'unavailable' until saved settings load.
      setCalendarModes(
        Object.fromEntries(orderedCalendars.map((cal) => [cal.id, 'unavailable'])),
      )
      setCalendarModesLoaded(false)
    },
    [apiBase],
  )

  // Request calendar access and load calendars.
  const connectCalendar = useCallback(() => {
    const clientId = googleClientId

    if (!clientId) {
      setCalendarError('VITE_GOOGLE_CLIENT_ID not configured.')
      return Promise.resolve(false)
    }

    if (!window.google?.accounts?.oauth2) {
      setCalendarError('Google client not ready. Please wait for the page to fully load.')
      console.error('window.google.accounts.oauth2 not available', {
        hasGoogle: !!window.google,
        hasAccounts: !!window.google?.accounts,
      })
      return Promise.resolve(false)
    }

    if (typeof window.google.accounts.oauth2.initTokenClient !== 'function') {
      setCalendarError('Google OAuth2 not available.')
      return Promise.resolve(false)
    }

    return new Promise((resolve) => {
      let resolved = false
      let callbackFired = false

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true
          setCalendarLoading(false)
          const msg = callbackFired 
            ? 'Google authentication callback error.' 
            : 'Google authentication timed out (30s). Check if popup was blocked or try refreshing the page.'
          setCalendarError(msg)
          console.error('Google auth timeout', { callbackFired, clientId })
          resolve(false)
        }
      }, 30000) // 30 second timeout

      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/calendar.readonly',
          prompt: 'consent',
          callback: async (tokenResponse) => {
            callbackFired = true
            console.log('🔵 Callback fired!', { hasError: !!tokenResponse.error })

            if (resolved) {
              console.warn('Callback fired after timeout or already resolved')
              return
            }
            resolved = true
            clearTimeout(timeoutId)

            if (tokenResponse.error) {
              setCalendarError('Calendar permission denied: ' + tokenResponse.error)
              setCalendarLoading(false)
              console.error('Token error:', tokenResponse.error)
              resolve(false)
              return
            }

            if (!tokenResponse.access_token) {
              setCalendarError('No access token received from Google')
              setCalendarLoading(false)
              console.error('No access token in response')
              resolve(false)
              return
            }

            console.log('✅ Access token received')
            setAccessToken(tokenResponse.access_token)
            localStorage.setItem(STORAGE_TOKEN_KEY, tokenResponse.access_token)
            setCalendarError('')
            setCalendarLoading(true)

            try {
              await loadCalendarsForToken(tokenResponse.access_token)
              console.log('✅ Calendars loaded')
              resolve(true)
            } catch (err) {
              console.error('❌ Calendar list fetch error:', err)
              setCalendarError(err.message)
              resolve(false)
            } finally {
              setCalendarLoading(false)
            }
          },
        })

        console.log('🟡 Token client created, requesting access token...')
        tokenClient.requestAccessToken()
      } catch (error) {
        resolved = true
        clearTimeout(timeoutId)
        console.error('❌ Error creating token client:', error)
        setCalendarError('Failed to initialize Google auth: ' + error.message)
        setCalendarLoading(false)
        resolve(false)
      }
    })
  }, [apiBase, googleClientId, loadCalendarsForToken])

  useEffect(() => {
    const rawUser = localStorage.getItem(STORAGE_USER_KEY)
    const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY)

    if (rawUser) {
      try {
        const parsedUser = JSON.parse(rawUser)
        if (parsedUser?.id && !user) {
          setUser(parsedUser)
        }
      } catch (_err) {
        localStorage.removeItem(STORAGE_USER_KEY)
      }
    }

    if (!savedToken || accessToken) return

    setAccessToken(savedToken)
    setCalendarLoading(true)
    setServerMessage('Session restored.')

    async function restoreCalendars() {
      try {
        await loadCalendarsForToken(savedToken)
      } catch (err) {
        console.error('Failed to restore session:', err)
        localStorage.removeItem(STORAGE_TOKEN_KEY)
        setAccessToken(null)
        setServerMessage('Session expired. Please connect calendar again.')
      } finally {
        setCalendarLoading(false)
      }
    }

    void restoreCalendars()
  }, [accessToken, loadCalendarsForToken, user])

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
    if (googleClientId) return

    async function loadRuntimeConfig() {
      try {
        const response = await fetch(`${apiBase}/api/config`)
        const data = await response.json()
        if (data?.googleClientId) {
          setGoogleClientId(data.googleClientId)
        }
      } catch (_error) {
        // non-blocking; frontend env var may still provide the client id
      }
    }

    void loadRuntimeConfig()
  }, [apiBase, googleClientId])

  useEffect(() => {
    const clientId = googleClientId

    if (!clientId) {
      console.error('VITE_GOOGLE_CLIENT_ID is not set')
      setServerMessage('Error: Google Client ID not configured')
      return
    }

    if (!window.google?.accounts?.id) {
      console.error('Google Sign-In script not loaded yet')
      return
    }

    console.log('🟡 Initializing Google Sign-In with client ID:', clientId.substring(0, 20) + '...')

    try {
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
            localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(verifyData.user))
            setServerMessage('Signed in. Connecting your calendar...')
            setIsAutoConnecting(true)

            const connected = await connectCalendar()
            setServerMessage(
              connected
                ? 'Signed in and calendar connected.'
                : 'Signed in, but calendar connection needs approval. Use the button below.',
            )
          } catch (error) {
            setServerMessage(error.message)
          } finally {
            setIsAutoConnecting(false)
          }
        },
      })

      const buttonEl = document.getElementById('googleSignInButton')
      if (buttonEl) {
        console.log('✅ Rendering Google Sign-In button')
        window.google.accounts.id.renderButton(buttonEl, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
        })
      } else {
        console.error('❌ Google Sign-In button element not found')
      }
    } catch (error) {
      console.error('❌ Error initializing Google Sign-In:', error)
      setServerMessage('Error initializing Google Sign-In: ' + error.message)
    }
  }, [apiBase, connectCalendar, googleClientId])

  useEffect(() => {
    if (!user?.id || calendars.length === 0) return

    async function loadCalendarModes() {
      try {
        const res = await fetch(
          `${apiBase}/api/calendar-modes?userId=${encodeURIComponent(user.id)}`,
        )
        const data = await res.json()
        const savedModes = data.calendarModes || {}

        // Keep only current calendars; default missing ones to unavailable.
        const mergedModes = Object.fromEntries(
          calendars.map((cal) => [cal.id, savedModes[cal.id] || 'unavailable']),
        )
        setCalendarModes(mergedModes)
      } catch (err) {
        console.error('Failed to load calendar modes:', err)
      } finally {
        setCalendarModesLoaded(true)
      }
    }

    void loadCalendarModes()
  }, [apiBase, user?.id, calendars])

  useEffect(() => {
    if (!user?.id || !calendarModesLoaded || calendars.length === 0) return

    // Persist only currently visible calendars from section 3.
    const currentModes = Object.fromEntries(
      calendars.map((cal) => [cal.id, calendarModes[cal.id] || 'unavailable']),
    )

    async function saveCalendarModes() {
      try {
        await fetch(`${apiBase}/api/calendar-modes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            calendarModes: currentModes,
          }),
        })
      } catch (err) {
        console.error('Failed to save calendar modes:', err)
      }
    }

    void saveCalendarModes()
  }, [apiBase, user?.id, calendarModesLoaded, calendars, calendarModes])

  const setCalendarMode = useCallback((calendarId, mode) => {
    setCalendarModes((prev) => ({ ...prev, [calendarId]: mode }))
  }, [])

  const toggleEventOverride = useCallback((eventId) => {
    setEventOverrides((prev) => ({
      ...prev,
      [eventId]: prev[eventId] === 'free' ? 'unavailable' : 'free',
    }))
  }, [])

  const saveTitleDecision = useCallback(
    async (normalizedTitle, decision) => {
      if (!user?.id) return
      try {
        await fetch(`${apiBase}/api/decisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            titleDecisions: { [normalizedTitle]: decision },
          }),
        })
      } catch (err) {
        console.error('Failed to save decision:', err)
      }
    },
    [apiBase, user?.id],
  )

  const setGroupDecision = useCallback(
    (normalizedTitle, decision, groupEvents) => {
      setEventOverrides((prev) => {
        const next = { ...prev }
        groupEvents.forEach((e) => {
          next[e.id] = decision
        })
        return next
      })
      void saveTitleDecision(normalizedTitle, decision)
    },
    [saveTitleDecision],
  )

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareStatus('Share link copied. Send it to friends for testing.')
    } catch (_err) {
      setShareStatus('Could not copy automatically. Copy the URL from your browser.')
    }
  }, [])

  useEffect(() => {
    if (!shareStatus) return
    const t = setTimeout(() => setShareStatus(''), 3200)
    return () => clearTimeout(t)
  }, [shareStatus])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setShowSupportModal(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Fetch group members roster on load and whenever user signs in
  useEffect(() => {
    async function fetchMembers() {
      try {
        const res = await fetch(`${apiBase}/api/members`)
        const data = await res.json()
        if (res.ok) setMembers(data.members || [])
      } catch (_err) {
        // non-blocking
      }
    }
    void fetchMembers()
  }, [apiBase, user?.id])

  const joinGroup = useCallback(async () => {
    if (!user) return
    setJoinLoading(true)
    try {
      await fetch(`${apiBase}/api/members/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture,
        }),
      })
      // Refresh roster
      const res = await fetch(`${apiBase}/api/members`)
      const data = await res.json()
      if (res.ok) setMembers(data.members || [])
    } catch (_err) {
      // non-blocking
    } finally {
      setJoinLoading(false)
    }
  }, [apiBase, user])

  const leaveGroup = useCallback(async () => {
    if (!user) return
    setLeaveLoading(true)
    try {
      await fetch(`${apiBase}/api/members/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      const res = await fetch(`${apiBase}/api/members`)
      const data = await res.json()
      if (res.ok) setMembers(data.members || [])
    } catch (_err) {
      // non-blocking
    } finally {
      setLeaveLoading(false)
    }
  }, [apiBase, user])

  const findBusyBlocks = useCallback(async () => {
    if (!accessToken || calendars.length === 0) return
    setCalendarLoading(true)
    setBusyBlocks(null)
    setGroupBusyBlocks([])
    setSelectedDayKey(null)
    setCalendarError('')

    try {
      const tags = tagInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const res = await fetch(`${apiBase}/api/calendar/busy-blocks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          calendarIds: calendars.map((c) => c.id),
          tags,
          daysAhead: calendarWindow.daysCount,
          userId: user?.id,
          userName: user?.name,
          userEmail: user?.email,
        }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to fetch busy blocks')

      setBusyBlocks(data)

      // Fetch other group members' stored busy blocks
      try {
        const groupRes = await fetch(
          `${apiBase}/api/calendar/group-busy-blocks?excludeUserId=${encodeURIComponent(user?.id || '')}`,
        )
        if (groupRes.ok) {
          const groupData = await groupRes.json()
          setGroupBusyBlocks(groupData.members || [])
        }
      } catch (_groupErr) {
        // non-blocking — we still show own data
      }
    } catch (err) {
      setCalendarError(err.message)
    } finally {
      setCalendarLoading(false)
    }
  }, [apiBase, accessToken, calendars, tagInput, calendarWindow.daysCount, user?.id, user?.name, user?.email])

  useEffect(() => {
    if (!accessToken || calendars.length === 0) return
    void findBusyBlocks()
  }, [findBusyBlocks, accessToken, calendars.length])

  const joinedGroupBusyBlocks = useMemo(() => {
    const joinedEmails = new Set(
      members
        .map((m) => String(m.email || '').toLowerCase())
        .filter(Boolean),
    )

    return groupBusyBlocks.filter((m) =>
      joinedEmails.has(String(m.userEmail || '').toLowerCase()),
    )
  }, [groupBusyBlocks, members])

  const availabilityData = useMemo(() => {
    if (!busyBlocks?.busyBlocks) {
      return { months: [], candidates: [], dayLookup: new Map() }
    }

    // Determine if a given event effectively blocks the day
    const isBlocking = (event) => {
      const mode = calendarModes[event.calendarId] ?? 'unavailable'
      if (mode === 'free') return false
      if (mode === 'unavailable') return true
      // 'individual': check per-event override; default is blocking
      return eventOverrides[event.id] !== 'free'
    }

    // Own blocking events
    const blockingRanges = busyBlocks.busyBlocks
      .filter(isBlocking)
      .map(parseEventRange)
      .filter(Boolean)
      .sort((a, b) => a.startMs - b.startMs)

    // Group members' stored busy blocks (always treated as blocking)
    // Exclude users deselected in trip filters
    const activeGroupBlocks = joinedGroupBusyBlocks.filter(
      (m) => !excludedUsers.has(m.userEmail),
    )
    const groupBlockingRanges = activeGroupBlocks.flatMap((member) =>
      (member.blocks || []).map(parseEventRange).filter(Boolean),
    )

    const allBlockingRanges = [...blockingRanges, ...groupBlockingRanges]

    const startOfToday = new Date(calendarWindow.start)

    const days = []
    for (let i = 0; i < calendarWindow.daysCount; i += 1) {
      const day = new Date(startOfToday)
      day.setDate(startOfToday.getDate() + i)

      const dayStartMs = new Date(day).getTime()
      const dayEnd = new Date(day)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const dayEndMs = dayEnd.getTime()

      const dayKey = getLocalDayKey(day)
      const weekday = day.toLocaleDateString('en-US', { weekday: 'short' })
      const dayLabel = day.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })

      const hasBusyEvent = allBlockingRanges.some(
        (range) => dayStartMs < range.endMs && dayEndMs > range.startMs,
      )

      const weekend = day.getDay() === 0 || day.getDay() === 6
      days.push({
        dayKey,
        monthKey: day.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        weekday,
        dayLabel,
        dayStartMs,
        dayEndMs,
        weekend,
        isFree: !hasBusyEvent,
        isCandidateStart: false,
        isPartOfCandidate: false,
        eventCount: 0,
        events: [],
        groupEvents: [],
        personInitials: [],
      })
    }

    const dayStats = new Map(
      days.map((day) => [
        day.dayKey,
        { count: 0, events: [], busyOwners: new Map() },
      ]),
    )

    // Process own events
    busyBlocks.busyBlocks.forEach((event) => {
      const range = parseEventRange(event)
      if (!range) return

      const participants = Array.isArray(event.participants) ? event.participants : []
      const personLabels = participants.map((p) => p.name || p.email).filter(Boolean)
      const blocking = isBlocking(event)
      const calMode = calendarModes[event.calendarId] ?? 'unavailable'

      days.forEach((day) => {
        if (day.dayStartMs < range.endMs && day.dayEndMs > range.startMs) {
          const stat = dayStats.get(day.dayKey)
          if (blocking) {
            stat.count += 1
            if (connectedUserInitial && user?.email) {
              stat.busyOwners.set(user.email, { initial: connectedUserInitial, isSelf: true })
            }
          }
          stat.events.push({
            id: event.id,
            calendarId: event.calendarId,
            calendarMode: calMode,
            title: event.title || 'Busy',
            start: event.start,
            end: event.end,
            people: personLabels,
            isBlocking: blocking,
            isOwn: true,
          })
        }
      })
    })

    // Process group members' events
    activeGroupBlocks.forEach((member) => {
      const ownerInitial = getInitials(member.userName || member.userEmail)
      ;(member.blocks || []).forEach((event) => {
        const range = parseEventRange(event)
        if (!range) return

        days.forEach((day) => {
          if (day.dayStartMs < range.endMs && day.dayEndMs > range.startMs) {
            const stat = dayStats.get(day.dayKey)
            if (!stat.busyOwners.has(member.userEmail)) {
              stat.busyOwners.set(member.userEmail, { initial: ownerInitial, isSelf: false })
            }
            stat.events.push({
              id: event.id || `${member.userEmail}-${event.title}-${event.start?.dateTime || event.start?.date}`,
              calendarId: event.calendarId || '',
              calendarMode: 'unavailable',
              title: event.title || 'Busy',
              start: event.start,
              end: event.end,
              people: [],
              isBlocking: true,
              isOwn: false,
              ownerName: member.userName || member.userEmail,
              ownerEmail: member.userEmail,
            })
          }
        })
      })
    })

    days.forEach((day) => {
      const stat = dayStats.get(day.dayKey)
      stat.events.sort((a, b) => {
        if (a.isBlocking !== b.isBlocking) {
          return a.isBlocking ? -1 : 1
        }
        return getEventStartMs(a) - getEventStartMs(b)
      })
      day.eventCount = stat.count + (stat.busyOwners.size - (stat.count > 0 ? 1 : 0))
      day.events = stat.events.filter((e) => e.isOwn)
      day.groupEvents = stat.events.filter((e) => !e.isOwn)
      day.personInitials = Array.from(stat.busyOwners.values())
    })

    const candidateStarts = new Set()
    const candidateDays = new Set()
    const candidates = []
    const maxStart = days.length - requiredDays

    for (let i = 0; i <= maxStart; i += 1) {
      const window = days.slice(i, i + requiredDays)
      const allFree = window.every((d) => d.isFree)
      const hasSaturday = window.some((d) => new Date(d.dayStartMs).getDay() === 6)
      const hasSunday = window.some((d) => new Date(d.dayStartMs).getDay() === 0)
      const startsOnSaturday = new Date(window[0].dayStartMs).getDay() === 6
      const endsOnSunday = new Date(window[window.length - 1].dayStartMs).getDay() === 0

      // Weekend mode is "anchored":
      // - 1 day: either Saturday or Sunday
      // - 2 days: must include at least one weekend day (Fri-Sat, Sat-Sun, Sun-Mon)
      // - 3+ days: must include both Sat and Sun and either start on Saturday or end on Sunday
      const meetsWeekendCriteria = includeWeekends
        ? requiredDays === 1
          ? hasSaturday || hasSunday
          : requiredDays === 2
            ? hasSaturday || hasSunday
            : hasSaturday && hasSunday && (startsOnSaturday || endsOnSunday)
        : true

      if (allFree && meetsWeekendCriteria) {
        const startDay = window[0]
        const endDay = window[window.length - 1]
        candidateStarts.add(startDay.dayKey)
        candidates.push({
          key: `${startDay.dayKey}-${endDay.dayKey}`,
          startLabel: `${startDay.weekday}, ${startDay.dayLabel}`,
          endLabel: `${endDay.weekday}, ${endDay.dayLabel}`,
        })
        // Mark all days in this window as part of a candidate
        window.forEach((day) => {
          candidateDays.add(day.dayKey)
        })
      }
    }

    days.forEach((day) => {
      day.isCandidateStart = candidateStarts.has(day.dayKey)
      day.isPartOfCandidate = candidateDays.has(day.dayKey)
    })

    const monthMap = new Map()
    days.forEach((day) => {
      if (!monthMap.has(day.monthKey)) {
        monthMap.set(day.monthKey, [])
      }
      monthMap.get(day.monthKey).push(day)
    })

    const months = Array.from(monthMap.entries()).map(([month, items]) => ({
      month,
      days: items,
    }))

    const dayLookup = new Map(days.map((day) => [day.dayKey, day]))

    return { months, candidates, dayLookup }
  }, [
    busyBlocks,
    joinedGroupBusyBlocks,
    calendarWindow,
    requiredDays,
    includeWeekends,
    calendarModes,
    eventOverrides,
    connectedUserInitial,
    user?.email,
  ])

  // All unique events from calendars in 'individual' mode, sorted soonest first
  const individualEvents = useMemo(() => {
    if (!busyBlocks?.busyBlocks) return []
    const seen = new Set()
    return busyBlocks.busyBlocks
      .filter((event) => {
        if (calendarModes[event.calendarId] !== 'individual') return false
        if (seen.has(event.id)) return false
        seen.add(event.id)
        return true
      })
      .sort((a, b) => getEventStartMs(a) - getEventStartMs(b))
  }, [busyBlocks, calendarModes])

  const individualEventGroups = useMemo(() => {
    const groupMap = new Map()
    individualEvents.forEach((event) => {
      const key = normalizeTitle(event.title)
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          normalizedTitle: key,
          displayTitle: event.title || 'Busy',
          events: [],
        })
      }
      groupMap.get(key).events.push(event)
    })
    return Array.from(groupMap.values())
  }, [individualEvents])

  const individualEventStats = useMemo(() => {
    let undecidedCount = 0
    let decidedCount = 0

    individualEvents.forEach((event) => {
      const decision = eventOverrides[event.id]
      if (decision === undefined) {
        undecidedCount += 1
      } else {
        decidedCount += 1
      }
    })

    return { undecidedCount, decidedCount }
  }, [individualEvents, eventOverrides])

  const visibleIndividualEventGroups = useMemo(() => {
    return individualEventGroups
      .map((group) => {
        const visibleEvents = showDecidedEvents
          ? group.events
          : group.events.filter((event) => eventOverrides[event.id] === undefined)

        const undecidedCount = group.events.filter(
          (event) => eventOverrides[event.id] === undefined,
        ).length

        return {
          ...group,
          visibleEvents,
          undecidedCount,
        }
      })
      .filter((group) => group.visibleEvents.length > 0)
  }, [individualEventGroups, eventOverrides, showDecidedEvents])

  // Load saved title decisions whenever busyBlocks is refreshed
  useEffect(() => {
    if (!busyBlocks || !user?.id) return
    async function fetchDecisions() {
      try {
        const res = await fetch(
          `${apiBase}/api/decisions?userId=${encodeURIComponent(user.id)}`,
        )
        const data = await res.json()
        setTitleDecisions(data.decisions || {})
      } catch (err) {
        console.error('Failed to load decisions:', err)
      }
    }
    void fetchDecisions()
  }, [busyBlocks, user?.id, apiBase])

  // Seed eventOverrides from saved title decisions
  useEffect(() => {
    if (!busyBlocks?.busyBlocks || !Object.keys(titleDecisions).length) return
    setEventOverrides((prev) => {
      const next = { ...prev }
      busyBlocks.busyBlocks.forEach((event) => {
        const key = normalizeTitle(event.title)
        if (titleDecisions[key] && next[event.id] === undefined) {
          next[event.id] = titleDecisions[key]
        }
      })
      return next
    })
  }, [titleDecisions, busyBlocks])

  return (
    <main className="page">
      <section className="hero">
        <div className="heroTopRow">
          <p className="eyebrow">Friends Calendar</p>
          <div className="heroActions">
            <button type="button" className="ghostBtn" onClick={copyShareLink}>
              Copy test link
            </button>
            <button
              type="button"
              className="ghostBtn"
              onClick={() => setShowSupportModal(true)}
            >
              Support
            </button>
          </div>
        </div>
        <h1>Plan group trips faster, with fewer chat loops</h1>
        <p className="lead">
          Connect calendars, decide which events can stay flexible, and instantly find
          realistic meetup windows your friends can actually attend.
        </p>
        {shareStatus && <p className="heroNotice">{shareStatus}</p>}

        <div className="heroImageGrid" aria-hidden="true">
          <img
            src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80"
            alt=""
            loading="lazy"
          />
          <img
            src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80"
            alt=""
            loading="lazy"
          />
          <img
            src="https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80"
            alt=""
            loading="lazy"
          />
        </div>

        <div className="heroStatusRow">
          <span className="statusPill">{health}</span>
          <span className="statusMeta">Live API: {apiBase}</span>
          <span className="statusMeta">Built for friend-group testing</span>
        </div>
      </section>

      <section className="card">
        <h2>Sign in and connect Google Calendar</h2>
        {!user && !googleClientId && (
          <p className="muted">
            Waiting for Google OAuth client ID from environment or backend config.
          </p>
        )}
        {!user && <div id="googleSignInButton" />}
        {serverMessage && <p className="muted">{serverMessage}</p>}

        {user && (
          <>
            <div className="userBox">
              <img src={user.picture} alt={user.name} />
              <div>
                <p>{user.name}</p>
                <p className="muted">{user.email}</p>
              </div>
            </div>

            {!accessToken && (
              <button
                className="btnPrimary"
                onClick={() => {
                  void connectCalendar()
                }}
                disabled={calendarLoading || isAutoConnecting}
              >
                {calendarLoading || isAutoConnecting
                  ? 'Connecting calendar...'
                  : 'Connect calendar'}
              </button>
            )}

            {accessToken && <p className="badge">Calendar connected</p>}
          </>
        )}

        {calendarError && <p className="error">{calendarError}</p>}
      </section>

      <section className="card groupRosterCard">
        <h2>Who&rsquo;s in the group</h2>
        <p className="muted">
          Everyone listed here has opted in and granted calendar access. When you join, they
          can see your availability — and you can see theirs.
        </p>

        {user && !hasJoined && (
          <button
            type="button"
            className="btnPrimary joinGroupBtn"
            onClick={() => void joinGroup()}
            disabled={joinLoading}
          >
            {joinLoading ? 'Joining…' : '👋 Join this group calendar'}
          </button>
        )}

        {user && hasJoined && (
          <p className="badge joinedBadge">You&rsquo;re in the group ✓</p>
        )}

        {members.length === 0 ? (
          <p className="muted rosterEmpty">No one has joined yet — you could be the first!</p>
        ) : (
          <ul className="rosterList">
            {members.map((m) => (
              <li key={m.email} className="rosterItem">
                {m.picture ? (
                  <img
                    src={m.picture}
                    alt={m.name || m.email}
                    className="rosterAvatar"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="rosterInitials">{getInitials(m.name || m.email)}</span>
                )}
                <div className="rosterInfo">
                  <span className="rosterName">{m.name || m.email}</span>
                  {m.name && <span className="rosterEmail">{m.email}</span>}
                </div>
                {user?.email === m.email && (
                  <span className="rosterYouBadge">You</span>
                )}
                {user?.email === m.email && (
                  <button
                    type="button"
                    className="leaveGroupBtn"
                    onClick={() => void leaveGroup()}
                    disabled={leaveLoading}
                  >
                    {leaveLoading ? 'Leaving…' : 'Leave group'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {calendars.length > 0 && (
        <section className="card">
          <h2>Calendar availability settings</h2>
          <details className="calendarSettingsDisclosure" open>
            <summary className="calendarSettingsSummary">
              Choose how each calendar contributes to your availability
            </summary>
            <p className="muted calendarSettingsHint">
              Keep this clean by default and only adjust modes when needed.
            </p>

            <div className="calendarModeList">
              {calendars.map((cal) => (
                <div key={cal.id} className="calendarModeRow">
                  <div className="calModeLabel">
                    <span className="calDot" style={{ background: cal.backgroundColor || '#94a3b8' }} />
                    <span className="calModeName">
                      {cal.primary ? 'Main — ' : ''}{cal.summary}
                    </span>
                  </div>
                  <div className="calModeButtons">
                    <button
                      type="button"
                      className={`calModeBtn ${calendarModes[cal.id] === 'free' ? 'calModeBtnActive calModeBtnFree' : ''}`}
                      onClick={() => setCalendarMode(cal.id, 'free')}
                    >
                      Show as free
                    </button>
                    <button
                      type="button"
                      className={`calModeBtn ${calendarModes[cal.id] === 'individual' ? 'calModeBtnActive calModeBtnIndividual' : ''}`}
                      onClick={() => setCalendarMode(cal.id, 'individual')}
                    >
                      Decide individually
                    </button>
                    <button
                      type="button"
                      className={`calModeBtn ${calendarModes[cal.id] === 'unavailable' ? 'calModeBtnActive calModeBtnUnavailable' : ''}`}
                      onClick={() => setCalendarMode(cal.id, 'unavailable')}
                    >
                      Show as unavailable
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </details>

          <p className="muted liveSyncNote">
            Calendar updates are applied live. No manual refresh needed.
          </p>
        </section>
      )}

      {individualEventGroups.length > 0 && (
        <section className="card">
          <h2>Decide individually</h2>
          <p className="muted">
            Similar recurring events are grouped together. Use{' '}
            <strong>Allow all</strong> / <strong>Block all</strong> to decide a whole series at
            once — your choices are saved for future visits.
          </p>
          <div className="section4Controls">
            <p className="muted section4Summary">
              {individualEventStats.undecidedCount} undecided, {individualEventStats.decidedCount}{' '}
              decided
            </p>
            <button
              type="button"
              className="toggleDecidedBtn"
              onClick={() => setShowDecidedEvents((prev) => !prev)}
            >
              {showDecidedEvents
                ? 'Hide decided events'
                : `Review decided events (${individualEventStats.decidedCount})`}
            </button>
          </div>

          {visibleIndividualEventGroups.length === 0 && (
            <p className="muted">All events are decided. Use review to inspect or change them.</p>
          )}

          <div className="individualEventGroups">
            {visibleIndividualEventGroups.map((group) => {
              const decisions = group.visibleEvents.map((e) => eventOverrides[e.id])
              const allFree = decisions.every((d) => d === 'free')
              const allBusy = decisions.every((d) => d === 'unavailable')
              const anyUndecided = decisions.some((d) => d === undefined)
              const groupState = allFree
                ? 'free'
                : allBusy
                  ? 'busy'
                  : anyUndecided
                    ? 'undecided'
                    : 'mixed'
              return (
                <div
                  key={group.normalizedTitle}
                  className={`eventGroup eventGroup--${groupState}`}
                >
                  <div className="eventGroupHeader">
                    <div className="eventGroupMeta">
                      <span className="eventGroupTitle">{group.displayTitle}</span>
                      <span className="eventGroupCount">
                        {group.visibleEvents.length} event
                        {group.visibleEvents.length !== 1 ? 's' : ''}
                      </span>
                      {group.undecidedCount > 0 && (
                        <span className="needsDecisionBadge">Needs decision</span>
                      )}
                    </div>
                    <div className="eventGroupActions">
                      <button
                        type="button"
                        className={`groupDecisionBtn ${allFree ? 'groupDecisionBtnFreeActive' : 'groupDecisionBtnFree'}`}
                        onClick={() =>
                          setGroupDecision(group.normalizedTitle, 'free', group.visibleEvents)
                        }
                      >
                        Allow all free
                      </button>
                      <button
                        type="button"
                        className={`groupDecisionBtn ${allBusy ? 'groupDecisionBtnBusyActive' : 'groupDecisionBtnBusy'}`}
                        onClick={() =>
                          setGroupDecision(group.normalizedTitle, 'unavailable', group.visibleEvents)
                        }
                      >
                        Block all
                      </button>
                    </div>
                  </div>
                  <ul className="eventGroupRows">
                    {group.visibleEvents.map((event, idx) => {
                      const override = eventOverrides[event.id]
                      const isFree = override === 'free'
                      const isUndecided = override === undefined
                      return (
                        <li key={event.id || idx} className="eventGroupRow">
                          <span className="eventGroupRowDate">
                            {formatEventDateRange(event)}
                          </span>
                          <div className="eventGroupRowToggles">
                            <button
                              type="button"
                              className={`overrideBtn overrideBtnSm ${isFree ? 'overrideBtnFreeActive' : 'overrideBtnFree'}`}
                              onClick={() => toggleEventOverride(event.id)}
                            >
                              Free
                            </button>
                            <button
                              type="button"
                              className={`overrideBtn overrideBtnSm ${!isFree && !isUndecided ? 'overrideBtnBusyActive' : 'overrideBtnBusy'}`}
                              onClick={() => toggleEventOverride(event.id)}
                            >
                              Busy
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {calendars.length > 0 && (
        <section className="card">
          <h2>Trip filters</h2>
          <p className="muted">These filters update day-by-day results immediately.</p>

          <div className="tripControls">
            <label htmlFor="requiredDays">Trip length (full days):</label>
            <select
              id="requiredDays"
              value={requiredDays}
              onChange={(e) => setRequiredDays(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} day{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="tripControls">
            <label htmlFor="includeWeekends">
              <input
                id="includeWeekends"
                type="checkbox"
                checked={includeWeekends}
                onChange={(e) => setIncludeWeekends(e.target.checked)}
              />
              Weekend anchored windows (Sat/Sun focused)
            </label>
          </div>
          {includeWeekends && (
            <>
              <p className="muted tripHint">
                {requiredDays === 1
                  ? '1 day: Saturday or Sunday only.'
                  : requiredDays === 2
                    ? '2 days: must include Saturday or Sunday (for example Fri-Sat, Sat-Sun, or Sun-Mon).'
                    : `${requiredDays} days: must include both Saturday and Sunday, and either end on Sunday or start on Saturday.`}
              </p>
              {joinedGroupBusyBlocks.length > 0 && (
                <div className="tripUserFilter">
                  <p className="tripUserFilterLabel">Include availability from:</p>
                  <div className="tripUserFilterList">
                    <label className="tripUserFilterItem">
                      <input
                        type="checkbox"
                        checked={true}
                        readOnly
                        disabled
                      />
                      <span>{user?.email || 'You'} (you)</span>
                    </label>
                    {joinedGroupBusyBlocks.map((m) => (
                      <label key={m.userEmail} className="tripUserFilterItem">
                        <input
                          type="checkbox"
                          checked={!excludedUsers.has(m.userEmail)}
                          onChange={(e) => {
                            setExcludedUsers((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.delete(m.userEmail)
                              else next.add(m.userEmail)
                              return next
                            })
                          }}
                        />
                        <span>{m.userEmail}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {busyBlocks && (
        <section className="card">
          <h2>Day-by-day availability (current + next 4 full months)</h2>
          <div className="calendarLegend">
            <h3>Legend</h3>
            <div className="legendGrid">
              <span className="legendItem">
                <span className="legendSwatch legendTrip" /> Trip candidate day
              </span>
              <span className="legendItem">
                <span className="legendSwatch legendWeekend" /> Weekend day
              </span>
              <span className="legendItem">
                <span className="legendSwatch legendBusy" /> Busy day
              </span>
              <span className="legendItem">
                <span className="legendDot" /> Fully free day
              </span>
              <span className="legendItem">
                <span className="legendBadge">AB</span> Person cannot join
              </span>
            </div>
          </div>

          <div className="availabilityLayout">
            <div className="calendarColumn">
              {availabilityData.months.map((monthGroup) => {
                // Align grid from the first visible day (important for a partial first month).
                const firstVisibleDay = parseLocalDayKey(monthGroup.days[0].dayKey)
                // Monday-first: Mon=0 … Sun=6
                const startingDayOfWeek = (firstVisibleDay.getDay() + 6) % 7

                // Create array with empty cells and days
                const gridDays = []
                for (let i = 0; i < startingDayOfWeek; i += 1) {
                  gridDays.push(null)
                }
                monthGroup.days.forEach((day) => {
                  gridDays.push(day)
                })

                return (
                  <div key={monthGroup.month} className="monthSection">
                    <h3>{monthGroup.month}</h3>
                    <div className="weekdayRow">
                      {WEEKDAY_LABELS.map((label) => (
                        <span key={label} className="weekdayCell">
                          {label}
                        </span>
                      ))}
                    </div>
                    <div className="daysGrid">
                      {gridDays.map((day, index) =>
                        day === null ? (
                          <div key={`empty-${index}`} className="dayCard isEmptyDay" />
                        ) : (
                          <article
                            key={day.dayKey}
                            className={`dayCard ${day.weekend ? 'isWeekend' : ''} ${
                              day.isFree ? 'isFreeDay' : 'isBusyDay'
                            } ${day.isPartOfCandidate ? 'isTripDay' : ''} ${
                              selectedDayKey === day.dayKey ? 'isSelectedDay' : ''
                            }`}
                            onClick={() => setSelectedDayKey(day.dayKey)}
                          >
                            <span className="dayTitle">{day.dayLabel.split(' ')[1]}</span>
                            {day.isFree && <div className="freeIndicator" />}
                            {day.eventCount > 0 && (
                              <>
                                <div className="dayPeopleRow">
                                  {day.personInitials.map(({ initial, isSelf }) => (
                                    <span
                                      key={`${day.dayKey}-${initial}`}
                                      className={`personInitialBadge${isSelf ? '' : ' personInitialBadgeOther'}`}
                                    >
                                      {initial}
                                    </span>
                                  ))}
                                </div>
                              </>
                            )}
                          </article>
                        ),
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <aside className="detailsColumn">
              <div className="dayDetailsPanel">
                {!selectedDayKey || !availabilityData.dayLookup.has(selectedDayKey) ? (
                  <>
                    <h3>Day details</h3>
                    <p className="muted">Select a day to inspect blockers.</p>
                  </>
                ) : (
                  <>
                    <h3>
                      {availabilityData.dayLookup.get(selectedDayKey).weekday},{' '}
                      {availabilityData.dayLookup.get(selectedDayKey).dayLabel}
                    </h3>
                    {availabilityData.dayLookup.get(selectedDayKey).events.length === 0 &&
                    availabilityData.dayLookup.get(selectedDayKey).groupEvents.length === 0 ? (
                      <p className="muted">Free day. No blockers.</p>
                    ) : (
                      <>
                        {availabilityData.dayLookup.get(selectedDayKey).events.length > 0 && (
                          <>
                            <p className="muted detailsSectionLabel">Your events — blocking events first.</p>
                            <ul className="dayDetailsList">
                            {availabilityData.dayLookup
                              .get(selectedDayKey)
                              .events.map((event, idx) => {
                                const isOverriddenFree = eventOverrides[event.id] === 'free'
                                const effectivelyFree =
                                  event.calendarMode === 'free' ||
                                  (event.calendarMode === 'individual' && isOverriddenFree)
                                return (
                                  <li
                                    key={`${selectedDayKey}-${event.id || idx}`}
                                    className={`dayDetailsItem ${effectivelyFree ? 'eventIsFree' : 'eventIsBlocking'}`}
                                  >
                                    <p className="dayDetailsTitle">{event.title}</p>
                                    <p className="muted">
                                      Person/email:{' '}
                                      {event.people.length > 0 ? event.people.join(', ') : 'Unknown'}
                                    </p>
                                    {event.calendarMode === 'free' && (
                                      <span className="eventModeTag eventModeTagFree">
                                        Calendar set to free
                                      </span>
                                    )}
                                    {event.calendarMode === 'unavailable' && (
                                      <span className="eventModeTag eventModeTagUnavailable">
                                        Calendar set to unavailable
                                      </span>
                                    )}
                                    {event.calendarMode === 'individual' && (
                                      <div className="eventOverrideRow">
                                        <button
                                          type="button"
                                          className={`overrideBtn ${effectivelyFree ? 'overrideBtnFreeActive' : 'overrideBtnFree'}`}
                                          onClick={() => toggleEventOverride(event.id)}
                                        >
                                          Allow as free
                                        </button>
                                        <button
                                          type="button"
                                          className={`overrideBtn ${!effectivelyFree ? 'overrideBtnBusyActive' : 'overrideBtnBusy'}`}
                                          onClick={() => toggleEventOverride(event.id)}
                                        >
                                          Keep unavailable
                                        </button>
                                      </div>
                                    )}
                                  </li>
                                )
                              })}
                            </ul>
                          </>
                        )}

                        {availabilityData.dayLookup.get(selectedDayKey).groupEvents.length > 0 && (
                          <>
                            <p className="muted detailsSectionLabel" style={{ marginTop: availabilityData.dayLookup.get(selectedDayKey).events.length > 0 ? '12px' : '0' }}>
                              Others&rsquo; events
                            </p>
                            <ul className="dayDetailsList">
                              {availabilityData.dayLookup
                                .get(selectedDayKey)
                                .groupEvents.map((event, idx) => (
                                  <li
                                    key={`${selectedDayKey}-group-${event.id || idx}`}
                                    className="dayDetailsItem eventIsBlocking"
                                  >
                                    <p className="dayDetailsTitle">{event.title}</p>
                                    <p className="muted">{event.ownerName}</p>
                                    <span className="eventModeTag eventModeTagUnavailable">
                                      Busy
                                    </span>
                                  </li>
                                ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </aside>
          </div>
        </section>
      )}
    </main>
  )
}

export default App
