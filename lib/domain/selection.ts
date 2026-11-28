import { occurrenceIdFor } from "./occurrence";
import { blockForTime, taskTime } from "./schedule";
import { blockOrderRank, buildTaskOrder, type TaskOrder } from "./task-order";
import { clockMinutes, localClockMinutes, toLocalDate, weekdayOf, type LocalDate } from "./time";
import { TERMINAL_OCCURRENCE_STATUSES, type Occurrence, type Routine, type Task } from "./types";

export const HAND_CAPACITY = 2;

export type UnavailableReason =
  | "archived"
  | "unscheduled"
  | "wrong_day"
  | "closed"
  | "in_progress"
  | "outside_window"
  | "before_fixed_time";
export type Availability =
  { eligible: false; reason: UnavailableReason } | { eligible: true; isDueAnchor: boolean };

export interface SelectionInput {
  tasks: readonly Task[];
  occurrences: readonly Occurrence[];
  routines?: readonly Routine[];
  taskOrder?: TaskOrder;
  now: number;
  seed?: string;
  previousCategory?: string;
  excludeOccurrenceIds?: readonly string[];
}

export interface RoutineProgress {
  id: string;
  title: string;
  step: number;
  total: number;
}

export interface RoutineStepCandidate {
  task: Task;
  progress?: RoutineProgress;
}

export interface Candidate {
  task: Task;
  occurrenceId: string;
  isDueAnchor: boolean;
  /** A due task whose window already ended but is still unresolved today. */
  isMissed: boolean;
  routine?: RoutineProgress;
}

/** A frozen, already-started occurrence retains its agreement; archiving still hides it. */
function taskForOccurrence(task: Task, occurrence: Occurrence | undefined): Task {
  return occurrence?.agreement?.task ?? task;
}

/**
 * Missed is derived from the clock, never stored as an occurrence status. It
 * keeps the task available for an explicit late start, without pretending the
 * window is still open or marking it as not applicable for the user.
 */
export function isMissedOccurrence(task: Task, occurrence: Occurrence | undefined, now: number): boolean {
  const date = toLocalDate(now);
  const current = occurrence?.taskId === task.id && occurrence.date === date ? occurrence : undefined;
  if (task.archivedAt !== null) return false;
  if (current && (TERMINAL_OCCURRENCE_STATUSES.has(current.status) || current.status === "in_progress")) {
    return false;
  }
  const effective = taskForOccurrence(task, current);
  if (!effective.days.includes(weekdayOf(date)) || !effective.window) return false;
  return localClockMinutes(now) >= clockMinutes(effective.window.end);
}

/** Windows are [start, end); fixed times cannot be consumed early. No hidden clock. */
export function availabilityOf(task: Task, occurrence: Occurrence | undefined, now: number): Availability {
  const date = toLocalDate(now);
  const current = occurrence?.taskId === task.id && occurrence.date === date ? occurrence : undefined;
  const effective = taskForOccurrence(task, current);
  if (task.archivedAt !== null) return { eligible: false, reason: "archived" };
  if (effective.days.length === 0) return { eligible: false, reason: "unscheduled" };
  if (!effective.days.includes(weekdayOf(date))) return { eligible: false, reason: "wrong_day" };
  if (current && TERMINAL_OCCURRENCE_STATUSES.has(current.status)) {
    return { eligible: false, reason: "closed" };
  }
  if (current?.status === "in_progress") return { eligible: false, reason: "in_progress" };

  const minute = localClockMinutes(now);
  if (
    effective.window &&
    (minute < clockMinutes(effective.window.start) || minute >= clockMinutes(effective.window.end))
  ) {
    return { eligible: false, reason: "outside_window" };
  }
  if (effective.fixedTime && minute < clockMinutes(effective.fixedTime)) {
    return { eligible: false, reason: "before_fixed_time" };
  }
  return {
    eligible: true,
    isDueAnchor: effective.fixedTime !== undefined && current?.anchorPresentedAt == null,
  };
}

/** Ordered active member habits that apply on the given local date. */
export function routineStepsForDate(routine: Routine, tasks: readonly Task[], date: LocalDate): Task[] {
  if (routine.archivedAt !== null) return [];
  const weekday = weekdayOf(date);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return routine.taskIds.flatMap((taskId) => {
    const task = taskById.get(taskId);
    if (!task || task.archivedAt !== null || !task.days.includes(weekday)) return [];
    return [task];
  });
}

export function currentRoutineStep(
  routine: Routine,
  tasks: readonly Task[],
  occurrences: readonly Occurrence[],
  now: number,
): RoutineStepCandidate | undefined {
  if (routine.archivedAt !== null) return undefined;
  const date = toLocalDate(now);
  const scheduled = routineStepsForDate(routine, tasks, date);
  if (scheduled.length === 0) return undefined;
  const byTask = new Map(
    occurrences
      .filter((occurrence) => occurrence.date === date)
      .map((occurrence) => [occurrence.taskId, occurrence]),
  );
  const stepIndex = scheduled.findIndex((task) => {
    const occurrence = byTask.get(task.id);
    return !occurrence || !TERMINAL_OCCURRENCE_STATUSES.has(occurrence.status);
  });
  if (stepIndex < 0) return undefined;
  const task = scheduled[stepIndex];
  if (!task) return undefined;
  return {
    task,
    ...(scheduled.length >= 2
      ? {
          progress: {
            id: routine.id,
            title: routine.title,
            step: stepIndex + 1,
            total: scheduled.length,
          },
        }
      : {}),
  };
}

/** Resolves routine progress for an active session on its occurrence date. */
export function routineProgressForTaskOnDate(
  routine: Routine | undefined,
  tasks: readonly Task[],
  occurrences: readonly Occurrence[],
  date: LocalDate,
  taskId: string,
): RoutineProgress | undefined {
  if (!routine || routine.archivedAt !== null) return undefined;
  const scheduled = routineStepsForDate(routine, tasks, date);
  if (scheduled.length < 2) return undefined;
  const byTask = new Map(
    occurrences
      .filter((occurrence) => occurrence.date === date)
      .map((occurrence) => [occurrence.taskId, occurrence]),
  );
  const stepIndex = scheduled.findIndex((task) => {
    const occurrence = byTask.get(task.id);
    return !occurrence || !TERMINAL_OCCURRENCE_STATUSES.has(occurrence.status);
  });
  if (stepIndex < 0 || scheduled[stepIndex]?.id !== taskId) return undefined;
  return { id: routine.id, title: routine.title, step: stepIndex + 1, total: scheduled.length };
}

function hasSavedTaskOrder(order: TaskOrder | undefined, id: string): boolean {
  const value = order?.[id];
  return typeof value === "number" && Number.isFinite(value);
}

export function eligibleCandidates(input: SelectionInput): Candidate[] {
  const date = toLocalDate(input.now);
  const byTask = new Map(
    input.occurrences
      .filter((occurrence) => occurrence.date === date)
      .map((occurrence) => [occurrence.taskId, occurrence]),
  );
  const excluded = new Set(input.excludeOccurrenceIds ?? []);
  const tasks = new Map(input.tasks.map((task) => [task.id, task]));
  const effectiveOrder = buildTaskOrder(input.tasks, input.taskOrder);
  const groupedTaskIds = new Set<string>();
  const activeRoutineStepIds = new Set<string>();
  const routineStepByTaskId = new Map<string, RoutineProgress>();
  const routineRankById = new Map<string, number>();

  (input.routines ?? []).forEach((routine, index) => {
    if (routine.archivedAt !== null) return;
    const savedOrder = input.taskOrder?.[routine.id];
    routineRankById.set(
      routine.id,
      typeof savedOrder === "number" && Number.isFinite(savedOrder) ? savedOrder : 1_000_000 + index,
    );
    for (const taskId of routine.taskIds) groupedTaskIds.add(taskId);
    const step = currentRoutineStep(routine, input.tasks, input.occurrences, input.now);
    if (step) {
      activeRoutineStepIds.add(step.task.id);
      if (step.progress) routineStepByTaskId.set(step.task.id, step.progress);
    }
  });

  const candidates: Candidate[] = [];
  for (const task of tasks.values()) {
    if (groupedTaskIds.has(task.id) && !activeRoutineStepIds.has(task.id)) continue;
    const occurrenceId = occurrenceIdFor(task.id, date);
    if (excluded.has(occurrenceId)) continue;
    const occurrence = byTask.get(task.id);
    const availability = availabilityOf(task, occurrence, input.now);
    const missed = isMissedOccurrence(task, occurrence, input.now);
    if (!availability.eligible && !missed) continue;
    const routine = routineStepByTaskId.get(task.id);
    candidates.push({
      task: taskForOccurrence(task, occurrence),
      occurrenceId,
      isDueAnchor: availability.eligible ? availability.isDueAnchor : false,
      isMissed: missed,
      ...(routine ? { routine } : {}),
    });
  }

  return candidates.sort((a, b) => {
    const anchor = Number(b.isDueAnchor) - Number(a.isDueAnchor);
    if (anchor) return anchor;
    if (a.isDueAnchor && b.isDueAnchor && a.task.fixedTime && b.task.fixedTime) {
      const fixed = clockMinutes(a.task.fixedTime) - clockMinutes(b.task.fixedTime);
      if (fixed) return fixed;
    }

    // An already-started routine finishes its next step before starting another card.
    const aRoutineFlow = Boolean(a.routine && a.routine.step > 1);
    const bRoutineFlow = Boolean(b.routine && b.routine.step > 1);
    const routineFlow = Number(bRoutineFlow) - Number(aRoutineFlow);
    if (routineFlow) return routineFlow;

    // Active windows and any-time tasks come before expired earlier blocks (missed),
    // so unfinished morning habits never bury afternoon or night habits.
    const missed = Number(a.isMissed) - Number(b.isMissed);
    if (missed) return missed;

    const aBlock = blockOrderRank(blockForTime(taskTime(a.task)));
    const bBlock = blockOrderRank(blockForTime(taskTime(b.task)));
    if (aBlock !== bBlock) return aBlock - bBlock;

    const aHasOrder = hasSavedTaskOrder(input.taskOrder, a.task.id);
    const bHasOrder = hasSavedTaskOrder(input.taskOrder, b.task.id);

    // When a section has not been manually ordered, unstarted routines sit at the
    // top of their block (matching Habits). Once ordered, taskOrder governs.
    if (!aHasOrder && !bHasOrder) {
      const routineStep = Number(Boolean(b.routine)) - Number(Boolean(a.routine));
      if (routineStep) return routineStep;
      if (a.routine && b.routine) {
        const aRoutineOrder = routineRankById.get(a.routine.id) ?? Number.MAX_SAFE_INTEGER;
        const bRoutineOrder = routineRankById.get(b.routine.id) ?? Number.MAX_SAFE_INTEGER;
        if (aRoutineOrder !== bRoutineOrder) return aRoutineOrder - bRoutineOrder;
      }
    }

    if (a.isMissed && b.isMissed && a.task.window && b.task.window && !aHasOrder && !bHasOrder) {
      const ended = clockMinutes(a.task.window.end) - clockMinutes(b.task.window.end);
      if (ended) return ended;
    }

    const aOrder = effectiveOrder[a.task.id] ?? Number.MAX_SAFE_INTEGER;
    const bOrder = effectiveOrder[b.task.id] ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
  });
}

export function chooseNextTask(input: SelectionInput): Candidate | undefined {
  return eligibleCandidates(input)[0];
}

/** Two is the visible deck capacity: #1 in focus and #2 up next, with no hidden third card. */
export function proposeHand(input: SelectionInput): Candidate[] {
  return eligibleCandidates(input).slice(0, HAND_CAPACITY);
}
