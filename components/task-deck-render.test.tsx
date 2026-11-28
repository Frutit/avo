import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import { TaskDeck } from "./task-deck";
import type { FranjaTask } from "./franja-task";
import es from "@/messages/es.json";
import en from "@/messages/en.json";

const tasks: FranjaTask[] = ["Bañarme", "Cepillarme los dientes", "Preparar mi mochila"].map(
  (title, index) => ({
    id: `task:${index}`,
    occurrenceId: `occurrence:${index}`,
    title,
    durationMin: 15,
    category: "personal",
    shortStepDone: false,
    remainingMin: 15,
    remainingRc: 15,
    block: "any",
    isMissed: false,
  }),
);

function renderDeck(locale: "es" | "en", count = 2) {
  const messages = locale === "es" ? es : en;
  return renderToStaticMarkup(
    <IntlProvider locale={locale} messages={messages} timeZone="America/Mexico_City">
      <TaskDeck
        tasks={tasks.slice(0, count)}
        handId="hand:test"
        busy={false}
        onOffer={() => undefined}
        onPromote={() => undefined}
        renderActions={(_task, { disabled, startButtonRef, ids }) => (
          <button
            ref={startButtonRef}
            disabled={disabled}
            aria-labelledby={`${ids.start} ${ids.title} ${ids.duration}`}
          >
            <span id={ids.start}>{messages.franja.start}</span>
          </button>
        )}
      />
    </IntlProvider>,
  );
}

describe("superficies persistentes de Hoy durante SSR", () => {
  it.each(["es", "en"] as const)(
    "renderiza una principal y una siguiente con etiquetas únicas sin tercera tarjeta oculta en %s",
    (locale) => {
      const html = renderDeck(locale, 3);
      const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
      const messages = locale === "es" ? es : en;
      expect(new Set(ids).size).toBe(ids.length);
      expect(html.match(/class="peek-card"/g)).toHaveLength(2);
      for (const role of ["front", "back"]) {
        expect(html.match(new RegExp(`data-deck-role="${role}"`, "g"))).toHaveLength(1);
      }
      expect(html).not.toContain('data-deck-role="hidden"');
      expect(html).toContain(messages.franja.eyebrow);
      expect(html).toContain(messages.franja.otherOption);
      expect(html).toContain(messages.franja.chooseTask);
      expect(html).toContain('data-has-alternative="true"');
    },
  );

  it("no reserva espacio para una alternativa inexistente", () => {
    const html = renderDeck("es", 1);
    expect(html.match(/class="peek-card"/g)).toHaveLength(1);
    expect(html).toContain('data-has-alternative="false"');
    expect(html).not.toContain('data-deck-role="back"');
  });
});
