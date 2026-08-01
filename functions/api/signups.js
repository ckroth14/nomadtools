// POST /api/signups
// Body: { password, action?, id? }
//
// Requires the password to match the ADMIN_PASSWORD environment secret,
// otherwise 401. Password is sent in the POST body (not the URL) so it stays
// out of server logs and browser history.
//   - action omitted / "list": returns every row in the signups table
//   - action "delete" (+ id):  deletes that one row, returns the new count

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: 'Invalid request.' }, 400);
  }

  const password = body && typeof body.password === 'string' ? body.password : '';

  if (!env.ADMIN_PASSWORD) {
    console.error('ADMIN_PASSWORD is not configured for this environment.');
    return jsonResponse({ error: 'Admin access is not configured yet.' }, 500);
  }

  if (!safeEqual(password, env.ADMIN_PASSWORD)) {
    return jsonResponse({ error: 'Wrong password.' }, 401);
  }

  if (!env.DB) {
    console.error('D1 binding "DB" is not configured for this environment.');
    return jsonResponse({ error: 'Database not configured.' }, 500);
  }

  const action = body && typeof body.action === 'string' ? body.action : 'list';

  // Delete a single signup by id.
  if (action === 'delete') {
    const id = body && Number.isInteger(body.id) ? body.id : parseInt(body && body.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return jsonResponse({ error: 'A valid signup id is required.' }, 400);
    }
    try {
      const res = await env.DB.prepare('DELETE FROM signups WHERE id = ?').bind(id).run();
      const deleted = res && res.meta ? res.meta.changes : undefined;
      return jsonResponse({ ok: true, deleted: deleted }, 200);
    } catch (err) {
      console.error('D1 delete failed:', err);
      return jsonResponse({ error: 'Delete failed.' }, 500);
    }
  }

  // Default: list all signups.
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, email, list, source, referral_reason, ip_country, created_at, details
       FROM signups
       ORDER BY created_at DESC`
    ).all();
    return jsonResponse({ ok: true, rows: results || [] }, 200);
  } catch (err) {
    console.error('D1 select failed:', err);
    return jsonResponse({ error: 'Query failed.' }, 500);
  }
}

// Length-aware constant-time-ish comparison so we don't leak the password
// via early-exit timing on a per-character basis.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
