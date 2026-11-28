import { describe, expect, it, vi } from "vitest";
import {
  availabilityOf,
  chooseNextTask,
  eligibleCandidates,
  isMissedOccurrence,
  proposeHand,
} from "./selection";
import { occurrenceIdFor } from "./occurrence";
import type { Occurrence, Routine, Task, TaskInput } from "./types";
import { validateTaskInput } from "./validation";
import { MONDAY, NOW, taskInput } from "@/tests/fixtures";

function task(id: string, patch: Partial<TaskInput> = {}): Task {
  return {
    ...validateTaskInput(taskInput(patch)),
    id,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };
}
function occurrence(t: Task, patch: Partial<Occurrence> = {}): Occurrence {
  return {
    id: occurrenceIdFor(t.id, MONDAY),
    taskId: t.id,
    date: MONDAY,
    status: "pending",
    timerElapsedSec: 0,
    creditedRc: 0,
    shortStepCompleted: false,
    agreement: null,
    anchorPresentedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}
function at(hour: number, minute = 0) {
  return new Date(2026, 9, 26, hour, minute).getTime();
}

describe("elegibilidad antes de prioridad", () => {
  it("propone proyecto A el lunes y B el martes", () => {
    const tasks = [task("A", { days: [1] }), task("B", { days: [2] })];
    expect(proposeHand({ tasks, occurrences: [], now: NOW, seed: "s" }).map((c) => c.task.id)).toEqual(["A"]);
    expect(
      proposeHand({ tasks, occurrences: [], now: new Date(2026, 9, 27, 8).getTime(), seed: "s" }).map(
        (c) => c.task.id,
      ),
    ).toEqual(["B"]);
  });

  it("excluye archivadas y plantillas sin programación", () => {
    const archived = { ...task("old"), archivedAt: NOW };
    const draft: Task = { ...task("care", { priority: 3 }), days: [] };
    expect(proposeHand({ tasks: [archived, draft], occurrences: [], now: NOW, seed: "s" })).toEqual([]);
  });

  it("prefiere una tarea con horario activo sobre una sin hora, y al vencer su ventana pasa después de las vigentes", () => {
    const coffee = task("coffee", {
      priority: 3,
      window: { start: "06:00", end: "12:00" },
    });
    const vitamins = task("vitamins", { priority: 3 });
    expect(
      chooseNextTask({
        tasks: [vitamins, coffee],
        occurrences: [],
        now: at(9, 21),
        seed: "s",
      })!.task.id,
    ).toBe("coffee");
    const afterNoon = eligibleCandidates({
      tasks: [vitamins, coffee],
      occurrences: [],
      now: at(12),
      seed: "s",
    });
    expect(afterNoon.map((c) => [c.task.id, c.isMissed])).toEqual([
      ["vitamins", false],
      ["coffee", true],
    ]);
  });

  it("trata la franja como inicio incluido y fin excluido", () => {
    const breakfast = task("breakfast", { window: { start: "06:00", end: "12:00" } });
    expect(availabilityOf(breakfast, undefined, at(5, 59)).eligible).toBe(false);
    expect(availabilityOf(breakfast, undefined, at(6)).eligible).toBe(true);
    expect(availabilityOf(breakfast, undefined, at(11, 59)).eligible).toBe(true);
    expect(availabilityOf(breakfast, undefined, at(12)).eligible).toBe(false);
  });

  it("nunca consume una hora fija antes de llegar, aun sin franja", () => {
    const gym = task("gym", { fixedTime: "18:00", priority: 3 });
    expect(availabilityOf(gym, undefined, at(17, 59))).toEqual({
      eligible: false,
      reason: "before_fixed_time",
    });
    expect(availabilityOf(gym, undefined, at(18))).toEqual({ eligible: true, isDueAnchor: true });
  });

  it("muestra primero la tarea sin hora vigente y deja el desayuno missed disponible después", () => {
    const tasks = [
      task("breakfast", { priority: 3, window: { start: "06:00", end: "12:00" } }),
      task("home", { priority: 1 }),
    ];
    const ranked = eligibleCandidates({ tasks, occurrences: [], now: at(20), seed: "s" });
    expect(ranked.map((c) => [c.task.id, c.isMissed])).toEqual([
      ["home", false],
      ["breakfast", true],
    ]);
  });

  it.each(["completed", "already_done", "not_applicable", "in_progress"] as const)(
    "excluye ocurrencias %s",
    (status) => {
      const t = task("t");
      expect(
        proposeHand({ tasks: [t], occurrences: [occurrence(t, { status })], now: NOW, seed: "s" }),
      ).toEqual([]);
    },
  );

  it("conserva una tarea parcial elegible", () => {
    const t = task("t");
    expect(availabilityOf(t, occurrence(t, { status: "partial" }), NOW).eligible).toBe(true);
  });

  it("completar un día anterior no borra la ocurrencia de hoy", () => {
    const t = task("t");
    const yesterday = occurrence(t, { date: "2026-10-25", status: "completed" });
    expect(availabilityOf(t, yesterday, NOW).eligible).toBe(true);
  });

  it("no fuerza una ancla cuya franja ya venció", () => {
    const gym = task("gym", { fixedTime: "18:00", window: { start: "18:00", end: "18:30" } });
    expect(availabilityOf(gym, undefined, at(18, 30))).toEqual({ eligible: false, reason: "outside_window" });
  });

  it("respeta el snapshot de una ocurrencia empezada al editar la plantilla", () => {
    const original = task("t");
    const edited = task("t", { title: "Otra", durationMin: 30, window: { start: "18:00", end: "20:00" } });
    const partial = occurrence(original, {
      status: "partial",
      agreement: { task: original, rewardCapRc: 15, shortStepRc: 1, lockedAt: NOW },
    });
    const next = chooseNextTask({ tasks: [edited], occurrences: [partial], now: NOW, seed: "s" });
    expect(next!.task.title).toBe("Lavar ropa");
    expect(next!.task.durationMin).toBe(15);
  });
});

describe("progresión de rutinas", () => {
  const prepare = task("prepare", { window: { start: "06:00", end: "12:00" } });
  const eat = task("eat", { window: { start: "12:00", end: "18:00" } });
  const unrelated = task("unrelated", { priority: 3 });
  const routine: Routine = {
    id: "routine:meal",
    title: "Comida",
    taskIds: [prepare.id, eat.id],
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };

  it("ofrece solo el paso actual y muestra su posición", () => {
    const candidates = eligibleCandidates({
      tasks: [prepare, eat, unrelated],
      occurrences: [],
      routines: [routine],
      now: at(9),
      seed: "s",
    });
    expect(candidates.map((candidate) => candidate.task.id)).toContain(prepare.id);
    expect(candidates[0]?.task.id).toBe(prepare.id);
    expect(candidates.map((candidate) => candidate.task.id)).not.toContain(eat.id);
    expect(candidates.find((candidate) => candidate.task.id === prepare.id)?.routine).toEqual({
      id: routine.id,
      title: "Comida",
      step: 1,
      total: 2,
    });
  });

  it("espera el horario del paso actual sin mostrar pasos posteriores y deja usar otros hábitos", () => {
    const latePrepare = task("late-prepare", { window: { start: "14:00", end: "15:00" } });
    const next = task("next", { window: { start: "08:00", end: "18:00" } });
    const group: Routine = { ...routine, taskIds: [latePrepare.id, next.id] };
    const candidates = eligibleCandidates({
      tasks: [latePrepare, next, unrelated],
      occurrences: [],
      routines: [group],
      now: at(9),
      seed: "s",
    });
    expect(candidates.map((candidate) => candidate.task.id)).toEqual([unrelated.id]);
  });

  it("avanza después de completar o saltar un paso, y mantiene una demora como missed", () => {
    const completed = occurrence(prepare, { status: "completed" });
    expect(
      chooseNextTask({
        tasks: [prepare, eat, unrelated],
        occurrences: [completed],
        routines: [routine],
        now: at(13),
        seed: "s",
      }),
    ).toMatchObject({ task: { id: eat.id }, routine: { step: 2, total: 2 } });

    const skipped = occurrence(prepare, { status: "not_applicable" });
    expect(
      chooseNextTask({
        tasks: [prepare, eat, unrelated],
        occurrences: [skipped],
        routines: [routine],
        now: at(13),
        seed: "s",
      })?.task.id,
    ).toBe(eat.id);

    const delayed = eligibleCandidates({
      tasks: [prepare, eat, unrelated],
      occurrences: [],
      routines: [routine],
      now: at(13),
      seed: "s",
    });
    expect(delayed.map((c) => c.task.id)).toEqual([unrelated.id, prepare.id]);
    expect(delayed[1]).toMatchObject({ task: { id: prepare.id }, isMissed: true, routine: { step: 1 } });
  });

  it("no muestra pasos de una rutina ya terminada ni una rutina archivada", () => {
    const complete = [
      occurrence(prepare, { status: "completed" }),
      occurrence(eat, { status: "already_done" }),
    ];
    expect(
      proposeHand({
        tasks: [prepare, eat],
        occurrences: complete,
        routines: [routine],
        now: at(13),
        seed: "s",
      }),
    ).toEqual([]);
    expect(
      proposeHand({
        tasks: [prepare, eat],
        occurrences: [],
        routines: [{ ...routine, archivedAt: NOW }],
        now: at(13),
        seed: "s",
      }),
    ).toHaveLength(2);
  });

  it("permite pasos con distintos días y avanza solo entre los pasos programados hoy", () => {
    const weekdayCook = task("cook", { days: [1, 2, 3, 4, 5], window: { start: "12:00", end: "19:00" } });
    const dailyServe = task("serve", {
      days: [0, 1, 2, 3, 4, 5, 6],
      window: { start: "12:00", end: "19:00" },
    });
    const dailyWash = task("wash", { days: [0, 1, 2, 3, 4, 5, 6], window: { start: "12:00", end: "19:00" } });
    const flexibleRoutine: Routine = {
      ...routine,
      taskIds: [weekdayCook.id, dailyServe.id, dailyWash.id],
    };

    const monday = chooseNextTask({
      tasks: [weekdayCook, dailyServe, dailyWash],
      occurrences: [],
      routines: [flexibleRoutine],
      now: at(14),
    });
    expect(monday).toMatchObject({
      task: { id: "cook" },
      routine: { step: 1, total: 3 },
    });

    const sundayAfternoon = new Date(2026, 9, 25, 14, 0).getTime();
    const sunday = chooseNextTask({
      tasks: [weekdayCook, dailyServe, dailyWash],
      occurrences: [],
      routines: [flexibleRoutine],
      now: sundayAfternoon,
    });
    expect(sunday).toMatchObject({
      task: { id: "serve" },
      routine: { step: 1, total: 2 },
    });
  });

  it("prioriza una rutina ya empezada hoy por encima de otra rutina en paso 1", () => {
    const r1Step1 = task("r1-1");
    const r1Step2 = task("r1-2");
    const r2Step1 = task("r2-1");
    const r2Step2 = task("r2-2");
    const firstRoutine: Routine = {
      ...routine,
      id: "r1",
      title: "Primera",
      taskIds: [r1Step1.id, r1Step2.id],
    };
    const secondRoutine: Routine = {
      ...routine,
      id: "r2",
      title: "Segunda",
      taskIds: [r2Step1.id, r2Step2.id],
    };

    const next = chooseNextTask({
      tasks: [r1Step1, r1Step2, r2Step1, r2Step2],
      occurrences: [occurrence(r2Step1, { status: "completed" })],
      routines: [firstRoutine, secondRoutine],
      now: NOW,
    });
    expect(next).toMatchObject({
      task: { id: "r2-2" },
      routine: { id: "r2", step: 2, total: 2 },
    });
  });
});

describe("tareas missed", () => {
  const coffee = task("coffee", {
    priority: 3,
    window: { start: "06:00", end: "12:00" },
  });

  it("marca missed justo al cerrar la ventana y no antes", () => {
    expect(isMissedOccurrence(coffee, undefined, at(11, 59))).toBe(false);
    expect(isMissedOccurrence(coffee, undefined, at(12))).toBe(true);
    expect(isMissedOccurrence(coffee, occurrence(coffee), at(13))).toBe(true);
  });

  it("no marca una ocurrencia terminal o en progreso", () => {
    expect(isMissedOccurrence(coffee, occurrence(coffee, { status: "completed" }), at(13))).toBe(false);
    expect(isMissedOccurrence(coffee, occurrence(coffee, { status: "not_applicable" }), at(13))).toBe(false);
    expect(isMissedOccurrence(coffee, occurrence(coffee, { status: "in_progress" }), at(13))).toBe(false);
  });

  it("no bloquea tareas vigentes con tareas missed de un bloque anterior", () => {
    const urgentAnyTime = task("urgent", { priority: 3 });
    const missedMorning = task("low", {
      priority: 1,
      window: { start: "06:00", end: "12:00" },
    });
    const ranked = eligibleCandidates({
      tasks: [urgentAnyTime, missedMorning],
      occurrences: [],
      now: at(13),
      seed: "s",
    });
    expect(ranked.map((c) => [c.task.id, c.isMissed])).toEqual([
      ["urgent", false],
      ["low", true],
    ]);
  });

  it("prioriza la ventana activa y luego sin hora antes que las tareas missed de la mañana", () => {
    const lunch = task("lunch", {
      priority: 2,
      window: { start: "12:00", end: "19:00" },
    });
    const missed = task("missed", {
      priority: 2,
      window: { start: "06:00", end: "12:00" },
    });
    const noTime = task("no-time", { priority: 2 });
    expect(
      eligibleCandidates({
        tasks: [noTime, lunch, missed],
        occurrences: [],
        now: at(13),
        seed: "s",
      }).map((candidate) => candidate.task.id),
    ).toEqual(["lunch", "no-time", "missed"]);
  });

  it("ordena las missed por la ventana que terminó primero", () => {
    const early = task("early", {
      priority: 2,
      window: { start: "06:00", end: "08:00" },
    });
    const late = task("late", {
      priority: 2,
      window: { start: "10:00", end: "12:00" },
    });
    expect(
      eligibleCandidates({
        tasks: [late, early],
        occurrences: [],
        now: at(13),
        seed: "s",
      }).map((candidate) => candidate.task.id),
    ).toEqual(["early", "late"]);
  });

  it("conserva el snapshot de una ocurrencia missed empezada", () => {
    const original = task("original", {
      priority: 3,
      durationMin: 15,
      window: { start: "06:00", end: "12:00" },
    });
    const edited = task("original", {
      priority: 3,
      durationMin: 15,
      title: "Editada",
      window: { start: "15:00", end: "16:00" },
    });
    const partial = occurrence(original, {
      status: "partial",
      agreement: { task: original, rewardCapRc: 15, shortStepRc: null, lockedAt: NOW },
    });
    expect(
      chooseNextTask({
        tasks: [edited],
        occurrences: [partial],
        now: at(13),
        seed: "s",
      }),
    ).toMatchObject({ task: { title: "Lavar ropa" }, isMissed: true });
  });
});

describe("orden explícito del usuario y mano de dos tarjetas", () => {
  it("ancla vigente va primero y luego el horario/orden definido", () => {
    const tasks = [
      task("normal", { priority: 3, category: "casa" }),
      task("anchor", { priority: 1, fixedTime: "18:00" }),
      task("different", { priority: 1, category: "personal" }),
    ];
    const ranked = eligibleCandidates({
      tasks,
      occurrences: [],
      now: at(18),
      seed: "s",
      previousCategory: "casa",
    });
    expect(ranked.map((c) => c.task.id)).toEqual(["anchor", "normal", "different"]);
  });

  it("una ancla ya presentada sigue en su bloque horario pero no vuelve a ser takeover sobre una tarea anterior vigente", () => {
    const afternoonEarly = task("afternoon-early", {
      priority: 1,
      window: { start: "12:00", end: "19:00" },
    });
    const anchor = task("anchor", { priority: 1, fixedTime: "18:00" });
    const ranked = eligibleCandidates({
      tasks: [anchor, afternoonEarly],
      occurrences: [occurrence(anchor, { anchorPresentedAt: at(18) })],
      now: at(18, 1),
      seed: "s",
    });
    expect(ranked[0].task.id).toBe("afternoon-early");
    expect(ranked[1].isDueAnchor).toBe(false);
  });

  it("el paso 1 de una rutina respeta taskOrder y al completarse el paso 2 toma el foco inmediatamente", () => {
    const dress = task("dress", { title: "Cambiarme", window: { start: "05:00", end: "12:00" } });
    const cats = task("cats", { title: "Comida a los gatos", window: { start: "05:00", end: "12:00" } });
    const cook = task("cook", { title: "Hacer de comer", window: { start: "05:00", end: "12:00" } });
    const eat = task("eat", { title: "Comer", window: { start: "05:00", end: "12:00" } });
    const mealRoutine: Routine = {
      id: "routine:morning-meal",
      title: "Desayuno",
      taskIds: [cook.id, eat.id],
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    };
    const taskOrder = { dress: 0, cats: 1, cook: 2, eat: 3 };

    const startOfMorning = proposeHand({
      tasks: [dress, cats, cook, eat],
      occurrences: [],
      routines: [mealRoutine],
      taskOrder,
      now: at(7),
    });
    expect(startOfMorning.map((c) => c.task.id)).toEqual(["dress", "cats"]);

    const afterCook = proposeHand({
      tasks: [dress, cats, cook, eat],
      occurrences: [occurrence(cook, { status: "completed" })],
      routines: [mealRoutine],
      taskOrder,
      now: at(9),
    });
    expect(afterCook.map((c) => c.task.id)).toEqual(["eat", "dress"]);
    expect(afterCook[0]?.routine).toMatchObject({ step: 2, total: 2 });
  });

  it("respeta taskOrder por encima de importancia, categoría y semilla de fecha", () => {
    const cook = task("cook", {
      title: "Hacer de comer",
      priority: 2,
      category: "cocina",
      window: { start: "12:00", end: "19:00" },
    });
    const serve = task("serve", {
      title: "Servir comida",
      priority: 3,
      category: "cocina",
      window: { start: "12:00", end: "19:00" },
    });
    const laundry = task("laundry", {
      title: "Doblar ropa",
      priority: 3,
      category: "casa",
      window: { start: "12:00", end: "19:00" },
    });
    const taskOrder = { cook: 0, serve: 1, laundry: 2 };

    for (let day = 1; day <= 31; day += 1) {
      const seed = `2026-11-${String(day).padStart(2, "0")}`;
      const hand = proposeHand({
        tasks: [laundry, serve, cook],
        occurrences: [],
        taskOrder,
        now: at(14),
        seed,
        previousCategory: "cocina",
      });
      expect(hand.map((candidate) => candidate.task.id)).toEqual(["cook", "serve"]);
    }
  });

  it("la misma configuración da lo mismo sin depender del orden del arreglo de entrada", () => {
    const tasks = Array.from({ length: 10 }, (_, index) => ({
      ...task(`t${index}`),
      createdAt: NOW + index,
    }));
    const input = { tasks, occurrences: [], now: NOW, seed: "2026-10-26:1" };
    expect(proposeHand(input)).toEqual(proposeHand({ ...input, tasks: [...tasks].reverse() }));
  });

  it("no rellena una mano corta ni duplica una tarea repetida en la entrada", () => {
    const a = task("a");
    const b = task("b");
    expect(proposeHand({ tasks: [a, a, b], occurrences: [], now: NOW, seed: "s" })).toHaveLength(2);
    expect(proposeHand({ tasks: [], occurrences: [], now: NOW, seed: "s" })).toEqual([]);
  });

  it("propone dos como máximo y excluye lo aplazado sin mutar entradas", () => {
    const tasks = Array.from({ length: 6 }, (_, index) => ({
      ...task(`t${index}`),
      createdAt: NOW + index,
    }));
    const before = structuredClone(tasks);
    const excluded = [occurrenceIdFor("t0", MONDAY)];
    const hand = proposeHand({ tasks, occurrences: [], now: NOW, seed: "s", excludeOccurrenceIds: excluded });
    expect(hand.map((c) => c.task.id)).toEqual(["t1", "t2"]);
    expect(tasks).toEqual(before);
    expect(excluded).toHaveLength(1);
  });

  it("no usa reloj ni azar ocultos", () => {
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Hidden clock");
    });
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Hidden RNG");
    });
    expect(proposeHand({ tasks: [task("a")], occurrences: [], now: NOW, seed: "explicit" })).toHaveLength(1);
  });
});
