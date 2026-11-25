import { DataDeletionContent } from "@/components/data-deletion-content";
import { publicPageMeta } from "@/lib/platform/seo";
import type { Route } from "./+types/data-deletion";

export function meta({ location }: Route.MetaArgs) {
  return publicPageMeta(
    location,
    "Eliminación de datos | Avo",
    "Borra tus datos locales o solicita la eliminación de tu cuenta y tus datos de Avo.",
  );
}

export default function DataDeletion() {
  return <DataDeletionContent />;
}
