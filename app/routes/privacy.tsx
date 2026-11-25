import { PrivacyContent } from "@/components/privacy-content";
import { publicPageMeta } from "@/lib/platform/seo";
import type { Route } from "./+types/privacy";

export function meta({ location }: Route.MetaArgs) {
  return publicPageMeta(
    location,
    "Aviso de privacidad | Avo",
    "Cómo Avo usa y protege tus datos, y cómo solicitar su eliminación.",
  );
}

export default function Privacy() {
  return <PrivacyContent />;
}
