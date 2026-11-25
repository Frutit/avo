import type { Route } from "./+types/sitemap";

export function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  const urls = ["/", "/privacy", "/data-deletion"]
    .map((path) => `<url><loc>${origin}${path}</loc></url>`)
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    },
  );
}
