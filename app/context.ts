import { createContext } from "react-router";
import type { AccountD1Env } from "@/lib/sync/d1-routes";
export const environmentContext = createContext<AccountD1Env>();
