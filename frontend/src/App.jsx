import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STORAGE_USER_KEY = 'friends-cal.user'
const STORAGE_TOKEN_KEY = 'friends-cal.token'
const STORAGE_ID_TOKEN_KEY = 'friends-cal.id-token'

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

function getDayKeysBetween(startKey, endKey) {
  if (!startKey || !endKey) return []

  const start = parseLocalDayKey(startKey)
  const end = parseLocalDayKey(endKey)
  const keys = []

  const cursor = new Date(start)
  while (cursor.getTime() <= end.getTime()) {
    keys.push(getLocalDayKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return keys
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

function isValidEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function App() {
  const apiBase = useMemo(
    () => import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080',
    [],
  )
  const [health, setHealth] = useState('Checking backend...')
  const [serverMessage, setServerMessage] = useState('')
  const [user, setUser] = useState(null)
  const [idToken, setIdToken] = useState(() => localStorage.getItem(STORAGE_ID_TOKEN_KEY) || '')
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
  const [proposalStartKey, setProposalStartKey] = useState('')
  const [proposalEndKey, setProposalEndKey] = useState('')
  const [showProposalModal, setShowProposalModal] = useState(false)
  const [proposalExtraRecipients, setProposalExtraRecipients] = useState('')
  const [proposalNotice, setProposalNotice] = useState('')
  const [titleDecisions, setTitleDecisions] = useState({})
  const [groupDecisionsByUserId, setGroupDecisionsByUserId] = useState({})
  const [showDecidedEvents, setShowDecidedEvents] = useState(false)
  const [calendarModesLoaded, setCalendarModesLoaded] = useState(false)
  const [isAutoConnecting, setIsAutoConnecting] = useState(false)
  const [showSupportModal, setShowSupportModal] = useState(false)
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticsResults, setDiagnosticsResults] = useState([])
  const [diagnosticsLastRunAt, setDiagnosticsLastRunAt] = useState('')
  const [showPlatformAdminModal, setShowPlatformAdminModal] = useState(false)
  const [privacyExitLoading, setPrivacyExitLoading] = useState(false)
  const [privacyExitNotice, setPrivacyExitNotice] = useState('')
  const [shareStatus, setShareStatus] = useState('')
  const [members, setMembers] = useState([])
  const [groupBusyBlocks, setGroupBusyBlocks] = useState([])
  const [groups, setGroups] = useState([])
  const [activeGroupId, setActiveGroupId] = useState('')
  const [groupEntryMode, setGroupEntryMode] = useState('create')
  const [groupNameInput, setGroupNameInput] = useState('')
  const [inviteCodeInput, setInviteCodeInput] = useState('')
  const [groupNotice, setGroupNotice] = useState('')
  const [groupActionLoading, setGroupActionLoading] = useState(false)
  const [platformAdminEmails, setPlatformAdminEmails] = useState(
    () => String(import.meta.env.VITE_PLATFORM_ADMIN_EMAILS || '')
      .split(',')
      .map((email) => String(email).trim().toLowerCase())
      .filter(Boolean),
  )
  const [platformAssignEmail, setPlatformAssignEmail] = useState('')
  const [platformAssignGroupId, setPlatformAssignGroupId] = useState('')
  const [platformAssignRole, setPlatformAssignRole] = useState('member')
  const [platformAssignNotice, setPlatformAssignNotice] = useState('')
  const [platformAssignLoading, setPlatformAssignLoading] = useState(false)
  const [platformGroupSearch, setPlatformGroupSearch] = useState('')
  const [platformSelectedGroupId, setPlatformSelectedGroupId] = useState('')
  const [allGroupsReview, setAllGroupsReview] = useState([])
  const [allGroupsReviewLoading, setAllGroupsReviewLoading] = useState(false)
  const [allGroupsReviewNotice, setAllGroupsReviewNotice] = useState('')
  const [deleteGroupLoading, setDeleteGroupLoading] = useState(false)
  const [joinLoading, setJoinLoading] = useState(false)
  const [excludedUsers, setExcludedUsers] = useState(new Set())
  const [leaveLoading, setLeaveLoading] = useState(false)
  const [memberActionLoadingId, setMemberActionLoadingId] = useState('')
  const [memberActionError, setMemberActionError] = useState('')
  const hasJoined = members.some((m) => m.userId === user?.id || m.email === user?.email)
  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) || null,
    [groups, activeGroupId],
  )
  const currentMember = useMemo(
    () => members.find((m) => m.userId === user?.id || m.email === user?.email) || null,
    [members, user?.id, user?.email],
  )
  const isCurrentUserAdmin = currentMember?.role === 'admin'
  const isPlatformAdmin = useMemo(() => {
    const email = String(user?.email || '').trim().toLowerCase()
    if (!email) return false
    return platformAdminEmails.includes(email)
  }, [platformAdminEmails, user?.email])
  const canDeleteActiveGroup = Boolean(activeGroupId) && (isCurrentUserAdmin || isPlatformAdmin)
  const filteredPlatformGroups = useMemo(() => {
    const query = platformGroupSearch.trim().toLowerCase()
    if (!query) return allGroupsReview
    return allGroupsReview.filter((group) => {
      const name = String(group.name || '').toLowerCase()
      const id = String(group.id || '').toLowerCase()
      return name.includes(query) || id.includes(query)
    })
  }, [allGroupsReview, platformGroupSearch])
  const selectedPlatformGroup = useMemo(
    () => allGroupsReview.find((group) => group.id === platformSelectedGroupId) || null,
    [allGroupsReview, platformSelectedGroupId],
  )
  const connectedUserInitial = useMemo(
    () => getInitials(user?.name || user?.email || ''),
    [user?.name, user?.email],
  )
  const onboardingSteps = useMemo(() => {
    const hasGroup = Boolean(activeGroupId)
    const hasCalendars = calendars.length > 0
    const hasBusyData = Boolean(busyBlocks)
    const hasIndividualChoices = Object.values(calendarModes).some((mode) => mode === 'individual')

    return [
      {
        id: 'signin',
        label: '1. Sign in',
        help: 'Connect your account safely.',
        done: Boolean(user),
      },
      {
        id: 'group',
        label: '2. Pick group',
        help: 'Create one or join with invite code.',
        done: Boolean(user) && hasGroup,
      },
      {
        id: 'calendar',
        label: '3. Calendar setup',
        help: 'Choose free / busy / individual per calendar.',
        done: Boolean(user) && hasCalendars,
      },
      {
        id: 'events',
        label: '4. Flexible events',
        help: 'Mark recurring events free or unavailable.',
        done: Boolean(user) && (!hasIndividualChoices || hasBusyData),
      },
      {
        id: 'plan',
        label: '5. Find best days',
        help: 'Use filters and click any day for details.',
        done: Boolean(user) && hasBusyData,
      },
    ]
  }, [activeGroupId, busyBlocks, calendarModes, calendars.length, user])
  const completedStepCount = onboardingSteps.filter((step) => step.done).length
  const calendarWindow = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)

    const end = new Date(start.getFullYear(), start.getMonth() + 5, 0)
    end.setHours(23, 59, 59, 999)

    const daysCount =
      Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1

    return { start, end, daysCount }
  }, [])
  const authHeaders = useCallback(
    (headers = {}) => {
      if (!idToken) return { ...headers }
      return {
        ...headers,
        Authorization: `Bearer ${idToken}`,
      }
    },
    [idToken],
  )

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
  const connectCalendar = useCallback((options = {}) => {
    const loginHint = String(options.loginHint || user?.email || '').trim()
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
      setCalendarLoading(true)

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true
          setCalendarLoading(false)
          const msg = callbackFired
            ? 'Google authentication callback error. Please try connecting calendar again.'
            : 'Google authentication timed out (90s). Allow popups for this site, complete Google consent, then try again.'
          setCalendarError(msg)
          console.error('Google auth timeout', { callbackFired, clientId })
          resolve(false)
        }
      }, 90000) // 90 second timeout for consent flows

      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/calendar.readonly',
          prompt: 'consent select_account',
          login_hint: loginHint || undefined,
          error_callback: (err) => {
            if (resolved) return
            resolved = true
            clearTimeout(timeoutId)
            setCalendarLoading(false)

            const reason = String(err?.type || '').toLowerCase()
            if (reason === 'popup_failed_to_open') {
              setCalendarError('Popup blocked by browser. Please allow popups for this site and try again.')
            } else if (reason === 'popup_closed') {
              setCalendarError('Google popup was closed before approval. Please try again and complete consent.')
            } else {
              setCalendarError('Google authentication could not start. Please try again.')
            }

            console.error('Google OAuth popup error:', err)
            resolve(false)
          },
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
  }, [apiBase, googleClientId, loadCalendarsForToken, user?.email])

  useEffect(() => {
    const rawUser = localStorage.getItem(STORAGE_USER_KEY)
    const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY)
    const savedIdToken = localStorage.getItem(STORAGE_ID_TOKEN_KEY)

    if (savedIdToken && !idToken) {
      setIdToken(savedIdToken)
    }

    if (rawUser) {
      try {
        const parsedUser = JSON.parse(rawUser)
        if (parsedUser?.id && !savedIdToken) {
          localStorage.removeItem(STORAGE_USER_KEY)
          setServerMessage('Please sign in again to continue securely.')
        } else if (parsedUser?.id && !user) {
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
  }, [accessToken, idToken, loadCalendarsForToken, user])

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
    async function loadRuntimeConfig() {
      try {
        const response = await fetch(`${apiBase}/api/config`)
        const data = await response.json()
        if (!googleClientId && data?.googleClientId) {
          setGoogleClientId(data.googleClientId)
        }
        if (Array.isArray(data?.platformAdminEmails)) {
          setPlatformAdminEmails(
            data.platformAdminEmails
              .map((email) => String(email || '').trim().toLowerCase())
              .filter(Boolean),
          )
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
            setIdToken(response.credential)
            localStorage.setItem(STORAGE_ID_TOKEN_KEY, response.credential)
            setServerMessage('Signed in. Connecting your calendar...')
            setIsAutoConnecting(true)

            const connected = await connectCalendar({
              loginHint: verifyData?.user?.email,
            })
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
          { headers: authHeaders() },
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
          headers: authHeaders({ 'Content-Type': 'application/json' }),
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

  const saveTitleDecision = useCallback(
    async (normalizedTitle, decision) => {
      if (!user?.id) return
      try {
        await fetch(`${apiBase}/api/decisions`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
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

  const setEventAvailability = useCallback((eventId, status, normalizedTitle = '') => {
    if (!eventId) return
    if (status !== 'free' && status !== 'unavailable') return
    setEventOverrides((prev) => ({
      ...prev,
      [eventId]: status,
    }))

    if (normalizedTitle) {
      void saveTitleDecision(normalizedTitle, status)
    }
  }, [saveTitleDecision])

  const toggleEventOverride = useCallback((eventId) => {
    setEventOverrides((prev) => ({
      ...prev,
      [eventId]: prev[eventId] === 'free' ? 'unavailable' : 'free',
    }))
  }, [])

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

  const runDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true)
    setDiagnosticsResults([])

    const checks = []
    const addCheck = (label, passed, detail, severity = 'error') => {
      checks.push({
        label,
        passed,
        detail,
        severity,
      })
    }

    const runCheck = async (label, fn, severity = 'error') => {
      try {
        const detail = await fn()
        addCheck(label, true, detail, severity)
      } catch (error) {
        addCheck(label, false, error.message || 'Check failed.', severity)
      }
    }

    await runCheck('API health endpoint', async () => {
      const response = await fetch(`${apiBase}/api/health`, {
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) {
        throw new Error(`Expected 200, got ${response.status}.`)
      }
      const data = await response.json()
      if (!data?.ok) {
        throw new Error('Health payload did not report ok=true.')
      }
      return `OK (${response.status})`
    })

    await runCheck('Protected route blocks anonymous access', async () => {
      const response = await fetch(
        `${apiBase}/api/groups?userId=${encodeURIComponent('diagnostics-user')}`,
        {
          signal: AbortSignal.timeout(8000),
        },
      )
      if (response.status !== 401) {
        throw new Error(`Expected 401, got ${response.status}.`)
      }
      return 'Unauthorized request correctly denied (401).'
    })

    await runCheck('Authenticated group read', async () => {
      if (!user?.id || !idToken) {
        return 'Skipped: sign in first to validate authenticated checks.'
      }

      const response = await fetch(
        `${apiBase}/api/groups?userId=${encodeURIComponent(user.id)}`,
        {
          headers: authHeaders(),
          signal: AbortSignal.timeout(8000),
        },
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Expected 200, got ${response.status}.`)
      }
      const data = await response.json()
      return `OK (${response.status}) · ${Array.isArray(data.groups) ? data.groups.length : 0} group(s)`
    }, 'warning')

    setDiagnosticsResults(checks)
    setDiagnosticsLastRunAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    setDiagnosticsLoading(false)
  }, [apiBase, authHeaders, idToken, user?.id])

  const resetLocalSession = useCallback(() => {
    localStorage.removeItem(STORAGE_USER_KEY)
    localStorage.removeItem(STORAGE_TOKEN_KEY)
    localStorage.removeItem(STORAGE_ID_TOKEN_KEY)
    setUser(null)
    setIdToken('')
    setAccessToken(null)
    setCalendars([])
    setCalendarModes({})
    setEventOverrides({})
    setBusyBlocks(null)
    setGroupBusyBlocks([])
    setMembers([])
    setGroups([])
    setActiveGroupId('')
    setSelectedDayKey(null)
    setProposalStartKey('')
    setProposalEndKey('')
    setShowProposalModal(false)
    setServerMessage('Your data was removed. Sign in again only if you want to reconnect.')
  }, [])

  const revokeGoogleCalendarAccess = useCallback(async (token) => {
    if (!token) return

    if (window.google?.accounts?.oauth2?.revoke) {
      await new Promise((resolve) => {
        window.google.accounts.oauth2.revoke(token, () => resolve())
      })
      return
    }

    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(token)}`,
      })
    } catch (_err) {
      // non-blocking; local session will still be cleared.
    }
  }, [])

  const runPrivacyExit = useCallback(async () => {
    if (!user?.id) return

    const accepted = window.confirm(
      'This will remove your records from groups and delete your saved calendar data for this app. Continue?',
    )
    if (!accepted) return

    setPrivacyExitLoading(true)
    setPrivacyExitNotice('')

    try {
      const response = await fetch(`${apiBase}/api/privacy/delete-user-data`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: user.id,
          userEmail: user.email,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Could not remove your records.')
      }

      await revokeGoogleCalendarAccess(accessToken)
      if (window.google?.accounts?.id?.disableAutoSelect) {
        window.google.accounts.id.disableAutoSelect()
      }

      resetLocalSession()
      setPrivacyExitNotice('Privacy exit complete. Your records were deleted and calendar access was revoked.')
    } catch (error) {
      setPrivacyExitNotice(error.message || 'Privacy exit failed. Please try again.')
    } finally {
      setPrivacyExitLoading(false)
    }
  }, [accessToken, apiBase, resetLocalSession, revokeGoogleCalendarAccess, user?.email, user?.id])

  useEffect(() => {
    if (!shareStatus) return
    const t = setTimeout(() => setShareStatus(''), 3200)
    return () => clearTimeout(t)
  }, [shareStatus])

  useEffect(() => {
    if (!privacyExitNotice) return
    const timeoutId = setTimeout(() => setPrivacyExitNotice(''), 4200)
    return () => clearTimeout(timeoutId)
  }, [privacyExitNotice])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setShowSupportModal(false)
        setShowDiagnosticsModal(false)
        setShowPlatformAdminModal(false)
        setShowProposalModal(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!proposalNotice) return
    const timeoutId = setTimeout(() => setProposalNotice(''), 2600)
    return () => clearTimeout(timeoutId)
  }, [proposalNotice])

  useEffect(() => {
    if (!showDiagnosticsModal || diagnosticsResults.length > 0 || diagnosticsLoading) return
    void runDiagnostics()
  }, [diagnosticsLoading, diagnosticsResults.length, runDiagnostics, showDiagnosticsModal])

  const refreshGroups = useCallback(async () => {
    if (!user?.id) {
      setGroups([])
      setActiveGroupId('')
      return []
    }

    try {
      const res = await fetch(`${apiBase}/api/groups?userId=${encodeURIComponent(user.id)}`, {
        headers: authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) return []

      const fetched = data.groups || []
      setGroups(fetched)
      setActiveGroupId((prev) => {
        if (prev && fetched.some((group) => group.id === prev)) return prev
        return fetched[0]?.id || ''
      })
      return fetched
    } catch (_err) {
      return []
    }
  }, [apiBase, authHeaders, user?.id])

  const refreshMembers = useCallback(async () => {
    if (!activeGroupId) {
      setMembers([])
      return
    }

    try {
      const res = await fetch(`${apiBase}/api/members?groupId=${encodeURIComponent(activeGroupId)}`, {
        headers: authHeaders(),
      })
      const data = await res.json()
      if (res.ok) {
        setMembers(data.members || [])
      }
    } catch (_err) {
      // non-blocking
    }
  }, [activeGroupId, apiBase, authHeaders])

  useEffect(() => {
    if (!user?.id) {
      setGroups([])
      setActiveGroupId('')
      setMembers([])
      return
    }
    void refreshGroups()
  }, [refreshGroups, user?.id])

  useEffect(() => {
    void refreshMembers()
  }, [refreshMembers])

  const createGroup = useCallback(async () => {
    if (!user?.id || !groupNameInput.trim()) return
    setGroupNotice('')
    setGroupActionLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/groups/create`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: user.id,
          userName: user.name,
          email: user.email,
          picture: user.picture,
          name: groupNameInput.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setGroupNotice(data.error || 'Could not create group.')
        return
      }

      setGroupNameInput('')
      const updated = await refreshGroups()
      if (data.group?.id) {
        setActiveGroupId(data.group.id)
      } else if (updated[0]?.id) {
        setActiveGroupId(updated[0].id)
      }
      setGroupNotice('Group created.')
    } catch (_err) {
      setGroupNotice('Could not create group right now.')
    } finally {
      setGroupActionLoading(false)
    }
  }, [apiBase, groupNameInput, refreshGroups, user?.email, user?.id, user?.name, user?.picture])

  const joinGroupByInvite = useCallback(async () => {
    if (!user?.id || !inviteCodeInput.trim()) return
    setGroupNotice('')
    setJoinLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/groups/join-by-invite`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture,
          inviteCode: inviteCodeInput.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setGroupNotice(data.error || 'Could not join group with invite code.')
        return
      }

      setInviteCodeInput('')
      await refreshGroups()
      if (data.groupId) setActiveGroupId(data.groupId)
      setGroupNotice('Joined group successfully.')
    } catch (_err) {
      setGroupNotice('Could not join group right now.')
    } finally {
      setJoinLoading(false)
    }
  }, [apiBase, inviteCodeInput, refreshGroups, user?.email, user?.id, user?.name, user?.picture])

  const regenerateInviteCode = useCallback(async () => {
    if (!user?.id || !activeGroupId) return
    setGroupActionLoading(true)
    setGroupNotice('')
    try {
      const res = await fetch(`${apiBase}/api/groups/invite`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          groupId: activeGroupId,
          actorUserId: user.id,
          regenerate: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setGroupNotice(data.error || 'Could not regenerate invite code.')
        return
      }
      await refreshGroups()
      setGroupNotice('Invite code regenerated.')
    } catch (_err) {
      setGroupNotice('Could not regenerate invite code right now.')
    } finally {
      setGroupActionLoading(false)
    }
  }, [activeGroupId, apiBase, refreshGroups, user?.id])

  const assignUserToGroup = useCallback(async () => {
    if (!isPlatformAdmin || !user?.email || !platformAssignEmail.trim()) return
    const targetGroupId = platformSelectedGroupId || platformAssignGroupId || activeGroupId
    if (!targetGroupId) {
      setPlatformAssignNotice('Select a target group first.')
      return
    }

    setPlatformAssignLoading(true)
    setPlatformAssignNotice('')
    try {
      const res = await fetch(`${apiBase}/api/platform/assign-user-group`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          actorEmail: user.email,
          targetEmail: platformAssignEmail.trim().toLowerCase(),
          groupId: targetGroupId,
          role: platformAssignRole,
          removeFromOtherGroups: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPlatformAssignNotice(data.error || 'Could not assign user to group.')
        return
      }

      setPlatformAssignEmail('')
      await refreshGroups()
      setActiveGroupId(targetGroupId)
      await refreshMembers()
      setPlatformAssignNotice('User assigned to group.')
    } catch (_err) {
      setPlatformAssignNotice('Could not assign user right now.')
    } finally {
      setPlatformAssignLoading(false)
    }
  }, [
    activeGroupId,
    apiBase,
    isPlatformAdmin,
    platformAssignEmail,
    platformAssignGroupId,
    platformSelectedGroupId,
    platformAssignRole,
    refreshGroups,
    refreshMembers,
    user?.email,
  ])

  const refreshAllGroupsReview = useCallback(async () => {
    if (!isPlatformAdmin || !user?.email) {
      setAllGroupsReview([])
      return
    }

    setAllGroupsReviewLoading(true)
    setAllGroupsReviewNotice('')
    try {
      const res = await fetch(
        `${apiBase}/api/platform/groups?actorEmail=${encodeURIComponent(user.email)}`,
        { headers: authHeaders() },
      )
      const data = await res.json()
      if (!res.ok) {
        setAllGroupsReviewNotice(data.error || 'Could not load groups review.')
        return
      }
      setAllGroupsReview(data.groups || [])
    } catch (_err) {
      setAllGroupsReviewNotice('Could not load groups review right now.')
    } finally {
      setAllGroupsReviewLoading(false)
    }
  }, [apiBase, isPlatformAdmin, user?.email])

  useEffect(() => {
    if (!isPlatformAdmin) {
      setAllGroupsReview([])
      return
    }
    void refreshAllGroupsReview()
  }, [isPlatformAdmin, refreshAllGroupsReview])

  useEffect(() => {
    setPlatformSelectedGroupId((prev) => {
      if (prev && allGroupsReview.some((group) => group.id === prev)) return prev
      return allGroupsReview[0]?.id || ''
    })
  }, [allGroupsReview])

  useEffect(() => {
    setPlatformAssignGroupId(platformSelectedGroupId)
  }, [platformSelectedGroupId])

  const deleteGroupById = useCallback(async (groupId) => {
    if (!groupId || !user?.id) return false

    setDeleteGroupLoading(true)
    setGroupNotice('')
    try {
      const res = await fetch(`${apiBase}/api/groups/delete`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          groupId,
          actorUserId: user.id,
          actorEmail: user.email,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setGroupNotice(data.error || 'Could not delete group.')
        return false
      }

      setGroupNotice('Group deleted.')
      await refreshGroups()
      await refreshMembers()
      if (isPlatformAdmin) {
        await refreshAllGroupsReview()
      }
      return true
    } catch (_err) {
      setGroupNotice('Could not delete group right now.')
      return false
    } finally {
      setDeleteGroupLoading(false)
    }
  }, [
    apiBase,
    isPlatformAdmin,
    refreshAllGroupsReview,
    refreshGroups,
    refreshMembers,
    user?.email,
    user?.id,
  ])

  const deleteActiveGroup = useCallback(async () => {
    if (!activeGroupId || !user?.id || !canDeleteActiveGroup) return
    await deleteGroupById(activeGroupId)
  }, [activeGroupId, canDeleteActiveGroup, deleteGroupById, user?.id])

  const leaveGroup = useCallback(async () => {
    if (!user || !activeGroupId) return
    setLeaveLoading(true)
    try {
      await fetch(`${apiBase}/api/members/leave`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ groupId: activeGroupId, userId: user.id }),
      })
      await refreshGroups()
      await refreshMembers()
    } catch (_err) {
      // non-blocking
    } finally {
      setLeaveLoading(false)
    }
  }, [activeGroupId, apiBase, refreshGroups, refreshMembers, user])

  const updateMemberRole = useCallback(
    async (targetUserId, role) => {
      if (!user?.id || !targetUserId || !activeGroupId) return

      const actionKey = `role-${targetUserId}`
      setMemberActionError('')
      setMemberActionLoadingId(actionKey)

      try {
        const res = await fetch(`${apiBase}/api/members/role`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            actorUserId: user.id,
            groupId: activeGroupId,
            targetUserId,
            role,
          }),
        })

        const data = await res.json()
        if (!res.ok) {
          setMemberActionError(data.error || 'Could not update role.')
          return
        }

        await refreshMembers()
      } catch (_err) {
        setMemberActionError('Could not update role right now.')
      } finally {
        setMemberActionLoadingId('')
      }
    },
    [activeGroupId, apiBase, refreshMembers, user?.id],
  )

  const removeGroupMember = useCallback(
    async (targetUserId) => {
      if (!user?.id || !targetUserId || !activeGroupId) return

      const actionKey = `remove-${targetUserId}`
      setMemberActionError('')
      setMemberActionLoadingId(actionKey)

      try {
        const res = await fetch(`${apiBase}/api/members/remove`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            actorUserId: user.id,
            groupId: activeGroupId,
            targetUserId,
          }),
        })

        const data = await res.json()
        if (!res.ok) {
          setMemberActionError(data.error || 'Could not remove member.')
          return
        }

        await refreshMembers()
      } catch (_err) {
        setMemberActionError('Could not remove member right now.')
      } finally {
        setMemberActionLoadingId('')
      }
    },
    [activeGroupId, apiBase, refreshMembers, user?.id],
  )

  const findBusyBlocks = useCallback(async () => {
    if (!accessToken || calendars.length === 0 || !activeGroupId) return
    setCalendarLoading(true)
    setBusyBlocks(null)
    setGroupBusyBlocks([])
    setSelectedDayKey(null)
    setProposalStartKey('')
    setProposalEndKey('')
    setShowProposalModal(false)
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
          `${apiBase}/api/calendar/group-busy-blocks?groupId=${encodeURIComponent(activeGroupId)}&excludeUserId=${encodeURIComponent(user?.id || '')}`,
          { headers: authHeaders() },
        )
        if (groupRes.ok) {
          const groupData = await groupRes.json()
          setGroupBusyBlocks(groupData.members || [])
        }
      } catch (_groupErr) {
        // non-blocking — we still show own data
      }

      // Fetch saved free/unavailable decisions for all members in active group.
      try {
        const decisionRes = await fetch(
          `${apiBase}/api/decisions/group?groupId=${encodeURIComponent(activeGroupId)}&requesterUserId=${encodeURIComponent(user?.id || '')}`,
          { headers: authHeaders() },
        )
        if (decisionRes.ok) {
          const decisionData = await decisionRes.json()
          setGroupDecisionsByUserId(decisionData.decisionsByUserId || {})
        } else {
          setGroupDecisionsByUserId({})
        }
      } catch (_decisionErr) {
        setGroupDecisionsByUserId({})
      }
    } catch (err) {
      setCalendarError(err.message)
    } finally {
      setCalendarLoading(false)
    }
  }, [apiBase, accessToken, calendars, tagInput, calendarWindow.daysCount, user?.id, user?.name, user?.email, activeGroupId])

  useEffect(() => {
    if (!accessToken || calendars.length === 0 || !activeGroupId) return
    void findBusyBlocks()
  }, [findBusyBlocks, accessToken, calendars.length, activeGroupId])

  const joinedGroupBusyBlocks = useMemo(() => {
    const memberByUserId = new Map(
      members
        .map((m) => [String(m.userId || '').trim(), m])
        .filter(([uid]) => Boolean(uid)),
    )
    const joinedUserIds = new Set(
      members
        .map((m) => String(m.userId || '').trim())
        .filter(Boolean),
    )
    const joinedEmails = new Set(
      members
        .map((m) => String(m.email || '').trim().toLowerCase())
        .filter(Boolean),
    )

    return groupBusyBlocks.filter((m) => {
      const memberUserId = String(m.userId || '').trim()
      if (memberUserId && joinedUserIds.has(memberUserId)) return true

      const memberEmail = String(m.userEmail || '').trim().toLowerCase()
      return Boolean(memberEmail) && joinedEmails.has(memberEmail)
    }).map((m) => {
      const profile = memberByUserId.get(String(m.userId || '').trim()) || {}
      return {
        ...m,
        userName: String(m.userName || profile.name || '').trim(),
        userEmail: String(m.userEmail || profile.email || '').trim().toLowerCase(),
      }
    })
  }, [groupBusyBlocks, members])

  const availabilityData = useMemo(() => {
    if (!busyBlocks?.busyBlocks) {
      return { months: [], candidates: [], dayLookup: new Map() }
    }

    // Determine if a given event effectively blocks the day
    const isBlocking = (event) => {
      const manual = eventOverrides[event.id]
      if (manual === 'free') return false
      if (manual === 'unavailable') return true

      const mode = calendarModes[event.calendarId] ?? 'unavailable'
      if (mode === 'free') return false
      if (mode === 'unavailable') return true
      // 'individual': check per-event override; default is blocking
      return true
    }

    // Own blocking events
    const blockingRanges = busyBlocks.busyBlocks
      .filter(isBlocking)
      .map(parseEventRange)
      .filter(Boolean)
      .sort((a, b) => a.startMs - b.startMs)

    // Group members' stored busy blocks
    // Exclude users deselected in trip filters
    const activeGroupBlocks = joinedGroupBusyBlocks.filter((m) => {
      const memberKey = String(m.userId || m.userEmail || '').trim().toLowerCase()
      if (!memberKey) return false
      return !excludedUsers.has(memberKey)
    })
    const groupBlockingRanges = activeGroupBlocks.flatMap((member) => {
      const memberDecisions = groupDecisionsByUserId[String(member.userId)] || {}
      return (member.blocks || [])
        .map((event) => {
          const range = parseEventRange(event)
          if (!range) return null
          const normalizedTitle = normalizeTitle(event.title)
          const decision = memberDecisions[normalizedTitle] === 'free' ? 'free' : 'unavailable'
          if (decision === 'free') return null
          return range
        })
        .filter(Boolean)
    })

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
      const participantEmails = participants
        .map((p) => String(p?.email || '').trim().toLowerCase())
        .filter(isValidEmail)
      const sourceEmail = participantEmails[0] || (isValidEmail(user?.email) ? String(user.email).toLowerCase() : '')
      const blocking = isBlocking(event)
      const calMode = calendarModes[event.calendarId] ?? 'unavailable'

      days.forEach((day) => {
        if (day.dayStartMs < range.endMs && day.dayEndMs > range.startMs) {
          const stat = dayStats.get(day.dayKey)
          if (blocking) {
            stat.count += 1
            if (connectedUserInitial && user?.email) {
              stat.busyOwners.set(String(user.id || user.email), {
                ownerKey: String(user.id || user.email),
                initial: connectedUserInitial,
                isSelf: true,
              })
            }
          }
          stat.events.push({
            id: event.id,
            calendarId: event.calendarId,
            calendarMode: calMode,
            title: event.title || 'Busy',
            start: event.start,
            end: event.end,
            people: participantEmails,
            sourceEmail,
            isBlocking: blocking,
            isOwn: true,
          })
        }
      })
    })

    // Process group members' events
    activeGroupBlocks.forEach((member) => {
      const ownerInitial = getInitials(member.userName || member.userEmail)
      const ownerKey = String(member.userId || member.userEmail || '').trim()
      const memberDecisions = groupDecisionsByUserId[String(member.userId)] || {}
      ;(member.blocks || []).forEach((event) => {
        const range = parseEventRange(event)
        if (!range) return

        const normalizedTitle = normalizeTitle(event.title)
        const decision = memberDecisions[normalizedTitle] === 'free' ? 'free' : 'unavailable'
        const isBlocking = decision !== 'free'

        days.forEach((day) => {
          if (day.dayStartMs < range.endMs && day.dayEndMs > range.startMs) {
            const stat = dayStats.get(day.dayKey)
            if (isBlocking && ownerKey && !stat.busyOwners.has(ownerKey)) {
              stat.busyOwners.set(ownerKey, {
                ownerKey,
                initial: ownerInitial,
                isSelf: false,
              })
            }
            stat.events.push({
              id: event.id || `${member.userEmail}-${event.title}-${event.start?.dateTime || event.start?.date}`,
              calendarId: event.calendarId || '',
              calendarMode: 'unavailable',
              title: event.title || 'Busy',
              start: event.start,
              end: event.end,
              people: [],
              isBlocking,
              isOwn: false,
              decision,
              ownerName: member.userName || member.userEmail,
              ownerEmail: isValidEmail(member.userEmail) ? String(member.userEmail).toLowerCase() : '',
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

      const ownerInitials = new Map()
      if (connectedUserInitial) {
        const hasOwnBlocking = stat.events.some((event) => event.isOwn && event.isBlocking)
        if (hasOwnBlocking) {
          const selfOwnerKey = `self:${String(user?.id || user?.email || 'self')}`
          ownerInitials.set(selfOwnerKey, {
            ownerKey: selfOwnerKey,
            initial: connectedUserInitial,
            isSelf: true,
          })
        }
      }
      stat.events
        .filter((event) => !event.isOwn && event.isBlocking)
        .forEach((event) => {
          const ownerLabel = String(event.ownerEmail || event.ownerName || '').trim().toLowerCase()
          if (!ownerLabel) return
          const ownerKey = `other:${ownerLabel}`
          if (ownerInitials.has(ownerKey)) return
          const initial = getInitials(event.ownerName || event.ownerEmail)
          if (!initial) return
          ownerInitials.set(ownerKey, {
            ownerKey,
            initial,
            isSelf: false,
          })
        })

      day.eventCount = stat.count + (stat.busyOwners.size - (stat.count > 0 ? 1 : 0))
      day.events = stat.events.filter((e) => e.isOwn)
      day.groupEvents = stat.events.filter((e) => !e.isOwn)
      day.personInitials = Array.from(ownerInitials.values())
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

      // Weekend mode is "weekend-focused":
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
    groupDecisionsByUserId,
    excludedUsers,
    calendarWindow,
    requiredDays,
    includeWeekends,
    calendarModes,
    eventOverrides,
    connectedUserInitial,
    user?.id,
    user?.email,
  ])

  const selectedDay = useMemo(() => {
    if (!selectedDayKey) return null
    return availabilityData.dayLookup.get(selectedDayKey) || null
  }, [availabilityData.dayLookup, selectedDayKey])

  const selectedDayGroupedAppointments = useMemo(() => {
    if (!selectedDay) return []

    const ownEmail = isValidEmail(user?.email) ? String(user.email).toLowerCase() : ''
    const ownRows = selectedDay.events.map((event) => ({
      email: ownEmail,
      subject: event.title || 'Busy',
      eventId: event.id,
      isOther: false,
    }))

    const otherRows = selectedDay.groupEvents
      .map((event) => ({
        email: isValidEmail(event.ownerEmail) ? String(event.ownerEmail).toLowerCase() : '',
        subject: 'Busy event',
        decision: event.decision === 'free' ? 'free' : 'unavailable',
        isOther: true,
      }))
      .filter((row) => isValidEmail(row.email))

    const grouped = new Map()

    ;[...ownRows, ...otherRows].forEach((row) => {
      if (!grouped.has(row.email)) {
        grouped.set(row.email, {
          email: row.email,
          isOther: row.isOther,
          events: [],
          freeCount: 0,
          unavailableCount: 0,
        })
      }
      const bucket = grouped.get(row.email)
      if (row.isOther) {
        if (row.decision === 'free') {
          bucket.freeCount += 1
        } else {
          bucket.unavailableCount += 1
        }
      } else {
        bucket.events.push({
          eventId: row.eventId,
          subject: row.subject,
          decision: eventOverrides[row.eventId] === 'free' ? 'free' : 'unavailable',
        })
      }
    })

    return Array.from(grouped.values()).sort((a, b) => {
      if (a.isOther !== b.isOther) return a.isOther ? 1 : -1
      return a.email.localeCompare(b.email)
    })
  }, [selectedDay, user?.email, eventOverrides])

  const selectedDayOwnGroup = useMemo(
    () => selectedDayGroupedAppointments.find((group) => !group.isOther) || null,
    [selectedDayGroupedAppointments],
  )
  const selectedDayOtherGroups = useMemo(
    () => selectedDayGroupedAppointments.filter((group) => group.isOther),
    [selectedDayGroupedAppointments],
  )
  const proposalRangeReady = Boolean(proposalStartKey && proposalEndKey)
  const proposalRangeSummary = useMemo(() => {
    if (!proposalStartKey) return null

    const start = parseLocalDayKey(proposalStartKey)
    const end = parseLocalDayKey(proposalEndKey || proposalStartKey)
    const startLabel = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const endLabel = end.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

    return {
      startLabel,
      endLabel,
      label: proposalStartKey && proposalEndKey
        ? `${startLabel} - ${endLabel}`
        : `${startLabel} (start selected)`,
    }
  }, [proposalEndKey, proposalStartKey])
  const proposalAvailabilitySummary = useMemo(() => {
    if (!proposalRangeReady) return null
    const keys = getDayKeysBetween(proposalStartKey, proposalEndKey)
    const days = keys
      .map((key) => availabilityData.dayLookup.get(key))
      .filter(Boolean)

    const availableDays = days.filter((day) => day.isFree).length
    const blockedDays = days.length - availableDays

    const dayLines = days.map((day) => `- ${day.weekday}, ${day.dayLabel}: ${day.isFree ? 'Available' : 'Busy'}`)

    return {
      keys,
      days,
      availableDays,
      blockedDays,
      isFullyAvailable: blockedDays === 0,
      dayLines,
    }
  }, [availabilityData.dayLookup, proposalEndKey, proposalRangeReady, proposalStartKey])
  const groupRecipientEmails = useMemo(() => {
    return Array.from(
      new Set(
        members
          .map((member) => String(member.email || '').trim().toLowerCase())
          .filter(isValidEmail),
      ),
    )
  }, [members])
  const proposalEmailPreview = useMemo(() => {
    if (!proposalRangeSummary || !proposalAvailabilitySummary) {
      return { to: [], subject: '', body: '' }
    }

    const extraRecipients = proposalExtraRecipients
      .split(/[;,\n]/)
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(isValidEmail)

    const to = Array.from(new Set([...groupRecipientEmails, ...extraRecipients]))
    const subject = `Trip proposal: ${proposalRangeSummary.startLabel} - ${proposalRangeSummary.endLabel}`
    const body = [
      'Hello all,',
      '',
      `I would like to propose a trip for ${proposalRangeSummary.startLabel} to ${proposalRangeSummary.endLabel}.`,
      `Group: ${activeGroup?.name || 'Current group'}`,
      '',
      `Availability summary: ${proposalAvailabilitySummary.availableDays} available day(s), ${proposalAvailabilitySummary.blockedDays} busy day(s).`,
      proposalAvailabilitySummary.isFullyAvailable
        ? 'These selected dates are fully available for the current filters.'
        : 'Some selected days are busy based on current filters.',
      '',
      'Detailed period check:',
      ...proposalAvailabilitySummary.dayLines,
      '',
      'Please reply with your confirmation or alternatives.',
    ].join('\n')

    return { to, subject, body }
  }, [
    activeGroup?.name,
    groupRecipientEmails,
    proposalAvailabilitySummary,
    proposalExtraRecipients,
    proposalRangeSummary,
  ])

  const handleDayCardSelect = useCallback((dayKey) => {
    setSelectedDayKey(dayKey)

    if (!proposalStartKey || proposalEndKey) {
      setProposalStartKey(dayKey)
      setProposalEndKey('')
      return
    }

    if (dayKey < proposalStartKey) {
      setProposalEndKey(proposalStartKey)
      setProposalStartKey(dayKey)
      return
    }

    setProposalEndKey(dayKey)
  }, [proposalEndKey, proposalStartKey])

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
          { headers: authHeaders() },
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
            <button
              type="button"
              className="ghostBtn"
              onClick={() => setShowDiagnosticsModal(true)}
            >
              Diagnostics
            </button>
            {isPlatformAdmin && (
              <button
                type="button"
                className="ghostBtn adminEntryBtn"
                onClick={() => setShowPlatformAdminModal(true)}
              >
                Admin
              </button>
            )}
          </div>
        </div>
        <h1>Plan group trips faster, with fewer chat loops</h1>
        <p className="lead">
          A simple 5-step flow: sign in, choose your group, set calendar rules,
          mark flexible events, and pick days that work for everyone.
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

      <section className="card quickFlowCard">
        <div className="quickFlowHeader">
          <h2>Your setup progress</h2>
          <span className="badge">{completedStepCount}/{onboardingSteps.length} steps done</span>
        </div>
        <p className="muted quickFlowIntro">
          Follow these steps in order. You can always come back and change anything later.
        </p>
        <div className="quickFlowSteps" role="list" aria-label="Setup steps">
          {onboardingSteps.map((step) => (
            <article
              key={step.id}
              role="listitem"
              className={`quickFlowStep ${step.done ? 'quickFlowStepDone' : ''}`}
            >
              <p className="quickFlowStepLabel">{step.label}</p>
              <p className="quickFlowStepHelp">{step.help}</p>
              <span className={`quickFlowStepState ${step.done ? 'quickFlowStepStateDone' : ''}`}>
                {step.done ? 'Done' : 'Pending'}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>1) Sign in and connect Google Calendar</h2>
        <p className="muted sectionIntro">Start here. This unlocks all next steps.</p>
        {!user && (
          <div className="privacyNotice" role="note" aria-label="Permission and privacy notice">
            <p>
              This app helps groups find shared free windows for trips and meetups by comparing
              availability across members.
            </p>
            <p>
              Before signing in, please review what permission means: calendar read access lets
              the app read your appointment data, including event titles, times, and dates across
              your calendars, so it can calculate when you are busy.
            </p>
            <ul>
              <li>Your events are used to compute busy/free windows for planning.</li>
              <li>People in your joined group may see availability and blocking events for trip matching.</li>
              <li>Do not connect accounts containing sensitive calendars unless you are comfortable sharing this data for group planning.</li>
            </ul>
          </div>
        )}
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

            <div className="privacyExitRow">
              <p className="muted privacyExitText">
                Privacy exit: delete your records and disconnect this app from your calendar access.
              </p>
              <button
                type="button"
                className="privacyExitBtn"
                onClick={() => void runPrivacyExit()}
                disabled={privacyExitLoading}
              >
                {privacyExitLoading ? 'Removing your data...' : 'Delete my records and disconnect'}
              </button>
              {privacyExitNotice && <p className="muted groupNotice">{privacyExitNotice}</p>}
            </div>
          </>
        )}

        {calendarError && <p className="error">{calendarError}</p>}
      </section>

      {user && (
        <section className="card groupRosterCard">
          <h2>2) Choose your group</h2>
          <p className="muted">
            Create a private group or join with an invite code. Data is shared only inside your active group.
          </p>

          <div className="groupCompactActions">
            <div className="groupActionSwitch" role="tablist" aria-label="Group action mode">
              <button
                type="button"
                role="tab"
                aria-selected={groupEntryMode === 'create'}
                className={`groupModeBtn ${groupEntryMode === 'create' ? 'groupModeBtnActive' : ''}`}
                onClick={() => setGroupEntryMode('create')}
              >
                Create group
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={groupEntryMode === 'join'}
                className={`groupModeBtn ${groupEntryMode === 'join' ? 'groupModeBtnActive' : ''}`}
                onClick={() => setGroupEntryMode('join')}
              >
                Join by invite
              </button>
            </div>

            <div className="groupInlineForm groupInlineFormCompact">
              {groupEntryMode === 'create' ? (
                <>
                  <input
                    type="text"
                    value={groupNameInput}
                    onChange={(e) => setGroupNameInput(e.target.value)}
                    placeholder="New group name"
                    maxLength={64}
                  />
                  <button
                    type="button"
                    className="roleActionBtn"
                    onClick={() => void createGroup()}
                    disabled={groupActionLoading || !groupNameInput.trim()}
                  >
                    {groupActionLoading ? 'Creating...' : 'Create'}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={inviteCodeInput}
                    onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                    placeholder="Paste invite code"
                    maxLength={12}
                  />
                  <button
                    type="button"
                    className="roleActionBtn"
                    onClick={() => void joinGroupByInvite()}
                    disabled={joinLoading || !inviteCodeInput.trim()}
                  >
                    {joinLoading ? 'Joining...' : 'Join'}
                  </button>
                </>
              )}
            </div>
          </div>

          {groupNotice && <p className="muted groupNotice">{groupNotice}</p>}

          {groups.length > 0 && (
            <div className="groupTopRow">
              <div className="groupSummaryPanel">
                <div className="groupPickerRow groupPickerDense">
                  <label htmlFor="activeGroup">Active group</label>
                  <select
                    id="activeGroup"
                    value={activeGroupId}
                    onChange={(e) => setActiveGroupId(e.target.value)}
                  >
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name} ({group.memberCount})
                      </option>
                    ))}
                  </select>
                  {canDeleteActiveGroup && (
                    <button
                      type="button"
                      className="removeMemberBtn"
                      onClick={() => void deleteActiveGroup()}
                      disabled={deleteGroupLoading}
                    >
                      {deleteGroupLoading ? 'Deleting...' : 'Delete group'}
                    </button>
                  )}
                </div>

                <div className="groupFactsRow">
                  <span className="groupFactPill">Role: {activeGroup?.role === 'admin' ? 'Admin' : 'Member'}</span>
                  <span className="groupFactPill">Members: {activeGroup?.memberCount || 0}</span>
                  {activeGroup?.inviteCode && isCurrentUserAdmin && (
                    <span className="groupFactPill groupFactPillInvite">Invite: {activeGroup.inviteCode}</span>
                  )}
                  {activeGroup?.inviteCode && isCurrentUserAdmin && (
                    <button
                      type="button"
                      className="roleActionBtn"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(activeGroup.inviteCode)
                          .then(() => setGroupNotice('Invite code copied.'))
                          .catch(() => setGroupNotice('Could not copy invite code automatically.'))
                      }}
                    >
                      Copy invite
                    </button>
                  )}
                  {activeGroup?.inviteCode && isCurrentUserAdmin && (
                    <button
                      type="button"
                      className="roleActionBtn"
                      onClick={() => void regenerateInviteCode()}
                      disabled={groupActionLoading}
                    >
                      {groupActionLoading ? 'Updating...' : 'Regenerate code'}
                    </button>
                  )}
                </div>
              </div>

              {activeGroup && (
                <aside className="groupMembersSide">
                  <div className="groupMembersSideHeader">
                    <h3 className="groupRosterHeading">Who&apos;s in this group</h3>
                    {hasJoined && (
                      <p className="badge joinedBadge">You&rsquo;re in this group ✓</p>
                    )}
                  </div>
                  <p className="muted groupRosterHint">
                    Members can compare availability inside this group only.
                  </p>
                  {hasJoined && (
                    <p className="muted roleHelpText">
                      {isCurrentUserAdmin
                        ? 'You are an admin. You can grant elevated permissions and remove members.'
                        : 'Only admins can grant elevated permissions or remove members.'}
                    </p>
                  )}

                  {members.length === 0 ? (
                    <p className="muted rosterEmpty">No one has joined yet - you could be the first!</p>
                  ) : (
                    <ul className="rosterList rosterListCompact">
                      {members.map((m) => (
                        <li key={m.userId || m.email} className="rosterItem">
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
                          <span className={`rolePill ${m.role === 'admin' ? 'rolePillAdmin' : 'rolePillMember'}`}>
                            {m.role === 'admin' ? 'Admin' : 'Member'}
                          </span>
                          {user?.id === m.userId && (
                            <span className="rosterYouBadge">You</span>
                          )}
                          {user?.id === m.userId && (
                            <button
                              type="button"
                              className="leaveGroupBtn"
                              onClick={() => void leaveGroup()}
                              disabled={leaveLoading}
                            >
                              {leaveLoading ? 'Leaving...' : 'Leave group'}
                            </button>
                          )}
                          {isCurrentUserAdmin && user?.id !== m.userId && (
                            <div className="rosterAdminActions">
                              <button
                                type="button"
                                className="roleActionBtn"
                                onClick={() => void updateMemberRole(m.userId, m.role === 'admin' ? 'member' : 'admin')}
                                disabled={memberActionLoadingId === `role-${m.userId}` || !m.userId}
                              >
                                {memberActionLoadingId === `role-${m.userId}`
                                  ? 'Saving...'
                                  : m.role === 'admin'
                                    ? 'Revoke admin'
                                    : 'Grant admin'}
                              </button>
                              <button
                                type="button"
                                className="removeMemberBtn"
                                onClick={() => void removeGroupMember(m.userId)}
                                disabled={memberActionLoadingId === `remove-${m.userId}` || !m.userId}
                              >
                                {memberActionLoadingId === `remove-${m.userId}` ? 'Removing...' : 'Remove'}
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </aside>
              )}
            </div>
          )}

          {!activeGroup && (
            <p className="muted rosterEmpty">Create a group or join with an invite code to begin.</p>
          )}
          {memberActionError && <p className="error">{memberActionError}</p>}
        </section>
      )}

      {showPlatformAdminModal && isPlatformAdmin && (
        <div className="modalBackdrop" onClick={() => setShowPlatformAdminModal(false)}>
          <div className="supportModal adminModal" onClick={(e) => e.stopPropagation()}>
            <div className="supportModalHeader">
              <h3>Platform Admin Console</h3>
              <button type="button" className="ghostBtn" onClick={() => setShowPlatformAdminModal(false)}>
                Close
              </button>
            </div>

            <div className="platformReviewHeader">
              <p className="groupSetupTitle">Find and manage groups</p>
              <button
                type="button"
                className="roleActionBtn"
                onClick={() => void refreshAllGroupsReview()}
                disabled={allGroupsReviewLoading}
              >
                {allGroupsReviewLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            <div className="platformSearchRow">
              <input
                type="text"
                placeholder="Search group by name or id"
                value={platformGroupSearch}
                onChange={(e) => setPlatformGroupSearch(e.target.value)}
              />
              <select
                value={platformSelectedGroupId}
                onChange={(e) => {
                  setPlatformSelectedGroupId(e.target.value)
                  setPlatformAssignGroupId(e.target.value)
                }}
                disabled={filteredPlatformGroups.length === 0}
              >
                {filteredPlatformGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} ({group.memberCount})
                  </option>
                ))}
              </select>
            </div>

            {selectedPlatformGroup && (
              <div className="platformSelectedGroupCard">
                <p className="platformGroupName">{selectedPlatformGroup.name}</p>
                <p className="muted">
                  ID: {selectedPlatformGroup.id} · Members: {selectedPlatformGroup.memberCount}
                </p>
                <p className="muted">Admins: {(selectedPlatformGroup.admins || []).join(', ') || 'None'}</p>
                <div className="platformGroupActions">
                  <button
                    type="button"
                    className="roleActionBtn"
                    onClick={() => {
                      setActiveGroupId(selectedPlatformGroup.id)
                      setShowPlatformAdminModal(false)
                    }}
                  >
                    Open in main view
                  </button>
                  <button
                    type="button"
                    className="removeMemberBtn"
                    onClick={() => void deleteGroupById(selectedPlatformGroup.id)}
                    disabled={deleteGroupLoading}
                  >
                    {deleteGroupLoading ? 'Deleting...' : 'Delete this group'}
                  </button>
                </div>
              </div>
            )}

            <div className="platformAdminGrid">
              <input
                type="email"
                placeholder="User email"
                value={platformAssignEmail}
                onChange={(e) => setPlatformAssignEmail(e.target.value)}
              />
              <select
                value={platformAssignRole}
                onChange={(e) => setPlatformAssignRole(e.target.value)}
                disabled={!selectedPlatformGroup}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="button"
                className="roleActionBtn"
                onClick={() => void assignUserToGroup()}
                disabled={platformAssignLoading || !platformAssignEmail.trim() || !selectedPlatformGroup}
              >
                {platformAssignLoading ? 'Assigning...' : 'Assign to selected group'}
              </button>
            </div>

            {groupNotice && <p className="muted groupNotice">{groupNotice}</p>}
            {allGroupsReviewNotice && <p className="muted groupNotice">{allGroupsReviewNotice}</p>}
            {platformAssignNotice && <p className="muted groupNotice">{platformAssignNotice}</p>}
            {allGroupsReview.length === 0 && (
              <p className="muted groupNotice">No groups available yet.</p>
            )}
          </div>
        </div>
      )}

      {showSupportModal && (
        <div className="modalBackdrop" onClick={() => setShowSupportModal(false)}>
          <div className="supportModal" onClick={(e) => e.stopPropagation()}>
            <div className="supportModalHeader">
              <h3>Support</h3>
              <button type="button" className="ghostBtn" onClick={() => setShowSupportModal(false)}>
                Close
              </button>
            </div>

            <ul className="supportList">
              <li>If backend is disconnected, start backend at port 8080 and refresh this page.</li>
              <li>If sign-in fails, confirm Google client ID is set in frontend and backend .env files.</li>
              <li>If you changed account permissions, sign out and sign in again to refresh your session token.</li>
              <li>Use Diagnostics to quickly verify health and route protection before team testing.</li>
            </ul>
          </div>
        </div>
      )}

      {showDiagnosticsModal && (
        <div className="modalBackdrop" onClick={() => setShowDiagnosticsModal(false)}>
          <div className="supportModal diagnosticsModal" onClick={(e) => e.stopPropagation()}>
            <div className="supportModalHeader">
              <h3>Quick diagnostics</h3>
              <button type="button" className="ghostBtn" onClick={() => setShowDiagnosticsModal(false)}>
                Close
              </button>
            </div>

            <p className="muted diagnosticsIntro">
              Use this before multi-user tests to confirm backend health and auth protection.
            </p>

            <div className="diagnosticsActions">
              <button
                type="button"
                className="roleActionBtn"
                onClick={() => void runDiagnostics()}
                disabled={diagnosticsLoading}
              >
                {diagnosticsLoading ? 'Running checks...' : 'Run checks again'}
              </button>
              {diagnosticsLastRunAt && (
                <span className="muted diagnosticsTimestamp">Last run: {diagnosticsLastRunAt}</span>
              )}
            </div>

            <ul className="diagnosticsList" aria-live="polite">
              {diagnosticsResults.map((result) => {
                const statusClass = result.passed
                  ? 'diagnosticsStatusPass'
                  : result.severity === 'warning'
                    ? 'diagnosticsStatusWarn'
                    : 'diagnosticsStatusFail'

                return (
                  <li key={result.label} className="diagnosticsItem">
                    <div className="diagnosticsItemTop">
                      <span className="diagnosticsLabel">{result.label}</span>
                      <span className={`diagnosticsStatus ${statusClass}`}>
                        {result.passed ? 'Pass' : result.severity === 'warning' ? 'Warning' : 'Fail'}
                      </span>
                    </div>
                    <p className="diagnosticsDetail">{result.detail}</p>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}

      {showProposalModal && (
        <div className="modalBackdrop" onClick={() => setShowProposalModal(false)}>
          <div className="supportModal proposalModal" onClick={(e) => e.stopPropagation()}>
            <div className="supportModalHeader">
              <h3>Trip proposal email (simulation)</h3>
              <button type="button" className="ghostBtn" onClick={() => setShowProposalModal(false)}>
                Close
              </button>
            </div>

            <p className="muted proposalMetaLine">
              Selected period: {proposalRangeSummary?.startLabel} - {proposalRangeSummary?.endLabel}
            </p>
            <p className="muted proposalMetaLine">
              Availability in selected period: {proposalAvailabilitySummary?.availableDays || 0} available day(s), {proposalAvailabilitySummary?.blockedDays || 0} busy day(s)
            </p>

            <label className="proposalFieldLabel" htmlFor="proposalExtraRecipients">
              Additional selected recipients (optional, comma-separated)
            </label>
            <input
              id="proposalExtraRecipients"
              className="proposalInput"
              type="text"
              value={proposalExtraRecipients}
              onChange={(e) => setProposalExtraRecipients(e.target.value)}
              placeholder="friend@example.com, another@example.com"
            />

            <label className="proposalFieldLabel" htmlFor="proposalRecipients">
              Recipients (all group users + selected users)
            </label>
            <textarea
              id="proposalRecipients"
              className="proposalTextarea"
              rows={3}
              readOnly
              value={proposalEmailPreview.to.join(', ')}
            />

            <label className="proposalFieldLabel" htmlFor="proposalSubject">
              Subject
            </label>
            <input
              id="proposalSubject"
              className="proposalInput"
              type="text"
              readOnly
              value={proposalEmailPreview.subject}
            />

            <label className="proposalFieldLabel" htmlFor="proposalBody">
              Body
            </label>
            <textarea
              id="proposalBody"
              className="proposalTextarea"
              rows={14}
              readOnly
              value={proposalEmailPreview.body}
            />

            <div className="proposalActionsRow">
              <button
                type="button"
                className="roleActionBtn"
                onClick={() => {
                  const emailPayload = `To: ${proposalEmailPreview.to.join(', ')}\nSubject: ${proposalEmailPreview.subject}\n\n${proposalEmailPreview.body}`
                  void navigator.clipboard
                    .writeText(emailPayload)
                    .then(() => setProposalNotice('Proposal copied to clipboard.'))
                    .catch(() => setProposalNotice('Could not copy proposal automatically.'))
                }}
              >
                Copy proposal
              </button>
              <button
                type="button"
                className="btnPrimary proposalSendBtn"
                onClick={() => setProposalNotice('Email simulation created. Share this message manually.')}
              >
                Simulate send
              </button>
            </div>

            {proposalNotice && <p className="muted groupNotice">{proposalNotice}</p>}
          </div>
        </div>
      )}

      {user && (
        <section className="card">
          <h2>3) Calendar availability settings</h2>
          <p className="muted sectionIntro">
            Keep this simple: set each calendar as unavailable by default, then refine only when needed.
          </p>
          {calendars.length === 0 ? (
            <>
              <p className="muted">
                Calendar list has not loaded yet. Connect your calendar, then refresh availability.
              </p>
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
            </>
          ) : (
            <>
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
            </>
          )}
        </section>
      )}

      {individualEventGroups.length > 0 && (
        <section className="card">
          <h2>4) Decide flexible events</h2>
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

      {user && (
        <section className="card">
          <h2>5) Trip filters</h2>
          {calendars.length === 0 ? (
            <p className="muted">Trip filters will appear after calendar availability is loaded.</p>
          ) : (
            <p className="muted">Use these to quickly narrow down realistic options. Results update instantly.</p>
          )}

          <div className="tripControls">
            <label htmlFor="requiredDays">Trip length (full days):</label>
            <select
              id="requiredDays"
              value={requiredDays}
              disabled={calendars.length === 0}
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
                disabled={calendars.length === 0}
                onChange={(e) => setIncludeWeekends(e.target.checked)}
              />
              Weekend-focused windows (Sat/Sun priority)
            </label>
          </div>
          {calendars.length > 0 && includeWeekends && (
            <>
              <p className="muted tripHint">
                {requiredDays === 1
                  ? '1 day: Saturday or Sunday only.'
                  : requiredDays === 2
                    ? '2 days: must include Saturday or Sunday (for example Fri-Sat, Sat-Sun, or Sun-Mon).'
                    : `${requiredDays} days: must include both Saturday and Sunday, and either end on Sunday or start on Saturday.`}
              </p>
            </>
          )}

          {calendars.length > 0 && joinedGroupBusyBlocks.length > 0 && (
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
                {joinedGroupBusyBlocks.map((m) => {
                  const memberKey = String(m.userId || m.userEmail || '').trim().toLowerCase()
                  if (!memberKey) return null
                  const memberLabel = String(m.userEmail || '').trim().toLowerCase()
                    || String(m.userName || '').trim()
                    || `user ${String(m.userId || '').trim()}`

                  return (
                    <label key={m.userId || memberKey} className="tripUserFilterItem">
                      <input
                        type="checkbox"
                        checked={!excludedUsers.has(memberKey)}
                        onChange={(e) => {
                          setExcludedUsers((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.delete(memberKey)
                            else next.add(memberKey)
                            return next
                          })
                        }}
                      />
                      <span>{memberLabel}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {user && (
        <section className="card">
          <h2>6) Day-by-day availability (current + next 4 full months)</h2>
          {!busyBlocks && (
            <p className="muted">
              Your shared calendar view appears after data is loaded.
            </p>
          )}
          {busyBlocks && (
          <>
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

          <div className="proposalBar">
            <div>
              <p className="proposalBarTitle">Proposal range</p>
              <p className="muted proposalBarText">
                {proposalRangeSummary
                  ? proposalRangeSummary.label
                  : 'Click one day to set a start date, then click another day to set the end date.'}
              </p>
            </div>
            <div className="proposalBarActions">
              <button
                type="button"
                className="roleActionBtn"
                onClick={() => {
                  setProposalStartKey('')
                  setProposalEndKey('')
                }}
                disabled={!proposalStartKey}
              >
                Clear range
              </button>
              <button
                type="button"
                className="btnPrimary proposalBtn"
                disabled={!proposalRangeReady}
                onClick={() => setShowProposalModal(true)}
              >
                Create proposal
              </button>
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
                            } ${
                              proposalStartKey === day.dayKey ? 'isProposalStart' : ''
                            } ${
                              proposalEndKey === day.dayKey ? 'isProposalEnd' : ''
                            } ${
                              proposalStartKey && proposalEndKey && day.dayKey >= proposalStartKey && day.dayKey <= proposalEndKey
                                ? 'isProposalInRange'
                                : ''
                            }`}
                            onClick={() => handleDayCardSelect(day.dayKey)}
                          >
                            <span className="dayTitle">{day.dayLabel.split(' ')[1]}</span>
                            {day.isFree && <div className="freeIndicator" />}
                            {day.personInitials.length > 0 && (
                              <>
                                <div className="dayPeopleRow">
                                  {day.personInitials.map(({ ownerKey, initial, isSelf }) => (
                                    <span
                                      key={`${day.dayKey}-${ownerKey || initial}`}
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
                {!selectedDay ? (
                  <>
                    <h3>Day details</h3>
                    <p className="muted">Select a day to view busy appointments by email.</p>
                  </>
                ) : (
                  <>
                    <h3>
                      {selectedDay.weekday}, {selectedDay.dayLabel}
                    </h3>
                    {selectedDayGroupedAppointments.length === 0 ? (
                      <p className="muted">Free day. No blockers.</p>
                    ) : (
                      <div className="appointmentGroups">
                        {selectedDayOwnGroup && (
                          <div className="appointmentSection appointmentSectionOwn">
                            <p className="appointmentSectionTitle">From your calendar</p>
                            <section
                              key={`${selectedDay.dayKey}-${selectedDayOwnGroup.email}`}
                              className="appointmentGroup"
                            >
                              <p className="appointmentGroupEmail">{selectedDayOwnGroup.email}</p>
                              <ul className="appointmentList">
                                {selectedDayOwnGroup.events.map((event, idx) => (
                                  <li
                                    key={`${selectedDay.dayKey}-${selectedDayOwnGroup.email}-${event.eventId || idx}`}
                                    className="appointmentItem"
                                  >
                                    <p className="appointmentSubject">{event.subject}</p>
                                    <div className="appointmentDecisionRow">
                                      <button
                                        type="button"
                                        className={`overrideBtn overrideBtnSm ${event.decision === 'free' ? 'overrideBtnFreeActive' : 'overrideBtnFree'}`}
                                        onClick={() => setEventAvailability(event.eventId, 'free', normalizeTitle(event.subject))}
                                      >
                                        Free
                                      </button>
                                      <button
                                        type="button"
                                        className={`overrideBtn overrideBtnSm ${event.decision === 'unavailable' ? 'overrideBtnBusyActive' : 'overrideBtnBusy'}`}
                                        onClick={() => setEventAvailability(event.eventId, 'unavailable', normalizeTitle(event.subject))}
                                      >
                                        Unavailable
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          </div>
                        )}

                        {selectedDayOtherGroups.length > 0 && (
                          <div className="appointmentSection appointmentSectionOthers">
                            <p className="appointmentSectionTitle">From other members</p>
                            {selectedDayOtherGroups.map((group) => (
                              <section
                                key={`${selectedDay.dayKey}-${group.email}`}
                                className="appointmentGroup appointmentGroupOther"
                              >
                                <p className="appointmentGroupEmail">{group.email}</p>
                                <p
                                  className={`otherUserStatusLine ${
                                    group.unavailableCount === 0 && group.freeCount > 0
                                      ? 'otherUserStatusFree'
                                      : group.freeCount === 0 && group.unavailableCount > 0
                                        ? 'otherUserStatusUnavailable'
                                        : 'otherUserStatusMixed'
                                  }`}
                                >
                                  {group.unavailableCount === 0 && group.freeCount > 0
                                    ? 'Free'
                                    : group.freeCount === 0 && group.unavailableCount > 0
                                      ? 'Unavailable'
                                      : 'Partially unavailable'}
                                </p>
                              </section>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </aside>
          </div>
          </>
          )}
        </section>
      )}
    </main>
  )
}

export default App
