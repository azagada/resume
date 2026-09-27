# Aldo Zagada: résumé website

A one-page résumé site built with the [U.S. Web Design System (USWDS) 3](https://designsystem.digital.gov/), plus one small server function that emails you contact-form messages through Microsoft 365. It's designed to be hosted on [Cloudflare Pages](https://pages.cloudflare.com/).

## What's in this folder

```
site/                     everything visitors see
  index.html              the page
  assets/css/site.css     your styles and the hunter-green theme
  assets/js/site.js       print button, contact form, Turnstile, header highlighting
  assets/img/             family emblem and browser-tab icon
  assets/uswds/           USWDS files (managed by the update script)
functions/api/contact.js  the contact form's server code (never sent to visitors)
scripts/update-uswds.py   downloads and installs USWDS
.claude/launch.json       preview settings for Claude; safe to delete
```

## Preview it on your computer

From this folder, run:

```bash
python3 -m http.server 8000 --directory site
```

Then open <http://localhost:8000>. The contact form can't send from this preview, because its server code only runs on Cloudflare. Everything else works.

## Edit your content

Everything you'd change is in `site/index.html`, in the order it appears on the page:

- **Introduction:** headline, summary, and the "At a glance" box.
- **Experience:** one `<li>` per role, most recent first. `data-marker` sets the label on the timeline: `Now` for a current role, otherwise the year the role ended. Add the class `site-timeline__item--current` to roles you hold now; it fills in the marker.
- **Skills, Education, Get in touch:** plain lists you can add to or trim.
- **Footer:** change "Last updated" whenever you edit the page.

The family emblem in the header comes from `site/assets/img/Zagada_Family_Icon_Black.svg` and is drawn in the site's green. To use a new version, replace that file and keep the name. To change its color, edit `background-color` under `.site-logo__mark` in `site.css`.

## How the contact form works

1. A visitor fills in their name, email, subject, and message, and passes Cloudflare's Turnstile check.
2. The form sends everything to `functions/api/contact.js` on Cloudflare.
3. The function asks Cloudflare whether the Turnstile check was genuine, then asks Microsoft 365 to email you the message. The subject reads "Website message: …", and **Reply-To** is the visitor's address, so hitting Reply answers them directly.

Your email address, the Turnstile secret key, and the Microsoft credentials all live in Cloudflare's encrypted settings. None of them appears on the page.

## Set up the contact form

You'll do this once. It needs admin access to your Microsoft 365 account and a free Cloudflare account (you already have one for Turnstile).

### 1. Choose a mailbox to send from

The site sends mail *from* a mailbox in your Microsoft 365 account and delivers it *to* whatever address you choose. A good choice is a free **shared mailbox** such as `website@yourdomain.com`. Create it in the Microsoft 365 admin center under **Teams & groups → Shared mailboxes**. Shared mailboxes don't need a license.

### 2. Register the app in Microsoft Entra

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to **App registrations → New registration**. Name it "Resume website contact form", keep **Single tenant**, and register it.
2. From its **Overview** page, copy the **Application (client) ID** and **Directory (tenant) ID**.
3. Under **Certificates & secrets → New client secret**, add a secret and copy its **Value** right away; it's shown only once. Secrets expire (24 months at most), so put a reminder in your calendar to make a new one before then; the form stops sending when it expires.
4. **Don't** add Mail.Send under **API permissions**. Granted there, it would let the app send as *anyone* in your organization. Step 3 grants it for your one sending mailbox instead.

### 3. Allow the app to send from that one mailbox

This uses Exchange Online PowerShell ([Microsoft's guide](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)). You need the Exchange Administrator role.

First, get the IDs from the app's **enterprise application** page, not its app registration page. On the app registration's **Overview**, click the link next to **Managed application in local directory**. That opens the enterprise application. Copy its **Application ID** (the same as before) and its **Object ID**, which differs from the one on the app registration page. Exchange needs this second Object ID.

```powershell
Install-Module ExchangeOnlineManagement   # first time only
Connect-ExchangeOnline

# 1. Replace these three values with your own (IDs from the enterprise application page)
$appId    = "PASTE-APPLICATION-ID"
$objectId = "PASTE-OBJECT-ID"
$mailbox  = "website@yourdomain.com"

# 2. Then run this block. It changes nothing while a placeholder or malformed ID is left above.
$guid = '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
if ($appId -notmatch $guid -or $objectId -notmatch $guid -or $appId -eq $objectId -or $mailbox -like "*@yourdomain.com") {
    Write-Warning "Replace the three placeholder values first. Nothing was changed."
} else {
    New-ServicePrincipal -AppId $appId -ObjectId $objectId -DisplayName "Resume website contact form"
    New-ManagementScope -Name "Resume website sender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$mailbox'"
    New-ManagementRoleAssignment -Name "Resume website Mail.Send" -App "Resume website contact form" -Role "Application Mail.Send" -CustomResourceScope "Resume website sender"
    Test-ServicePrincipalAuthorization -Identity "Resume website contact form" -Resource $mailbox
}
```

In the test results, the Mail.Send line should say **InScope True**. Microsoft says changes can take 30 minutes to 2 hours to reach the live service.

To send from a different mailbox later, point the scope at it:

```powershell
Set-ManagementScope -Identity "Resume website sender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'new-address@yourdomain.com'"
```

To remove the app's permission entirely, run the following. If you created the permission before this README named it, look up its name with `Get-ManagementRoleAssignment -Role "Application Mail.Send"`.

```powershell
Remove-ManagementRoleAssignment -Identity "Resume website Mail.Send"
Remove-ManagementScope -Identity "Resume website sender"
Remove-ServicePrincipal -Identity "Resume website contact form"
```

### 4. Publish on Cloudflare Pages

Cloudflare only runs the form's server code for sites deployed from Git (or its command-line tool), not from drag-and-drop uploads.

1. Put this folder in a GitHub repository.
2. In the [Cloudflare dashboard](https://dash.cloudflare.com/), go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repository. Set **Build command** to nothing and **Build output directory** to `site`.
3. After the first deploy, open the project's **Settings → Variables and Secrets** and add these for Production. Mark the two secrets as **Secret**.

   | Name | Value |
   | --- | --- |
   | `TURNSTILE_SECRET` | Secret key from your Turnstile widget's settings |
   | `TURNSTILE_HOSTNAMES` | Where the site runs, comma-separated, e.g. `your-project.pages.dev,yourdomain.com,www.yourdomain.com` |
   | `GRAPH_TENANT_ID` | Directory (tenant) ID from step 2 |
   | `GRAPH_CLIENT_ID` | Application (client) ID from step 2 |
   | `GRAPH_CLIENT_SECRET` | Client secret value from step 2 |
   | `MAIL_SENDER` | The sending mailbox, e.g. `website@yourdomain.com` |
   | `MAIL_TO` | Where you want messages delivered (optional; defaults to `MAIL_SENDER`) |

4. Redeploy (under **Deployments**, retry the latest one) so the function picks up the settings.
5. In your Turnstile widget's **Hostname management**, add the same hostnames you listed in `TURNSTILE_HOSTNAMES`.
6. Send yourself a test message, then reply to it to confirm Reply-To goes to the address you typed.

### If a test message fails

The message on the form tells you where to look:

- **"The contact form isn't set up yet"**: a setting from step 4 is missing. Its name appears in the project's function logs (**Deployments → your deployment → Functions**).
- **"The security check didn't go through"**: `TURNSTILE_SECRET` is wrong, or the site's hostname is missing from `TURNSTILE_HOSTNAMES` or from the widget.
- **"Your message didn't send"**: Microsoft refused. In the function logs, "sign-in failed (HTTP 401)" means a wrong tenant ID, client ID, or secret. "sendMail failed (HTTP 403)" means step 3 hasn't taken effect yet, or `MAIL_SENDER` isn't the mailbox in the scope.

### Optional: test the function on your computer

This needs [Node.js](https://nodejs.org/). Put the settings in a file named `.dev.vars` in this folder (one `NAME=value` per line; `.gitignore` keeps it out of Git), then run `npx wrangler pages dev site`. Use Cloudflare's test keys so Turnstile passes locally: site key `1x00000000000000000000AA` and secret `1x0000000000000000000000000000000AA`.

## Print or save as PDF

The **Print or save as PDF** link in the "At a glance" box opens the print dialog. Choose "Save as PDF" to get a two-page résumé. The print layout hides the navigation, buttons, and form, and puts your LinkedIn and location under your name.

## Colors and styles

Your styles are in `site/assets/css/site.css`. The colors at the top are USWDS design tokens:

| Role | Token | Hex |
| --- | --- | --- |
| Buttons, links, labels | mint-60 | `#286846` |
| Name, headings, emblem, contact band | mint-70 | `#204e34` |
| Pressed buttons | mint-80 | `#193324` |
| Timeline line, skill tags | green-cool-10 | `#dbebde` |
| "At a glance" box | green-cool-5 | `#ecf3ec` |

The precompiled USWDS stylesheet ships in the default blue. The "Theme: hunter green" section of `site.css` switches the components this page uses to green. If you add other USWDS components later, check whether they need the same treatment.

Keep USWDS's "An official website of the United States government" banner and the "identifier" footer off this site. They're only for federal websites.

## Update USWDS

USWDS lives in `site/assets/uswds/`: only the 54 files this site needs, copied from the official npm package. To upgrade, run:

```bash
python3 scripts/update-uswds.py
```

The script downloads the newest 3.x release, checks it against the registry's checksum, and replaces `site/assets/uswds/`. Don't edit files in that folder; your changes would be overwritten. The installed version is in `site/assets/uswds/VERSION`.
