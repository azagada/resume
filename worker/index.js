/*
  The site's Cloudflare Worker. Cloudflare serves the files in site/ on its own;
  only requests under /api/ reach this code (see wrangler.jsonc).
*/
import { handleContact } from "./contact.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/contact") {
      if (request.method === "POST") return handleContact(request, env);
      return new Response("Use POST to send a message.", { status: 405, headers: { Allow: "POST" } });
    }

    return new Response("Not found", { status: 404 });
  },
};
