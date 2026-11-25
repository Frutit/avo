import { siteUrl } from "@/lib/config/site";

export function publicPageMeta(location: { pathname: string }, title: string, description: string) {
  const { pathname } = location;
  const origin = siteUrl;
  const image = `${origin}/og/avo-share.png`;
  const alt = "Avo, un aguacate sonriente con reloj, junto a la frase «Retoma donde te quedaste».";
  const url = `${origin}${pathname === "/" ? "" : pathname}`;
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:site_name", content: "Avo" },
    { property: "og:locale", content: "es_MX" },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: alt },
  ];
}
