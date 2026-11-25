import { environmentContext } from "../context";
import { handleD1AccountData } from "@/lib/sync/d1-routes";
import type { Route } from "./+types/data";

export function loader({ request, context }: Route.LoaderArgs) {
  return handleD1AccountData(request, context.get(environmentContext));
}

export function action({ request, context }: Route.ActionArgs) {
  return handleD1AccountData(request, context.get(environmentContext));
}
