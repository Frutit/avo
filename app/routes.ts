import { type RouteConfig, index, route } from "@react-router/dev/routes";
export default [
  index("routes/home.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("data-deletion", "routes/data-deletion.tsx"),
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("api/auth/*", "routes/auth.ts"),
  route("api/account/me", "routes/me.ts"),
  route("api/account/data", "routes/data.ts"),
] satisfies RouteConfig;
