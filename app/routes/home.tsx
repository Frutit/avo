import { RunoHome } from "@/components/runo-home";
import { AccountWorkspace } from "@/components/account-workspace";
import { StartupLoadingProvider } from "@/components/startup-loading-provider";
import { publicPageMeta } from "@/lib/platform/seo";
import type { Route } from "./+types/home";

export function meta({ location }: Route.MetaArgs) {
  return publicPageMeta(location, "Avo", "Hábitos, pendientes y tiempo para ti.");
}

export default function Home() {
  return (
    <StartupLoadingProvider>
      <AccountWorkspace>
        <RunoHome />
      </AccountWorkspace>
    </StartupLoadingProvider>
  );
}
