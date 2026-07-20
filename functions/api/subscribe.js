// POST /api/subscribe
// Body: { email, list, source, reason, website }
//   - list: 'waitlist' | 'membership'
//   - website: honeypot — hidden form field, should always be empty. If a bot
//     fills it, we silently pretend to succeed and never touch the DB.
//
// The D1 write is the source of truth. We only attempt the Resend email
// AFTER the row is safely saved, and a failed send never fails the request —
// we don't want to lose a signup because an email bounced.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_LISTS = new Set(['waitlist', 'membership']);

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const { email, list, source, reason, website } = body || {};

  // Honeypot tripped — act like everything worked, save nothing.
  if (website) {
    return jsonResponse({ ok: true }, 200);
  }

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return jsonResponse({ error: 'Enter a valid email address.' }, 400);
  }

  if (!VALID_LISTS.has(list)) {
    return jsonResponse({ error: 'Invalid list.' }, 400);
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanSource = typeof source === 'string' && source.trim() ? source.trim().slice(0, 120) : null;
  const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 120) : null;
  const ipCountry = request.headers.get('cf-ipcountry') || null;

  if (!env.DB) {
    console.error('D1 binding "DB" is not configured for this environment.');
    return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO signups (email, list, source, referral_reason, ip_country)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email, list) DO NOTHING`
    )
      .bind(cleanEmail, list, cleanSource, cleanReason, ipCountry)
      .run();
  } catch (err) {
    console.error('D1 insert failed:', err);
    return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500);
  }

  // Best-effort send. Row is already saved, so a bounce/API hiccup here
  // never turns into a lost signup.
  if (env.RESEND_API_KEY) {
    try {
      await sendConfirmationEmail(env, cleanEmail, list);
    } catch (err) {
      console.error('Resend send failed:', err);
    }
  } else {
    console.error('RESEND_API_KEY is not set — skipping confirmation email.');
  }

  return jsonResponse({ ok: true }, 200);
}

async function sendConfirmationEmail(env, email, list) {
  const template = list === 'waitlist' ? waitlistTemplate() : membershipTemplate();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Nomad Tools <info@nomadtools.us>',
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${detail}`);
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Email templates — inline CSS only (email clients strip <style> blocks).
//
// TODO (human): the copy below is placeholder text straight from the build
// brief. Swap in final copy when it's ready. See SETUP.md for how to update
// LOGO_URL once a real email-safe logo file exists.
// ---------------------------------------------------------------------------

const LOGO_URL = 'https://nomadtools.us/logo-email.png'; // TODO (human): see SETUP.md

function emailShell(bodyHtml) {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background:#f0f0f0; font-family: 'DM Sans', Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px; background:#ffffff; border-radius:6px; overflow:hidden;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#E31E24; padding:20px 32px;">
                <!-- TODO (human): drop in the real logo file per SETUP.md, then this renders it. -->
                <img src="${LOGO_URL}" alt="Nomad Tools" height="28" style="display:block; border:0; outline:none;" />
              </td>
            </tr>
            <tr>
              <td style="padding:32px; color:#1a1a1a; font-size:15px; line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; border-top:1px solid #eee; color:#999999; font-size:12px;">
                Nomad Tools &middot; nomadtools.us &middot; Reply to this email any time.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function waitlistTemplate() {
  const html = emailShell(`
    <h1 style="margin:0 0 16px; font-size:20px; color:#1a1a1a;">You're on the wait list</h1>
    <p style="margin:0 0 16px;">Thanks for joining the Nomad.PoE wait list. You're in line — we'll email this address the moment it's available to order.</p>
    <p style="margin:0 0 16px;">In the meantime, here's what Nomad.PoE is: [1&ndash;2 line product blurb].</p>
    <p style="margin:0;">Questions? Just reply to this email.</p>
  `);

  const text = [
    "You're on the Nomad Tools wait list",
    '',
    "Thanks for joining the Nomad.PoE wait list. You're in line — we'll email this address the moment it's available to order.",
    '',
    'In the meantime, here’s what Nomad.PoE is: [1-2 line product blurb].',
    '',
    'Questions? Just reply to this email.',
    '',
    '— Nomad Tools · nomadtools.us',
  ].join('\n');

  return {
    subject: "You're on the Nomad Tools wait list ✔",
    html,
    text,
  };
}

function membershipTemplate() {
  const html = emailShell(`
    <h1 style="margin:0 0 16px; font-size:20px; color:#1a1a1a;">Welcome to Nomad Tools</h1>
    <p style="margin:0 0 16px;">Welcome aboard. You'll be the first to hear about new products, updates, and behind-the-scenes from Nomad Tools.</p>
    <p style="margin:0;">Reply anytime — this inbox is real.</p>
  `);

  const text = [
    'Welcome to Nomad Tools',
    '',
    "Welcome aboard. You'll be the first to hear about new products, updates, and behind-the-scenes from Nomad Tools.",
    '',
    'Reply anytime — this inbox is real.',
    '',
    '— Nomad Tools · nomadtools.us',
  ].join('\n');

  return {
    subject: 'Welcome to Nomad Tools',
    html,
    text,
  };
}
