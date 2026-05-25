const BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080';
const AUTH_ID_TOKEN = String(process.env.AUTH_ID_TOKEN || '').trim();
const AUTH_USER_ID = String(process.env.AUTH_USER_ID || '').trim();

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  let text = '';
  try {
    data = await response.json();
  } catch (_err) {
    try {
      text = await response.text();
    } catch (_e) {
      text = '';
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    text,
  };
}

function expect(condition, message, bucket) {
  if (!condition) bucket.push(message);
}

async function runUnauthSuite() {
  const failures = [];
  const checks = [];

  const endpoints = [
    { name: 'GET /api/groups', path: '/api/groups?userId=someone', method: 'GET' },
    { name: 'GET /api/members', path: '/api/members?groupId=fake-group', method: 'GET' },
    {
      name: 'GET /api/calendar/group-busy-blocks',
      path: '/api/calendar/group-busy-blocks?groupId=fake-group&excludeUserId=someone',
      method: 'GET',
    },
    { name: 'GET /api/decisions', path: '/api/decisions?userId=someone', method: 'GET' },
    {
      name: 'POST /api/decisions',
      path: '/api/decisions',
      method: 'POST',
      body: { userId: 'someone', titleDecisions: { demo: 'free' } },
    },
    { name: 'GET /api/calendar-modes', path: '/api/calendar-modes?userId=someone', method: 'GET' },
    {
      name: 'POST /api/calendar-modes',
      path: '/api/calendar-modes',
      method: 'POST',
      body: { userId: 'someone', calendarModes: { x: 'free' } },
    },
    {
      name: 'POST /api/privacy/delete-user-data',
      path: '/api/privacy/delete-user-data',
      method: 'POST',
      body: { userId: 'someone', userEmail: 'someone@example.test' },
    },
  ];

  for (const endpoint of endpoints) {
    const result = await api(endpoint.path, {
      method: endpoint.method,
      body: endpoint.body,
    });

    const isProtected = result.status === 401;
    expect(isProtected, `${endpoint.name} should return 401 without auth (got ${result.status})`, failures);
    checks.push({ endpoint: endpoint.name, status: result.status, protected: isProtected });
  }

  return { failures, checks };
}

async function runAuthSuite() {
  if (!AUTH_ID_TOKEN) {
    return {
      skipped: true,
      reason: 'AUTH_ID_TOKEN not provided. Set AUTH_ID_TOKEN and AUTH_USER_ID to run authenticated persona checks.',
    };
  }

  const failures = [];
  const checks = [];
  const headers = { Authorization: `Bearer ${AUTH_ID_TOKEN}` };

  // 1) Self groups read should be authorized (200)
  const groupsSelf = await api(`/api/groups?userId=${encodeURIComponent(AUTH_USER_ID || 'me')}`, {
    headers,
  });
  expect(groupsSelf.status === 200, `GET /api/groups with auth should return 200 (got ${groupsSelf.status})`, failures);
  checks.push({ endpoint: 'GET /api/groups (self)', status: groupsSelf.status });

  // 2) Cross-user decisions should be forbidden (403)
  const decisionsOther = await api('/api/decisions?userId=other-user-id', { headers });
  expect(decisionsOther.status === 403, `GET /api/decisions for other user should return 403 (got ${decisionsOther.status})`, failures);
  checks.push({ endpoint: 'GET /api/decisions (other user)', status: decisionsOther.status });

  // 3) Cross-user calendar-modes should be forbidden (403)
  const modesOther = await api('/api/calendar-modes?userId=other-user-id', { headers });
  expect(modesOther.status === 403, `GET /api/calendar-modes for other user should return 403 (got ${modesOther.status})`, failures);
  checks.push({ endpoint: 'GET /api/calendar-modes (other user)', status: modesOther.status });

  // 4) Cross-user write decisions should be forbidden (403)
  const writeDecisionsOther = await api('/api/decisions', {
    method: 'POST',
    headers,
    body: { userId: 'other-user-id', titleDecisions: { demo: 'free' } },
  });
  expect(writeDecisionsOther.status === 403, `POST /api/decisions for other user should return 403 (got ${writeDecisionsOther.status})`, failures);
  checks.push({ endpoint: 'POST /api/decisions (other user)', status: writeDecisionsOther.status });

  // 5) Cross-user write calendar modes should be forbidden (403)
  const writeModesOther = await api('/api/calendar-modes', {
    method: 'POST',
    headers,
    body: { userId: 'other-user-id', calendarModes: { x: 'free' } },
  });
  expect(writeModesOther.status === 403, `POST /api/calendar-modes for other user should return 403 (got ${writeModesOther.status})`, failures);
  checks.push({ endpoint: 'POST /api/calendar-modes (other user)', status: writeModesOther.status });

  return { skipped: false, failures, checks };
}

async function run() {
  const unauth = await runUnauthSuite();
  const auth = await runAuthSuite();

  const allFailures = [
    ...unauth.failures,
    ...(auth.skipped ? [] : auth.failures),
  ];

  return {
    summary: {
      unauthFailures: unauth.failures.length,
      authFailures: auth.skipped ? null : auth.failures.length,
      totalFailures: allFailures.length,
    },
    unauth,
    auth,
  };
}

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (result.summary.totalFailures > 0) {
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error('Simulation crashed:', error);
    process.exit(2);
  });
