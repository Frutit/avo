import { describe, expect, it } from "vitest";
import type { Task, TaskInput } from "./types";
import { buildTaskOrder, reorderTaskOrder, sortTasksForDisplay } from "./task-order";
import { NOW, taskInput } from "@/tests/fixtures";

function task(id: string, patch: Partial<TaskInput> = {}): Task {
  return {
    ...taskInput(patch),
    id,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };
}

describe("orden visual del editor", () => {
  it("inicializa cada sección con el orden anterior de hora y título", () => {
    const tasks = [
      task("late", { title: "Tarde", window: { start: "10:00", end: "12:00" } }),
      task("early", { title: "Temprano", window: { start: "06:00", end: "07:00" } }),
      task("no-time", { title: "Sin hora" }),
    ];
    const order = buildTaskOrder(tasks);
    expect(order.late).toBe(1);
    expect(order.early).toBe(0);
    expect(order["no-time"]).toBe(0);
    expect(
      sortTasksForDisplay(
        tasks.filter((item) => item.window),
        order,
      ).map((item) => item.id),
    ).toEqual(["early", "late"]);
  });

  it("agrega tareas nuevas al final sin mover las ya ordenadas", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const order = buildTaskOrder(tasks, { a: 8, b: 9 });
    expect(order).toEqual({ a: 8, b: 9, c: 10 });
  });

  it("reordena dentro de una sección y deja las tareas ocultas en su lugar", () => {
    const tasks = [
      task("a", { title: "A" }),
      task("hidden", { title: "H" }),
      task("b", { title: "B" }),
      task("c", { title: "C" }),
    ];
    const order = { a: 0, hidden: 1, b: 2, c: 3 };
    const down = reorderTaskOrder(tasks, ["a", "b", "c"], "a", "c", order);
    expect(sortTasksForDisplay(tasks, down).map((item) => item.id)).toEqual(["hidden", "b", "c", "a"]);
    const up = reorderTaskOrder(tasks, ["a", "b", "c"], "c", "a", order);
    expect(sortTasksForDisplay(tasks, up).map((item) => item.id)).toEqual(["c", "a", "hidden", "b"]);
  });

  it("no cruza secciones", () => {
    const tasks = [task("morning", { window: { start: "06:00", end: "07:00" } }), task("any")];
    const order = { morning: 0, any: 0 };
    expect(reorderTaskOrder(tasks, ["morning", "any"], "morning", "any", order)).toBe(order);
  });

  it("respeta el orden de creación antes que el alfabético cuando empatan hora e importancia", () => {
    const cook = { ...task("cook", { title: "Preparar comida", priority: 2 }), createdAt: NOW };
    const serve = { ...task("serve", { title: "Acomodar platos", priority: 2 }), createdAt: NOW + 1000 };
    const order = buildTaskOrder([serve, cook]);
    expect(sortTasksForDisplay([serve, cook], order).map((item) => item.id)).toEqual(["cook", "serve"]);
  });

  it("reordenar una sección no congela índices en otras secciones no tocadas", () => {
    const m1 = task("m1", { title: "Bañarme", window: { start: "05:00", end: "12:00" } });
    const m2 = task("m2", { title: "Cambiarme", window: { start: "05:00", end: "12:00" } });
    const a1 = task("a1", { title: "Comer", window: { start: "12:00", end: "19:00" } });
    const a2 = task("a2", { title: "Hacer de comer", window: { start: "12:00", end: "19:00" } });

    const next = reorderTaskOrder([m1, m2, a1, a2], ["m1", "m2"], "m2", "m1", {});
    expect(next).toEqual({ m2: 0, m1: 1 });
    expect(next.a1).toBeUndefined();
    expect(next.a2).toBeUndefined();
  });
});
