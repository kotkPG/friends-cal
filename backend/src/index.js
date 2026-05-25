const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');

dotenv.config();

const DATA_DIR = path.join(__dirname, '..', 'data');
const DECISIONS_FILE = path.join(DATA_DIR, 'decisions.json');
const CALENDAR_MODES_FILE = path.join(DATA_DIR, 'calendar-modes.json');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const BUSY_BLOCKS_FILE = path.join(DATA_DIR, 'busy-blocks.json');
const DB_FILE = path.join(DATA_DIR, 'friends-cal.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.prepare(`
  CREATE TABLE IF NOT EXISTS kv_store (
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (bucket, key)
  )
`).run();

function readLegacyFile(filePath, label) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Failed to load ${label} file:`, e.message);
  }
  return {};
}

function writeBucket(bucket, data) {
  const payload = data && typeof data === 'object' ? data : {};
  const entries = Object.entries(payload).map(([k, v]) => [bucket, String(k), JSON.stringify(v)]);

  const clearStmt = db.prepare('DELETE FROM kv_store WHERE bucket = ?');
  const insertStmt = db.prepare('INSERT INTO kv_store (bucket, key, value) VALUES (?, ?, ?)');
  const tx = db.transaction((rows) => {
    clearStmt.run(bucket);
    rows.forEach((row) => insertStmt.run(row[0], row[1], row[2]));
  });
  tx(entries);
}

function readBucket(bucket, fallbackFilePath, label) {
  const rows = db.prepare('SELECT key, value FROM kv_store WHERE bucket = ?').all(bucket);
  if (rows.length > 0) {
    const data = {};
    rows.forEach((row) => {
      try {
        data[row.key] = JSON.parse(row.value);
      } catch (_err) {
        data[row.key] = row.value;
      }
    });
    return data;
  }

  const legacy = readLegacyFile(fallbackFilePath, label);
  if (Object.keys(legacy).length > 0) {
    writeBucket(bucket, legacy);
  }
  return legacy;
}

function loadAllDecisions() {
  return readBucket('decisions', DECISIONS_FILE, 'decisions');
}

function saveAllDecisions(data) {
  writeBucket('decisions', data);
}

function loadAllCalendarModes() {
  return readBucket('calendar_modes', CALENDAR_MODES_FILE, 'calendar modes');
}

function saveAllCalendarModes(data) {
  writeBucket('calendar_modes', data);
}

function loadMembers() {
  return readBucket('members', MEMBERS_FILE, 'members');
}

function persistMembers(members) {
  writeBucket('members', members);
}

function loadGroups() {
  return readBucket('groups', GROUPS_FILE, 'groups');
}

function persistGroups(groups) {
  writeBucket('groups', groups);
}

function normalizeGroupMembers(members) {
  const normalized = { ...members };
  const userIds = Object.keys(normalized);

  userIds.forEach((userId) => {
    const current = normalized[userId] || {};
    normalized[userId] = {
      ...current,
      role: current.role === 'admin' ? 'admin' : 'member',
    };
  });

  const hasAdmin = userIds.some((userId) => normalized[userId]?.role === 'admin');
  if (!hasAdmin && userIds.length > 0) {
    normalized[userIds[0]] = {
      ...normalized[userIds[0]],
      role: 'admin',
    };
  }

  return normalized;
}

function generateGroupId() {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function ensureGroupsFromLegacy() {
  const groups = loadGroups();
  if (Object.keys(groups).length > 0) {
    return groups;
  }

  const legacyMembers = loadMembers();
  const userIds = Object.keys(legacyMembers);
  if (userIds.length === 0) {
    return groups;
  }

  const migratedMembers = {};
  userIds.forEach((userId, idx) => {
    const legacy = legacyMembers[userId] || {};
    migratedMembers[userId] = {
      name: legacy.name || '',
      email: legacy.email || '',
      picture: legacy.picture || '',
      lastSeen: legacy.lastSeen || new Date().toISOString(),
      role: legacy.role === 'admin' || idx === 0 ? 'admin' : 'member',
    };
  });

  const groupId = generateGroupId();
  const createdAt = new Date().toISOString();
  const migrated = {
    [groupId]: {
      id: groupId,
      name: 'General group',
      inviteCode: generateInviteCode(),
      createdAt,
      updatedAt: createdAt,
      members: normalizeGroupMembers(migratedMembers),
    },
  };

  persistGroups(migrated);
  return migrated;
}

function loadNormalizedGroups() {
  const groups = ensureGroupsFromLegacy();
  const normalized = {};

  Object.entries(groups).forEach(([groupId, group]) => {
    const members = normalizeGroupMembers(group.members || {});
    normalized[groupId] = {
      id: group.id || groupId,
      name: group.name || 'Untitled group',
      inviteCode: group.inviteCode || generateInviteCode(),
      createdAt: group.createdAt || new Date().toISOString(),
      updatedAt: group.updatedAt || new Date().toISOString(),
      members,
    };
  });

  persistGroups(normalized);
  return normalized;
}

function countAdmins(groupMembers) {
  return Object.values(groupMembers).filter((member) => member?.role === 'admin').length;
}

function sanitizeGroupMember(userId, data) {
  return {
    userId,
    role: data.role || 'member',
    name: data.name || '',
    email: data.email || '',
    picture: data.picture || '',
    lastSeen: data.lastSeen || '',
  };
}

function saveGroups(groups) {
  const normalized = {};
  Object.entries(groups).forEach(([groupId, group]) => {
    normalized[groupId] = {
      ...group,
      id: group.id || groupId,
      members: normalizeGroupMembers(group.members || {}),
      updatedAt: new Date().toISOString(),
    };
  });
  persistGroups(normalized);
  return normalized;
}

function getGroupForUser(groups, userId) {
  return Object.values(groups).filter((group) => group.members?.[String(userId)]);
}

function loadBusyBlocksStore() {
  return readBucket('busy_blocks', BUSY_BLOCKS_FILE, 'busy-blocks');
}

function saveBusyBlocksStore(store) {
  writeBucket('busy_blocks', store);
}

function saveBusyBlocksForUser(userId, { userName, userEmail, blocks }) {
  const store = loadBusyBlocksStore();
  store[String(userId)] = {
    userName: userName || '',
    userEmail: userEmail || '',
    updatedAt: new Date().toISOString(),
    blocks,
  };
  saveBusyBlocksStore(store);
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
const platformAdminEmails = String(process.env.PLATFORM_ADMIN_EMAILS || '')
  .split(',')
  .map((email) => String(email).trim().toLowerCase())
  .filter(Boolean);

function isPlatformAdminEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return platformAdminEmails.includes(normalized);
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

async function requireAuth(req, res, next) {
  try {
    const idToken = getBearerToken(req);
    if (!idToken) {
      return res.status(401).json({ error: 'Missing auth token.' });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: 'GOOGLE_CLIENT_ID is not configured on server.' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload?.email) {
      return res.status(401).json({ error: 'Invalid auth token payload.' });
    }

    req.authUser = {
      id: String(payload.sub),
      email: String(payload.email).trim().toLowerCase(),
      name: String(payload.name || ''),
      picture: String(payload.picture || ''),
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Authentication failed.', details: error.message });
  }
}

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
    platformAdminEmails,
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

// GET /api/groups?userId=<id> — list groups where this user is a member
app.get('/api/groups', requireAuth, (req, res) => {
  const userId = req.authUser.id;

  const groups = loadNormalizedGroups();
  const memberships = getGroupForUser(groups, userId).map((group) => {
    const me = group.members[String(userId)];
    const memberCount = Object.keys(group.members || {}).length;

    const payload = {
      id: group.id,
      name: group.name,
      role: me?.role || 'member',
      memberCount,
    };

    if (me?.role === 'admin') {
      payload.inviteCode = group.inviteCode;
    }

    return payload;
  });

  return res.json({ groups: memberships });
});

// POST /api/groups/create — create a group and make creator admin
app.post('/api/groups/create', requireAuth, (req, res) => {
  const { name } = req.body;
  const actor = req.authUser;
  if (!name) {
    return res.status(400).json({ error: 'name is required.' });
  }

  const groups = loadNormalizedGroups();
  const groupId = generateGroupId();
  const now = new Date().toISOString();

  groups[groupId] = {
    id: groupId,
    name: String(name).trim(),
    inviteCode: generateInviteCode(),
    createdAt: now,
    updatedAt: now,
    members: {
      [actor.id]: {
        name: actor.name,
        email: actor.email,
        picture: actor.picture,
        role: 'admin',
        lastSeen: now,
      },
    },
  };

  saveGroups(groups);
  return res.json({
    ok: true,
    group: {
      id: groupId,
      name: groups[groupId].name,
      role: 'admin',
      inviteCode: groups[groupId].inviteCode,
      memberCount: 1,
    },
  });
});

// POST /api/groups/join-by-invite — join group via invite code
app.post('/api/groups/join-by-invite', requireAuth, (req, res) => {
  const { inviteCode } = req.body;
  const actor = req.authUser;
  if (!inviteCode) {
    return res.status(400).json({ error: 'inviteCode is required.' });
  }

  const normalizedCode = String(inviteCode).trim().toUpperCase();
  const groups = loadNormalizedGroups();
  const targetGroup = Object.values(groups).find((group) => group.inviteCode === normalizedCode);

  if (!targetGroup) {
    return res.status(404).json({ error: 'Invite code not found.' });
  }

  const userKey = actor.id;
  targetGroup.members[userKey] = {
    ...(targetGroup.members[userKey] || {}),
    name: actor.name,
    email: actor.email,
    picture: actor.picture,
    role: targetGroup.members[userKey]?.role === 'admin' ? 'admin' : 'member',
    lastSeen: new Date().toISOString(),
  };

  groups[targetGroup.id] = {
    ...targetGroup,
    members: normalizeGroupMembers(targetGroup.members),
  };
  saveGroups(groups);

  return res.json({ ok: true, groupId: targetGroup.id });
});

// POST /api/groups/invite — admin can regenerate invite code
app.post('/api/groups/invite', requireAuth, (req, res) => {
  const { groupId, regenerate } = req.body;
  const actorUserId = req.authUser.id;
  if (!groupId) {
    return res.status(400).json({ error: 'groupId is required.' });
  }

  const groups = loadNormalizedGroups();
  const group = groups[String(groupId)];
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  const actor = group.members[String(actorUserId)];
  if (!actor || actor.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can manage invite codes.' });
  }

  if (regenerate) {
    group.inviteCode = generateInviteCode();
    groups[group.id] = group;
    saveGroups(groups);
  }

  return res.json({ ok: true, inviteCode: group.inviteCode });
});

// POST /api/groups/delete — delete a group (group admin or platform admin)
app.post('/api/groups/delete', requireAuth, (req, res) => {
  const { groupId } = req.body;
  const actorUserId = req.authUser.id;
  const actorEmail = req.authUser.email;
  if (!groupId) {
    return res.status(400).json({ error: 'groupId is required.' });
  }

  const groups = loadNormalizedGroups();
  const group = groups[String(groupId)];
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  const actor = group.members[String(actorUserId)];
  const isGroupAdmin = actor?.role === 'admin';
  const isPlatformAdmin = isPlatformAdminEmail(actorEmail);
  if (!isGroupAdmin && !isPlatformAdmin) {
    return res.status(403).json({ error: 'Only group admins or platform admins can delete groups.' });
  }

  delete groups[String(groupId)];
  saveGroups(groups);
  return res.json({ ok: true });
});

// GET /api/platform/groups?actorEmail=<email> — platform admin review of all groups
app.get('/api/platform/groups', requireAuth, (req, res) => {
  if (!isPlatformAdminEmail(req.authUser.email)) {
    return res.status(403).json({ error: 'Only platform admins can review all groups.' });
  }

  const groups = loadNormalizedGroups();
  const payload = Object.values(groups)
    .map((group) => {
      const members = Object.entries(group.members || {}).map(([userId, data]) =>
        sanitizeGroupMember(userId, data)
      );
      const admins = members
        .filter((member) => member.role === 'admin')
        .map((member) => member.email)
        .filter(Boolean);

      return {
        id: group.id,
        name: group.name,
        inviteCode: group.inviteCode,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        memberCount: members.length,
        admins,
        members,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return res.json({ groups: payload });
});

// POST /api/platform/assign-user-group — platform admin assigns user to a specific group
app.post('/api/platform/assign-user-group', requireAuth, (req, res) => {
  const {
    targetEmail,
    targetUserId,
    targetName,
    targetPicture,
    groupId,
    role = 'member',
    removeFromOtherGroups = true,
  } = req.body;

  if (!targetEmail || !groupId) {
    return res.status(400).json({ error: 'targetEmail and groupId are required.' });
  }

  if (!isPlatformAdminEmail(req.authUser.email)) {
    return res.status(403).json({ error: 'Only platform admins can assign users to groups.' });
  }

  if (role !== 'admin' && role !== 'member') {
    return res.status(400).json({ error: 'role must be admin or member.' });
  }

  const groups = loadNormalizedGroups();
  const targetGroup = groups[String(groupId)];
  if (!targetGroup) {
    return res.status(404).json({ error: 'Target group not found.' });
  }

  const normalizedTargetEmail = String(targetEmail).trim().toLowerCase();

  let resolvedUserId = targetUserId ? String(targetUserId) : '';
  let existingProfile = null;

  Object.values(groups).forEach((group) => {
    Object.entries(group.members || {}).forEach(([memberUserId, member]) => {
      const memberEmail = String(member.email || '').trim().toLowerCase();
      const idMatches = resolvedUserId && memberUserId === resolvedUserId;
      const emailMatches = memberEmail && memberEmail === normalizedTargetEmail;
      if (!existingProfile && (idMatches || emailMatches)) {
        resolvedUserId = memberUserId;
        existingProfile = member;
      }
    });
  });

  if (!resolvedUserId) {
    return res.status(404).json({ error: 'Target user not found in existing records. Ask them to sign in first.' });
  }

  const profile = {
    name: String(targetName || existingProfile?.name || ''),
    email: normalizedTargetEmail,
    picture: String(targetPicture || existingProfile?.picture || ''),
    role,
    lastSeen: existingProfile?.lastSeen || new Date().toISOString(),
  };

  if (removeFromOtherGroups) {
    Object.values(groups).forEach((group) => {
      if (group.id === targetGroup.id) return;
      if (group.members?.[resolvedUserId]) {
        delete group.members[resolvedUserId];
        group.members = normalizeGroupMembers(group.members || {});
      }
    });
  }

  targetGroup.members[resolvedUserId] = {
    ...(targetGroup.members[resolvedUserId] || {}),
    ...profile,
  };

  groups[targetGroup.id] = {
    ...targetGroup,
    members: normalizeGroupMembers(targetGroup.members),
  };
  saveGroups(groups);

  return res.json({ ok: true, groupId: targetGroup.id, userId: resolvedUserId });
});

// GET /api/members?groupId=<id> — return members within selected group only
app.get('/api/members', requireAuth, (req, res) => {
  const { groupId } = req.query;
  if (!groupId) return res.status(400).json({ error: 'groupId query param required.' });

  const groups = loadNormalizedGroups();
  const group = groups[String(groupId)];
  if (!group) return res.status(404).json({ error: 'Group not found.' });
  if (!group.members?.[req.authUser.id]) {
    return res.status(403).json({ error: 'You are not a member of this group.' });
  }

  const list = Object.entries(group.members || {})
    .map(([userId, data]) => sanitizeGroupMember(userId, data))
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

  return res.json({ members: list });
});

// POST /api/members/leave — remove self from a group roster
app.post('/api/members/leave', requireAuth, (req, res) => {
  const { groupId } = req.body;
  const userId = req.authUser.id;
  if (!groupId) {
    return res.status(400).json({ error: 'groupId is required.' });
  }

  const groups = loadNormalizedGroups();
  const group = groups[String(groupId)];
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  if (!group.members[String(userId)]) {
    return res.status(404).json({ error: 'Member not found.' });
  }

  const isLeavingAdmin = group.members[String(userId)]?.role === 'admin';
  if (isLeavingAdmin && countAdmins(group.members) <= 1 && Object.keys(group.members).length > 1) {
    return res.status(400).json({ error: 'Assign another admin before leaving.' });
  }

  delete group.members[String(userId)];
  groups[group.id] = {
    ...group,
    members: normalizeGroupMembers(group.members),
  };
  saveGroups(groups);
  return res.json({ ok: true });
});

// POST /api/members/remove — admin removes another member from selected group
app.post('/api/members/remove', requireAuth, (req, res) => {
  const { groupId, targetUserId } = req.body;
  const actorUserId = req.authUser.id;

  if (!groupId || !targetUserId) {
    return res.status(400).json({ error: 'groupId and targetUserId are required.' });
  }

  if (String(actorUserId) === String(targetUserId)) {
    return res.status(400).json({ error: 'Use leave for removing yourself.' });
  }

  const groups = loadNormalizedGroups();
  const group = groups[String(groupId)];
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  const actor = group.members[String(actorUserId)];
  if (!actor || actor.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can remove members.' });
  }

  if (!group.members[String(targetUserId)]) {
    return res.status(404).json({ error: 'Target member not found.' });
  }

  delete group.members[String(targetUserId)];
  groups[group.id] = {
    ...group,
    members: normalizeGroupMembers(group.members),
  };
  saveGroups(groups);

  return res.json({ ok: true });
});

// POST /api/members/role — admin grants/revokes elevated role in selected group
app.post('/api/members/role', requireAuth, (req, res) => {
  const { groupId, targetUserId, role } = req.body;
  const actorUserId = req.authUser.id;

  if (!groupId || !targetUserId || !role) {
    return res.status(400).json({ error: 'groupId, targetUserId, and role are required.' });
  }

  if (role !== 'admin' && role !== 'member') {
    return res.status(400).json({ error: 'role must be admin or member.' });
  }

  const groups = loadNormalizedGroups();
  const group = groups[String(groupId)];
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  const actor = group.members[String(actorUserId)];
  if (!actor || actor.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can change member roles.' });
  }

  const target = group.members[String(targetUserId)];
  if (!target) {
    return res.status(404).json({ error: 'Target member not found.' });
  }

  if (role === 'member' && target.role === 'admin' && countAdmins(group.members) <= 1) {
    return res.status(400).json({ error: 'At least one admin is required.' });
  }

  group.members[String(targetUserId)] = {
    ...target,
    role,
    lastSeen: target.lastSeen || new Date().toISOString(),
  };

  groups[group.id] = {
    ...group,
    members: normalizeGroupMembers(group.members),
  };
  saveGroups(groups);
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
app.get('/api/calendar/group-busy-blocks', requireAuth, (req, res) => {
  const { groupId, excludeUserId } = req.query;
  if (!groupId) {
    return res.status(400).json({ error: 'groupId query param required.' });
  }

  const groups = loadNormalizedGroups();
  const group = groups[String(groupId)];
  if (!group) {
    return res.status(404).json({ error: 'Group not found.' });
  }
  if (!group.members?.[req.authUser.id]) {
    return res.status(403).json({ error: 'You are not a member of this group.' });
  }

  const allowedUserIds = new Set(Object.keys(group.members || {}));
  const store = loadBusyBlocksStore();
  const members = Object.entries(store)
    .filter(([uid]) => allowedUserIds.has(String(uid)))
    .filter(([uid]) => !excludeUserId || uid !== String(excludeUserId))
    .map(([uid, data]) => {
      const profile = group.members?.[String(uid)] || {};
      return {
        userId: uid,
        userName: data.userName || profile.name || '',
        userEmail: data.userEmail || profile.email || '',
        updatedAt: data.updatedAt || '',
        blocks: data.blocks || [],
      };
    });
  return res.json({ members });
});

// GET /api/decisions?userId=<sub> — return saved title-level decisions for a user
app.get('/api/decisions', requireAuth, (req, res) => {
  const { userId } = req.query;
  const targetUserId = String(userId || req.authUser.id);
  if (targetUserId !== req.authUser.id) {
    return res.status(403).json({ error: 'You can only access your own decisions.' });
  }
  const all = loadAllDecisions();
  return res.json({ decisions: all[targetUserId] || {} });
});

// GET /api/decisions/group?groupId=<id>&requesterUserId=<sub>
// Return title-level decisions for all members in a group.
app.get('/api/decisions/group', requireAuth, (req, res) => {
  const { groupId } = req.query;
  if (!groupId) {
    return res.status(400).json({ error: 'groupId query param required.' });
  }

  const groups = loadNormalizedGroups();
  const group = groups[String(groupId)];
  if (!group) {
    return res.status(404).json({ error: 'Group not found.' });
  }

  if (!group.members?.[req.authUser.id]) {
    return res.status(403).json({ error: 'You are not a member of this group.' });
  }

  const all = loadAllDecisions();
  const decisionsByUserId = {};
  Object.keys(group.members || {}).forEach((memberUserId) => {
    decisionsByUserId[memberUserId] = all[String(memberUserId)] || {};
  });

  return res.json({ decisionsByUserId });
});

// POST /api/decisions — merge title-level decisions for a user
app.post('/api/decisions', requireAuth, (req, res) => {
  const { userId, titleDecisions } = req.body;
  const targetUserId = String(userId || req.authUser.id);
  if (targetUserId !== req.authUser.id) {
    return res.status(403).json({ error: 'You can only update your own decisions.' });
  }
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
  all[targetUserId] = { ...(all[targetUserId] || {}), ...titleDecisions };
  saveAllDecisions(all);
  return res.json({ ok: true });
});

// GET /api/calendar-modes?userId=<sub> — return saved calendar modes for section 3
app.get('/api/calendar-modes', requireAuth, (req, res) => {
  const { userId } = req.query;
  const targetUserId = String(userId || req.authUser.id);
  if (targetUserId !== req.authUser.id) {
    return res.status(403).json({ error: 'You can only access your own calendar modes.' });
  }
  const all = loadAllCalendarModes();
  return res.json({ calendarModes: all[targetUserId] || {} });
});

// POST /api/calendar-modes — save full section 3 calendar mode map for a user
app.post('/api/calendar-modes', requireAuth, (req, res) => {
  const { userId, calendarModes } = req.body;
  const targetUserId = String(userId || req.authUser.id);
  if (targetUserId !== req.authUser.id) {
    return res.status(403).json({ error: 'You can only update your own calendar modes.' });
  }
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
  all[targetUserId] = { ...calendarModes };
  saveAllCalendarModes(all);
  return res.json({ ok: true });
});

// POST /api/privacy/delete-user-data — delete user records and remove from all groups
app.post('/api/privacy/delete-user-data', requireAuth, (req, res) => {
  const userKey = req.authUser.id;
  const normalizedEmail = req.authUser.email;
  const result = {
    removedFromGroups: 0,
    deletedGroups: 0,
    decisionsDeleted: false,
    calendarModesDeleted: false,
    busyBlocksDeleted: false,
    legacyMemberDeleted: false,
  };

  const groups = loadNormalizedGroups();
  Object.values(groups).forEach((group) => {
    const members = group.members || {};
    const hasDirectUserId = Boolean(members[userKey]);
    const matchedUserId = hasDirectUserId
      ? userKey
      : Object.keys(members).find((memberUserId) => {
          if (!normalizedEmail) return false;
          const memberEmail = String(members[memberUserId]?.email || '').trim().toLowerCase();
          return memberEmail && memberEmail === normalizedEmail;
        });

    if (!matchedUserId) return;

    delete members[matchedUserId];
    result.removedFromGroups += 1;

    if (Object.keys(members).length === 0) {
      delete groups[group.id];
      result.deletedGroups += 1;
      return;
    }

    groups[group.id] = {
      ...group,
      members: normalizeGroupMembers(members),
    };
  });
  saveGroups(groups);

  const allDecisions = loadAllDecisions();
  if (allDecisions[userKey]) {
    delete allDecisions[userKey];
    saveAllDecisions(allDecisions);
    result.decisionsDeleted = true;
  }

  const allCalendarModes = loadAllCalendarModes();
  if (allCalendarModes[userKey]) {
    delete allCalendarModes[userKey];
    saveAllCalendarModes(allCalendarModes);
    result.calendarModesDeleted = true;
  }

  const allBusyBlocks = loadBusyBlocksStore();
  if (allBusyBlocks[userKey]) {
    delete allBusyBlocks[userKey];
    saveBusyBlocksStore(allBusyBlocks);
    result.busyBlocksDeleted = true;
  }

  const legacyMembers = loadMembers();
  if (legacyMembers[userKey]) {
    delete legacyMembers[userKey];
    persistMembers(legacyMembers);
    result.legacyMemberDeleted = true;
  }

  return res.json({ ok: true, result });
});

app.listen(port, () => {
  // Keep startup log simple for beginners.
  console.log(`Friends Calendar API running on http://localhost:${port}`);
});
