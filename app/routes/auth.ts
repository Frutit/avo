import { environmentContext } from "../context";
import { handleD1Auth } from "@/lib/sync/d1-routes";
import type { Route } from "./+types/auth";

export function loader({ request, context }: Route.LoaderArgs) {
  return handleD1Auth(request, context.get(environmentContext));
}

export function action({ request, context }: Route.ActionArgs) {
  return handleD1Auth(request, context.get(environmentContext));
}
