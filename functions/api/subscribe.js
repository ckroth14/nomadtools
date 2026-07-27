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

  const { email, list, source, reason, website, details } = body || {};

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

  // Extra form fields (name, company, phone, battery, use case, quantity,
  // notes, …) arrive as a { key: value } object and get stored as a JSON
  // blob in the details column. Sanitize to string values only, capped.
  let detailsJson = null;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const clean = {};
    for (const key of Object.keys(details).slice(0, 30)) {
      const val = details[key];
      if (typeof val === 'string' && val.trim()) {
        clean[String(key).slice(0, 60)] = val.trim().slice(0, 500);
      }
    }
    if (Object.keys(clean).length) {
      detailsJson = JSON.stringify(clean).slice(0, 4000);
    }
  }

  if (!env.DB) {
    console.error('D1 binding "DB" is not configured for this environment.');
    return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO signups (email, list, source, referral_reason, ip_country, details)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email, list) DO UPDATE SET
         details = COALESCE(excluded.details, signups.details),
         source = COALESCE(excluded.source, signups.source)`
    )
      .bind(cleanEmail, list, cleanSource, cleanReason, ipCountry, detailsJson)
      .run();
  } catch (err) {
    console.error('D1 insert failed:', err);
    return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500);
  }

  // Best-effort sends. Row is already saved, so a bounce/API hiccup here
  // never turns into a lost signup.
  if (env.RESEND_API_KEY) {
    // 1) Notify the team of the new lead — sent to info@nomadtools.us with
    //    the full submission. This is the important one for follow-up.
    try {
      await sendAdminNotification(env, cleanEmail, list, cleanSource, ipCountry, detailsJson);
    } catch (err) {
      console.error('Admin notification failed:', err);
    }
    // 2) Confirmation/welcome email to the person who signed up.
    try {
      await sendConfirmationEmail(env, cleanEmail, list);
    } catch (err) {
      console.error('Confirmation email failed:', err);
    }
  } else {
    console.error('RESEND_API_KEY is not set — skipping emails.');
  }

  return jsonResponse({ ok: true }, 200);
}

// Emails info@nomadtools.us for every signup so the team is notified of new
// leads in real time. Includes all captured form fields, and sets reply_to
// to the signer so a reply goes straight back to them.
async function sendAdminNotification(env, email, list, source, ipCountry, detailsJson) {
  let details = {};
  if (detailsJson) {
    try { details = JSON.parse(detailsJson) || {}; } catch (e) { details = {}; }
  }

  const labels = {
    full_name: 'Full name',
    company: 'Company / Crew',
    phone: 'Phone',
    battery: 'Battery platform',
    use_case: 'Primary use case',
    quantity: 'Quantity',
    notes: 'Notes',
  };
  const order = ['full_name', 'company', 'phone', 'battery', 'use_case', 'quantity', 'notes'];
  const keys = order.filter((k) => details[k]).concat(
    Object.keys(details).filter((k) => !order.includes(k))
  );

  const detailRows = keys.map((k) =>
    `<tr><td style="padding:6px 16px 6px 0; color:#666; white-space:nowrap; vertical-align:top; font-size:13px;">${escHtml(labels[k] || k)}</td>` +
    `<td style="padding:6px 0; color:#1a1a1a; font-size:14px;">${escHtml(details[k])}</td></tr>`
  ).join('');

  const metaRows =
    `<tr><td style="padding:6px 16px 6px 0; color:#666; white-space:nowrap; font-size:13px;">Email</td><td style="padding:6px 0; font-size:14px;"><a href="mailto:${escHtml(email)}">${escHtml(email)}</a></td></tr>` +
    `<tr><td style="padding:6px 16px 6px 0; color:#666; white-space:nowrap; font-size:13px;">List</td><td style="padding:6px 0; color:#1a1a1a; font-size:14px;">${escHtml(list)}</td></tr>` +
    (source ? `<tr><td style="padding:6px 16px 6px 0; color:#666; white-space:nowrap; font-size:13px;">Source</td><td style="padding:6px 0; color:#1a1a1a; font-size:14px;">${escHtml(source)}</td></tr>` : '') +
    (ipCountry ? `<tr><td style="padding:6px 16px 6px 0; color:#666; white-space:nowrap; font-size:13px;">Country</td><td style="padding:6px 0; color:#1a1a1a; font-size:14px;">${escHtml(ipCountry)}</td></tr>` : '');

  const heading = list === 'waitlist' ? 'New waitlist signup' : 'New membership signup';
  const nameSuffix = details.full_name ? ` — ${details.full_name}` : '';
  const subject = `${heading}${nameSuffix} (${email})`;

  const html = emailShell(`
    <h1 style="margin:0 0 16px; font-size:20px; color:#1a1a1a;">${escHtml(heading)}</h1>
    <table style="border-collapse:collapse; width:100%;">${metaRows}${detailRows}</table>
  `);

  const textLines = [heading, '', `Email: ${email}`, `List: ${list}`];
  if (source) textLines.push(`Source: ${source}`);
  if (ipCountry) textLines.push(`Country: ${ipCountry}`);
  keys.forEach((k) => textLines.push(`${labels[k] || k}: ${details[k]}`));

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Nomad Tools <info@nomadtools.us>',
      to: 'info@nomadtools.us',
      reply_to: email,
      subject,
      html,
      text: textLines.join('\n'),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${detail}`);
  }
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
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

// Brand nav lockup: red "nomad" wordmark + red signal swirl, both on a solid
// black background. The email header band is black too, so the logos' baked
// backgrounds blend seamlessly (no visible box).
const LOGO_WORDMARK_URL = 'https://nomadtools.us/logo-nomad-text.png';
const LOGO_SIGNAL_URL = 'https://nomadtools.us/logo-signal.png';

function emailShell(bodyHtml) {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background:#f0f0f0; font-family: 'DM Sans', Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px; background:#ffffff; border-radius:6px; overflow:hidden;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#000000; padding:22px 32px; border-bottom:3px solid #E31E24;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;"><img src="${LOGO_WORDMARK_URL}" alt="nomad" height="26" style="display:block; border:0; outline:none;" /></td>
                    <td style="vertical-align:middle; padding-left:2px;"><img src="${LOGO_SIGNAL_URL}" alt="" height="32" style="display:block; border:0; outline:none;" /></td>
                  </tr>
                </table>
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
    <p style="margin:0 0 16px;">nomad.poe is a battery-powered PoE field tool — power and a gigabit network for your camera in one compact box, no AC required. Built for techs who do the work.</p>
    <p style="margin:0;">Questions? Just reply to this email.</p>
  `);

  const text = [
    "You're on the Nomad Tools wait list",
    '',
    "Thanks for joining the Nomad.PoE wait list. You're in line — we'll email this address the moment it's available to order.",
    '',
    'nomad.poe is a battery-powered PoE field tool — power and a gigabit network for your camera in one compact box, no AC required. Built for techs who do the work.',
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
