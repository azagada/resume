/*
  Small enhancements on top of USWDS. Most of the page works without them, and the
  browser's own Print command still produces the résumé layout. The contact form
  needs this script, because its spam check (Cloudflare Turnstile) runs in JavaScript.
*/
(() => {
  "use strict";

  // "Print or save as PDF" needs JavaScript to open the print dialog, so it starts hidden.
  document.querySelectorAll("[data-print]").forEach((item) => {
    item.hidden = false;
    item.querySelector("button").addEventListener("click", () => window.print());
  });

  // On paper, contact details belong under the name, so copy them there for printing.
  const contactList = document.querySelector(".site-contact__list");
  const printContact = document.querySelector("[data-print-contact]");
  if (contactList && printContact) {
    printContact.append(contactList.cloneNode(true));
  }

  // Send the contact form to functions/api/contact.js without leaving the page.
  const form = document.querySelector("[data-contact-form]");
  if (form) {
    const status = form.querySelector("[data-form-status]");
    const button = form.querySelector('button[type="submit"]');
    const buttonLabel = button.textContent;
    let sending = false;

    // Cloudflare Turnstile stays off while index.html has the placeholder site key.
    const turnstileBox = form.querySelector("[data-turnstile]");
    const turnstileKey = turnstileBox?.dataset.sitekey;
    const turnstileOn = Boolean(turnstileKey) && turnstileKey !== "YOUR_TURNSTILE_SITE_KEY";
    let turnstileId;
    if (turnstileOn) {
      turnstileBox.hidden = false;
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.addEventListener("load", () => {
        turnstileId = window.turnstile.render(turnstileBox, {
          sitekey: turnstileKey,
          action: "contact",
          theme: "light",
          // The flexible widget needs at least 300px; narrow phones get the compact one
          size: turnstileBox.clientWidth < 300 ? "compact" : "flexible",
        });
      });
      document.head.append(script);
    }

    const showStatus = (type, message) => {
      const alert = document.createElement("div");
      alert.className = `usa-alert usa-alert--${type} usa-alert--slim`;
      const body = document.createElement("div");
      body.className = "usa-alert__body";
      const text = document.createElement("p");
      text.className = "usa-alert__text";
      text.textContent = message;
      body.append(text);
      alert.append(body);
      status.replaceChildren(alert);
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (sending) return;

      if (turnstileOn && !form.elements["cf-turnstile-response"]?.value) {
        // If an ad blocker or network problem stopped Turnstile from loading, there's no check to complete
        showStatus(
          "error",
          window.turnstile
            ? "Complete the security check above the button, then send your message."
            : "The security check didn't load, so this form can't send. Refresh the page, or reach me on LinkedIn.",
        );
        return;
      }

      sending = true;
      button.setAttribute("aria-disabled", "true");
      button.textContent = "Sending…";
      try {
        const response = await fetch(form.action, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        const result = await response.json().catch(() => null);
        if (result?.ok) {
          form.reset();
          showStatus("success", "Message sent. Thanks for reaching out; I'll reply by email.");
        } else if (result?.error) {
          // functions/api/contact.js explains what to fix
          showStatus("error", result.error);
        } else if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
          showStatus("error", "The form's email function only runs on Cloudflare, so it can't send from this local preview.");
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch {
        showStatus("error", "Your message didn't send. Try again, or reach me on LinkedIn.");
      } finally {
        sending = false;
        button.removeAttribute("aria-disabled");
        button.textContent = buttonLabel;
        // Each Turnstile token works only once, so fetch a fresh one for the next message
        if (turnstileId !== undefined) window.turnstile.reset(turnstileId);
      }
    });
  }

  // Underline the header link for the section that's on screen.
  const links = [...document.querySelectorAll('.usa-nav__primary a[href^="#"]')];
  const sections = links
    .map((link) => document.getElementById(link.hash.slice(1)))
    .filter(Boolean);
  if (!sections.length) return;

  const highlightCurrentSection = () => {
    // The current section is the last one whose top has passed 40% of the way down the screen.
    let current = sections
      .filter((section) => section.getBoundingClientRect().top <= window.innerHeight * 0.4)
      .pop();

    // Sections near the end can't scroll that far up. At the bottom of the page, choose
    // the section you just jumped to if it's in view, or else the last section.
    const page = document.documentElement;
    if (window.scrollY + window.innerHeight >= page.scrollHeight - 2) {
      const target = sections.find((section) => `#${section.id}` === window.location.hash);
      current = target && target.getBoundingClientRect().top >= 0 ? target : sections[sections.length - 1];
    }

    links.forEach((link) => {
      link.classList.toggle("usa-current", Boolean(current) && link.hash === `#${current.id}`);
    });
  };

  let queued = false;
  const queueHighlight = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      highlightCurrentSection();
    });
  };
  window.addEventListener("scroll", queueHighlight, { passive: true });
  window.addEventListener("resize", queueHighlight, { passive: true });
  window.addEventListener("hashchange", queueHighlight);
  highlightCurrentSection();
})();
