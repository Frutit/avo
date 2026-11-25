import { environmentContext } from "../context";
import { handleD1AccountMe } from "@/lib/sync/d1-routes";
import type { Route } from "./+types/me";

export function loader({ request, context }: Route.LoaderArgs) {
  return handleD1AccountMe(request, context.get(environmentContext));
}
