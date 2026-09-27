/*
  Contact form handler. worker/index.js sends POST /api/contact requests here.

  1. Checks the form fields.
  2. Asks Cloudflare whether the visitor passed the Turnstile check.
  3. Emails the message to you through Microsoft Graph, with Reply-To set to the
     visitor so you can answer them directly.

  Settings live in the Cloudflare dashboard (your Worker → Settings → Variables
  and Secrets), never in this file. See README.md for how to create them.

    TURNSTILE_SECRET     Turnstile widget secret key (store as a secret)
    TURNSTILE_HOSTNAMES  Comma-separated hostnames the form runs on,
                         e.g. "example.com,www.example.com,resume.example.workers.dev"
    GRAPH_TENANT_ID      Microsoft Entra directory (tenant) ID
    GRAPH_CLIENT_ID      App registration's application (client) ID
    GRAPH_CLIENT_SECRET  App registration's client secret (store as a secret)
    MAIL_SENDER          Mailbox the app sends from, e.g. "website@example.com"
    MAIL_TO              Where messages are delivered (optional; defaults to MAIL_SENDER)
*/

const REQUIRED_SETTINGS = [
  "TURNSTILE_SECRET",
  "TURNSTILE_HOSTNAMES",
  "GRAPH_TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "MAIL_SENDER",
];
const MAX_LENGTH = { name: 100, email: 254, subject: 150, message: 5000 };
const TURNSTILE_ACTION = "contact"; // must match the action in site/assets/js/site.js

export async function handleContact(request, env) {
  const missing = REQUIRED_SETTINGS.filter((key) => !env[key]);
  if (missing.length) {
    console.error(`Contact form: missing settings ${missing.join(", ")}`);
    return reply(500, "The contact form isn't set up yet. Reach me on LinkedIn instead.");
  }

  if (Number(request.headers.get("Content-Length")) > 20_000) {
    return reply(413, "Your message is too long. Shorten it and try again.");
  }

  let fields;
  try {
    fields = await request.json();
  } catch {
    return reply(400, "Something went wrong with the form. Refresh the page and try again.");
  }

  // Spam trap: people never see this checkbox, so a ticked one means a bot. Pretend it worked.
  if (fields.botcheck) return reply(200);

  const name = singleLine(fields.name, MAX_LENGTH.name);
  const email = singleLine(fields.email, MAX_LENGTH.email);
  const subject = singleLine(fields.subject, MAX_LENGTH.subject);
  const message = typeof fields.message === "string" ? fields.message.trim() : "";
  if (!name || !email || !subject || !message) {
    return reply(400, "Fill in every field, then send your message.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply(400, "Enter a valid email address so I can reply to you.");
  }
  if (message.length > MAX_LENGTH.message) {
    return reply(400, `Keep your message under ${MAX_LENGTH.message.toLocaleString("en-US")} characters.`);
  }

  if (!(await passedTurnstile(fields["cf-turnstile-response"], request, env))) {
    return reply(403, "The security check didn't go through. Complete it again, then send your message.");
  }

  try {
    await sendMail(env, { name, email, subject, message, site: new URL(request.url).hostname });
  } catch (error) {
    // Log what failed, but never the visitor's details or message
    console.error(`Contact form: ${error.message}`);
    return reply(502, "Your message didn't send. Try again later, or reach me on LinkedIn.");
  }

  return reply(200);
}

function reply(status, error) {
  const body = status === 200 ? { ok: true } : { ok: false, error };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Trim, cap the length, and remove line breaks so a value can't break out of an email subject
function singleLine(value, maxLength) {
  return typeof value === "string" ? value.replace(/\s*[\r\n]+\s*/g, " ").trim().slice(0, maxLength) : "";
}

// Turnstile tokens prove a person passed the check on this site. Cloudflare's
// siteverify says whether the token is genuine, unused, and from which page.
async function passedTurnstile(token, request, env) {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;

  const allowedHostnames = env.TURNSTILE_HOSTNAMES.split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean);

  const params = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const visitorIp = request.headers.get("CF-Connecting-IP");
  if (visitorIp) params.set("remoteip", visitorIp);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return (
      result.success === true &&
      result.action === TURNSTILE_ACTION &&
      allowedHostnames.includes(result.hostname)
    );
  } catch {
    return false;
  }
}

async function sendMail(env, { name, email, subject, message, site }) {
  // An app-only access token for Microsoft Graph (client credentials flow)
  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(env.GRAPH_TENANT_ID)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GRAPH_CLIENT_ID,
        client_secret: env.GRAPH_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!tokenResponse.ok) throw new Error(`Microsoft sign-in failed (HTTP ${tokenResponse.status})`);
  const { access_token: accessToken } = await tokenResponse.json();

  const recipient = env.MAIL_TO || env.MAIL_SENDER;
  const mailResponse = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MAIL_SENDER)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: `Website message: ${subject}`,
          body: {
            contentType: "Text",
            content: [
              `${name} <${email}> sent you a message from ${site}:`,
              "",
              message,
              "",
              "—",
              `Reply to this email to answer ${name} directly.`,
            ].join("\n"),
          },
          toRecipients: [{ emailAddress: { address: recipient } }],
          replyTo: [{ emailAddress: { address: email, name } }],
        },
        saveToSentItems: false,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  // Graph answers 202 Accepted when it has taken the message for delivery
  if (mailResponse.status !== 202) throw new Error(`Microsoft Graph sendMail failed (HTTP ${mailResponse.status})`);
}
