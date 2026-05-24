const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { OAuth2Client } = require('google-auth-library');

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
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

app.listen(port, () => {
  // Keep startup log simple for beginners.
  console.log(`Friends Calendar API running on http://localhost:${port}`);
});
