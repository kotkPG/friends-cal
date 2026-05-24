const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');

dotenv.config();

const DATA_DIR = path.join(__dirname, '..', 'data');
const DECISIONS_FILE = path.join(DATA_DIR, 'decisions.json');
const CALENDAR_MODES_FILE = path.join(DATA_DIR, 'calendar-modes.json');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');

function loadAllDecisions() {
  try {
    if (fs.existsSync(DECISIONS_FILE)) {
      return JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load decisions file:', e.message);
  }
  return {};
}

function saveAllDecisions(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DECISIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadAllCalendarModes() {
  try {
    if (fs.existsSync(CALENDAR_MODES_FILE)) {
      return JSON.parse(fs.readFileSync(CALENDAR_MODES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load calendar modes file:', e.message);
  }
  return {};
}

function saveAllCalendarModes(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CALENDAR_MODES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadMembers() {
  try {
    if (fs.existsSync(MEMBERS_FILE)) {
      return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load members file:', e.message);
  }
  return {};
}

function saveMember(sub, profile) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const members = loadMembers();
  members[sub] = { ...profile, lastSeen: new Date().toISOString() };
  fs.writeFileSync(MEMBERS_FILE, JSON.stringify(members, null, 2), 'utf8');
}

const BUSY_BLOCKS_FILE = path.join(DATA_DIR, 'busy-blocks.json');

function loadBusyBlocksStore() {
  try {
    if (fs.existsSync(BUSY_BLOCKS_FILE)) {
      return JSON.parse(fs.readFileSync(BUSY_BLOCKS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load busy-blocks file:', e.message);
  }
  return {};
}

function saveBusyBlocksForUser(userId, { userName, userEmail, blocks }) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const store = loadBusyBlocksStore();
  store[String(userId)] = {
    userName: userName || '',
    userEmail: userEmail || '',
    updatedAt: new Date().toISOString(),
    blocks,
  };
  fs.writeFileSync(BUSY_BLOCKS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

const app = express();
const port = process.env.PORT || 8080;

const corsOrigins = String(process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => origin.replace(/\/+$/, ''));

const allowAllCorsOrigins = corsOrigins.includes('*');

app.use(cors({
  origin(origin, callback) {
    // Allow non-browser requests (curl, health checks) that do not send Origin.
    if (!origin || allowAllCorsOrigins) {
      return callback(null, true);
    }

    const normalizedOrigin = String(origin).replace(/\/+$/, '');
    if (corsOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
}));
app.use(express.json());

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || '');

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'friends-calendar-api',
    now: new Date().toISOString(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    hasGoogleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    corsOrigins,
    calendarReadScope: 'https://www.googleapis.com/auth/calendar.readonly',
  });
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Missing Google credential token.' });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({
        error: 'GOOGLE_CLIENT_ID is not configured on the server.',
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    return res.json({
      user: {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
      },
      message: 'Google ID token verified successfully.',
    });
  } catch (error) {
    return res.status(401).json({
      error: 'Google token verification failed.',
      details: error.message,
    });
  }
});

// GET /api/members — return list of everyone who has signed in
app.get('/api/members', (_req, res) => {
  const members = loadMembers();
  const list = Object.values(members).map(({ name, email, picture, lastSeen }) => ({
    name,
    email,
    picture,
    lastSeen,
  }));
  // Sort by most recent sign-in first
  list.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
  return res.json({ members: list });
});

// POST /api/members/join — explicit opt-in to the group calendar
app.post('/api/members/join', (req, res) => {
  const { userId, name, email, picture } = req.body;
  if (!userId || !email) {
    return res.status(400).json({ error: 'userId and email are required.' });
  }
  saveMember(String(userId), {
    name: name || '',
    email: String(email),
    picture: picture || '',
  });
  return res.json({ ok: true });
});

// POST /api/members/leave — remove self from group roster
app.post('/api/members/leave', (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }
  if (!fs.existsSync(DATA_DIR)) return res.json({ ok: true });
  const members = loadMembers();
  delete members[String(userId)];
  fs.writeFileSync(MEMBERS_FILE, JSON.stringify(members, null, 2), 'utf8');
  return res.json({ ok: true });
});

// Starter endpoint: filter event blocks by simple "tags in title" rule.
app.post('/api/calendar/filter-preview', (req, res) => {
  const { events = [], tags = [] } = req.body;
  const normalizedTags = tags.map((tag) => String(tag).toLowerCase().trim()).filter(Boolean);

  const matchedEvents = events.filter((event) => {
    const title = String(event.summary || '').toLowerCase();

    if (!normalizedTags.length) {
      return true;
    }

    return normalizedTags.some((tag) => title.includes(tag));
  });

  const busyBlocks = matchedEvents.map((event) => ({
    start: event.start,
    end: event.end,
    source: event.summary || 'Untitled Event',
  }));

  res.json({
    inputCount: events.length,
    matchedCount: matchedEvents.length,
    busyBlocks,
  });
});

// Helper: extract access token from Authorization header
function getAccessToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
}

// GET /api/calendar/list — returns the user's list of calendars
app.get('/api/calendar/list', async (req, res) => {
  const accessToken = getAccessToken(req);

  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token in Authorization header.' });
  }

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const calendarApi = google.calendar({ version: 'v3', auth });
    
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Google API request timeout')), 10000)
    );
    
    const response = await Promise.race([
      calendarApi.calendarList.list({ minAccessRole: 'reader' }),
      timeoutPromise,
    ]);

    const calendars = (response.data.items || []).map((item) => ({
      id: item.id,
      summary: item.summary,
      backgroundColor: item.backgroundColor,
      primary: item.primary || false,
    }));

    return res.json({ calendars });
  } catch (error) {
    console.error('Calendar list error:', error.message);
    return res.status(500).json({
      error: 'Failed to fetch calendar list.',
      details: error.message,
    });
  }
});

// POST /api/calendar/busy-blocks — fetch events from selected calendars and return busy blocks
app.post('/api/calendar/busy-blocks', async (req, res) => {
  const accessToken = getAccessToken(req);

  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token in Authorization header.' });
  }

  const { calendarIds = [], tags = [], daysAhead = 60, userId, userName, userEmail } = req.body;

  if (!Array.isArray(calendarIds) || calendarIds.length === 0) {
    return res.status(400).json({ error: 'calendarIds must be a non-empty array.' });
  }

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const calendarApi = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

    const normalizedTags = tags
      .map((t) => String(t).toLowerCase().trim())
      .filter(Boolean);

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Google API request timeout')), 10000)
    );

    // Fetch events from all selected calendars in parallel
    const fetchEventsPromise = Promise.all(
      calendarIds.map((calId) =>
        calendarApi.events.list({
          calendarId: calId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
        }),
      ),
    );

    const results = await Promise.race([fetchEventsPromise, timeoutPromise]);

    // Flatten while preserving which calendarId each event came from
    let allEvents = results.flatMap((r, i) =>
      (r.data.items || []).map((event) => ({ ...event, _calendarId: calendarIds[i] }))
    );

    // Filter by tags if provided
    if (normalizedTags.length > 0) {
      allEvents = allEvents.filter((event) => {
        const title = String(event.summary || '').toLowerCase();
        return normalizedTags.some((tag) => title.includes(tag));
      });
    }

    const busyBlocks = allEvents.map((event) => {
      const organizer = {
        name: event.organizer?.displayName || '',
        email: event.organizer?.email || '',
      };

      const organizers = organizer.email || organizer.name ? [organizer] : [];

      return {
        id: event.id || '',
        title: event.summary || 'Busy',
        start: event.start,
        end: event.end,
        calendarId: event._calendarId || '',
        participants: organizers,
      };
    });

    // Persist this user's busy blocks so group members can see them
    if (userId) {
      saveBusyBlocksForUser(userId, { userName, userEmail, blocks: busyBlocks });
    }

    return res.json({
      busyBlocks,
      tags: normalizedTags,
    });
  } catch (error) {
    console.error('Busy blocks error:', error.message);
    return res.status(500).json({
      error: 'Failed to fetch calendar events.',
      details: error.message,
    });
  }
});

// GET /api/calendar/group-busy-blocks — return stored busy blocks for all users except requester
app.get('/api/calendar/group-busy-blocks', (req, res) => {
  const { excludeUserId } = req.query;
  const store = loadBusyBlocksStore();
  const members = Object.entries(store)
    .filter(([uid]) => !excludeUserId || uid !== String(excludeUserId))
    .map(([, data]) => ({
      userName: data.userName || '',
      userEmail: data.userEmail || '',
      updatedAt: data.updatedAt || '',
      blocks: data.blocks || [],
    }));
  return res.json({ members });
});

// GET /api/decisions?userId=<sub> — return saved title-level decisions for a user
app.get('/api/decisions', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId query param required.' });
  const all = loadAllDecisions();
  return res.json({ decisions: all[String(userId)] || {} });
});

// POST /api/decisions — merge title-level decisions for a user
app.post('/api/decisions', (req, res) => {
  const { userId, titleDecisions } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required.' });
  if (!titleDecisions || typeof titleDecisions !== 'object' || Array.isArray(titleDecisions)) {
    return res.status(400).json({ error: 'titleDecisions must be an object.' });
  }
  // Validate values
  for (const [key, val] of Object.entries(titleDecisions)) {
    if (val !== 'free' && val !== 'unavailable') {
      return res.status(400).json({ error: `Invalid decision value for "${key}": must be free or unavailable.` });
    }
  }
  const all = loadAllDecisions();
  all[String(userId)] = { ...(all[String(userId)] || {}), ...titleDecisions };
  saveAllDecisions(all);
  return res.json({ ok: true });
});

// GET /api/calendar-modes?userId=<sub> — return saved calendar modes for section 3
app.get('/api/calendar-modes', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId query param required.' });
  const all = loadAllCalendarModes();
  return res.json({ calendarModes: all[String(userId)] || {} });
});

// POST /api/calendar-modes — save full section 3 calendar mode map for a user
app.post('/api/calendar-modes', (req, res) => {
  const { userId, calendarModes } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required.' });
  if (!calendarModes || typeof calendarModes !== 'object' || Array.isArray(calendarModes)) {
    return res.status(400).json({ error: 'calendarModes must be an object.' });
  }

  for (const [calendarId, mode] of Object.entries(calendarModes)) {
    if (typeof calendarId !== 'string' || !calendarId.trim()) {
      return res.status(400).json({ error: 'calendarModes contains invalid calendarId.' });
    }
    if (mode !== 'free' && mode !== 'individual' && mode !== 'unavailable') {
      return res.status(400).json({
        error: `Invalid mode for "${calendarId}": must be free, individual, or unavailable.`,
      });
    }
  }

  const all = loadAllCalendarModes();
  all[String(userId)] = { ...calendarModes };
  saveAllCalendarModes(all);
  return res.json({ ok: true });
});

app.listen(port, () => {
  // Keep startup log simple for beginners.
  console.log(`Friends Calendar API running on http://localhost:${port}`);
});
