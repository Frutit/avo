"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { Menu } from "@base-ui/react/menu";
import { NumberField } from "@base-ui/react/number-field";
import { Switch } from "@base-ui/react/switch";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toast } from "@base-ui/react/toast";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "use-intl";

import { HelpTip } from "./help-tip";
import { MissedBadge } from "./missed-badge";
import { SelectControl } from "./select-control";
import { activeStorageKey, currentDatabaseName, openDatabase, type RunoDatabase } from "@/lib/db/database";
import { writePreferences } from "@/lib/sync/preference-writer";
import { useWorkspace } from "./workspace-context";
import {
  archiveRoutine,
  archiveTask,
  createRoutine,
  createTasks,
  listRoutines,
  listTasks,
  reactivateOccurrence,
  restoreArchivedTask,
  updateRoutine,
  updateTask,
  updateTaskWithCopies,
  type CreateTaskBatchItem,
} from "@/lib/db/repository";
import { BLOCK_RANGES, blockForTime, taskTime, windowPreset, type BlockKey } from "@/lib/domain/schedule";
import { isMissedOccurrence } from "@/lib/domain/selection";
import { MAX_ROUTINE_STEPS } from "@/lib/domain/validation";
import {
  blockOrderRank,
  buildTaskOrder,
  reorderTaskOrder,
  sortTasksForDisplay,
  type TaskOrder,
} from "@/lib/domain/task-order";
import { toLocalDate, weekdayOf, type ClockTime, type Weekday } from "@/lib/domain/time";
import type { Occurrence, Routine, Task, TaskInput } from "@/lib/domain/types";

const WEEKDAYS = [
  { value: 1, short: "daysShort.mon", full: "daysFull.mon" },
  { value: 2, short: "daysShort.tue", full: "daysFull.tue" },
  { value: 3, short: "daysShort.wed", full: "daysFull.wed" },
  { value: 4, short: "daysShort.thu", full: "daysFull.thu" },
  { value: 5, short: "daysShort.fri", full: "daysFull.fri" },
  { value: 6, short: "daysShort.sat", full: "daysFull.sat" },
  { value: 0, short: "daysShort.sun", full: "daysFull.sun" },
] as const;

const PRIORITY_LABEL = {
  1: "priorityLow",
  2: "priorityMedium",
  3: "priorityHigh",
} as const;

const BLOCKS = [
  { value: "morning", labelKey: "blocks.morning" },
  { value: "afternoon", labelKey: "blocks.afternoon" },
  { value: "night", labelKey: "blocks.night" },
] as const;

function isBlockKey(value: string): value is BlockKey {
  return BLOCKS.some((block) => block.value === value);
}

const DRAFT_KEY = "runo:task-editor-draft:v1";
const CLOSED_SECTIONS_KEY = "runo:task-editor-closed-sections:v1";
const TASK_ORDER_KEY = "runo:task-editor-order:v1";

function readTaskOrder(storageKey?: string): TaskOrder {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(storageKey ?? activeStorageKey(TASK_ORDER_KEY));
    if (!raw) return {};
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

async function writeTaskOrder(order: TaskOrder): Promise<void> {
  await writePreferences(currentDatabaseName(), { taskOrder: order });
}

interface FormState {
  id: string | null;
  title: string;
  category: string;
  durationMin: string;
  days: Weekday[];
  priority: 1 | 2 | 3;
  useWindow: boolean;
  windowStart: string;
  windowEnd: string;
  useFixedTime: boolean;
  fixedTime: string;
  useShortStep: boolean;
  shortStepTitle: string;
  shortStepDuration: string;
}

function emptyForm(): FormState {
  return {
    id: null,
    title: "",
    category: "personal",
    durationMin: "10",
    days: [],
    priority: 2,
    useWindow: false,
    windowStart: "06:00",
    windowEnd: "12:00",
    useFixedTime: false,
    fixedTime: "18:00",
    useShortStep: false,
    shortStepTitle: "",
    shortStepDuration: "1",
  };
}

const EVERY_DAY: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

function formFromTask(task: Task): FormState {
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    durationMin: String(task.durationMin),
    days: [...task.days],
    priority: task.priority,
    useWindow: task.window !== undefined,
    windowStart: task.window?.start ?? "06:00",
    windowEnd: task.window?.end ?? "12:00",
    useFixedTime: task.fixedTime !== undefined,
    fixedTime: task.fixedTime ?? "18:00",
    useShortStep: task.shortStep !== undefined,
    shortStepTitle: task.shortStep?.title ?? "",
    shortStepDuration: String(task.shortStep?.durationMin ?? 1),
  };
}

function toInput(form: FormState): TaskInput {
  const input: TaskInput = {
    title: form.title,
    category: form.category,
    durationMin: Number(form.durationMin),
    days: [...form.days].sort((a, b) => a - b),
    priority: form.priority,
  };
  if (form.useWindow) {
    input.window = {
      start: form.windowStart as ClockTime,
      end: form.windowEnd as ClockTime,
    };
  }
  if (form.useFixedTime) input.fixedTime = form.fixedTime as ClockTime;
  if (form.useShortStep) {
    input.shortStep = {
      title: form.shortStepTitle,
      durationMin: Number(form.shortStepDuration),
    };
  }
  return input;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface RoutineDraft {
  id: string | null;
  title: string;
  taskIds: string[];
  newSteps: CreateTaskBatchItem[];
}

interface EditorDraft {
  form: FormState;
  categoryMode: "existing" | "new";
  customWindow: boolean;
  newBlocks: BlockKey[];
  newCustom: boolean;
  selectedDay: Weekday;
}

function readDraft(): EditorDraft | null {
  try {
    const raw = window.sessionStorage.getItem(activeStorageKey(DRAFT_KEY));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<EditorDraft>;
    if (!draft.form || typeof draft.form.title !== "string" || !Array.isArray(draft.form.days)) {
      return null;
    }
    return {
      form: draft.form,
      categoryMode: draft.categoryMode === "new" ? "new" : "existing",
      customWindow: draft.customWindow === true,
      newBlocks: Array.isArray(draft.newBlocks) ? draft.newBlocks : [],
      newCustom: draft.newCustom === true,
      selectedDay:
        typeof draft.selectedDay === "number"
          ? (draft.selectedDay as Weekday)
          : (new Date().getDay() as Weekday),
    };
  } catch {
    return null;
  }
}

function writeDraft(draft: EditorDraft): void {
  try {
    window.sessionStorage.setItem(activeStorageKey(DRAFT_KEY), JSON.stringify(draft));
  } catch {
    // Storage can be unavailable in private modes; the form still works.
  }
}

function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(activeStorageKey(DRAFT_KEY));
  } catch {
    // Nothing to clear.
  }
}

function readClosedSections(): Record<string, boolean> {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(activeStorageKey(CLOSED_SECTIONS_KEY));
    if (!raw) return {};
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
  } catch {
    return {};
  }
}

function writeClosedSections(value: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(activeStorageKey(CLOSED_SECTIONS_KEY), JSON.stringify(value));
  } catch {
    // Storage can be unavailable; collapsing still works for this visit.
  }
}

function DisclosureChevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="task-block-chevron h-4 w-4 shrink-0 text-muted"
    >
      <path
        d="m5 8 5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DoneCheck() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3 w-3 shrink-0">
      <path
        d="m3 8 3 3 7-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SkipDash() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3 w-3 shrink-0">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.4 8h5.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Reveal({
  show,
  reduceMotion,
  className,
  children,
}: {
  show: boolean;
  reduceMotion: boolean | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          className={className}
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.1 : 0.18, ease: "easeOut" }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function GripIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <circle cx="5" cy="4" r="1" />
      <circle cx="11" cy="4" r="1" />
      <circle cx="5" cy="8" r="1" />
      <circle cx="11" cy="8" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="11" cy="12" r="1" />
    </svg>
  );
}

interface TaskRowProps {
  task: Task;
  routine?: Routine;
  canConvertToRoutine: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMove?: (offset: -1 | 1) => void;
  daysLabel?: string | null;
  occurrence: Occurrence | undefined;
  now: number;
  menuTaskId: string | null;
  onMenuChange: (taskId: string | null) => void;
  onEdit: (task: Task) => void;
  onConvertToRoutine: (task: Task) => void;
  onEditRoutine: (routine: Routine) => void;
  onDelete: (task: Task) => void;
  onReactivate: (task: Task, occurrence: Occurrence) => void;
  reactivatingId: string | null;
}

function TaskRow({
  task,
  routine,
  canConvertToRoutine,
  canMoveUp = false,
  canMoveDown = false,
  onMove,
  daysLabel,
  occurrence,
  now,
  menuTaskId,
  onMenuChange,
  onEdit,
  onConvertToRoutine,
  onEditRoutine,
  onDelete,
  onReactivate,
  reactivatingId,
}: TaskRowProps) {
  const t = useTranslations("editor");
  const common = useTranslations("common");
  const reduceMotion = useReducedMotion();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const time = taskTime(task);
  const done = occurrence?.status === "completed" || occurrence?.status === "already_done";
  const skipped = occurrence?.status === "not_applicable";
  const resolved = done || skipped;
  const missed = occurrence ? isMissedOccurrence(task, occurrence, now) : false;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reduceMotion ? undefined : transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`border-b border-line${done ? " task-row-done" : skipped ? " task-row-skipped" : ""}${isDragging ? " task-row-dragging" : ""}`}
    >
      <div className="task-row-main flex min-h-14 items-start gap-2 py-3">
        <button
          type="button"
          className="task-grip shrink-0"
          {...attributes}
          {...listeners}
          aria-label={t("list.dragHandle")}
        >
          <GripIcon />
        </button>
        <div className="task-row-content flex min-w-0 flex-1 items-start gap-3">
          <span className="min-w-0 flex-1">
            <span
              className={`line-clamp-2 text-base font-semibold leading-snug${done ? " task-title-done" : skipped ? " task-title-skipped" : ""}`}
            >
              {task.title}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>
                {time ?? t("list.noTime")} · {common("minutes", { count: task.durationMin })}
                {daysLabel ? ` · ${daysLabel}` : ""}
              </span>
              {routine ? (
                <span className="text-xs font-semibold text-muted">
                  {t("routine.stepShort", {
                    step: routine.taskIds.indexOf(task.id) + 1,
                    total: routine.taskIds.length,
                  })}
                </span>
              ) : null}
              {done ? (
                <span className="task-done-badge">
                  <DoneCheck />
                  {t("list.doneToday")}
                </span>
              ) : null}
              {skipped ? (
                <span className="task-skipped-badge">
                  <SkipDash />
                  {t("list.notApplicableToday")}
                </span>
              ) : null}
              {missed ? <MissedBadge /> : null}
            </span>
          </span>
        </div>
        <Menu.Root open={menuTaskId === task.id} onOpenChange={(open) => onMenuChange(open ? task.id : null)}>
          <Menu.Trigger
            type="button"
            className="first-more task-row-menu shrink-0"
            aria-label={`${task.title}: ${common("moreOptions")}`}
          >
            ⋯
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="first-menu-positioner" sideOffset={8} align="end">
              <Menu.Popup className="first-menu">
                <Menu.Item
                  className="first-menu-item"
                  onClick={() => {
                    onMenuChange(null);
                    onEdit(task);
                  }}
                >
                  {t("edit")}
                </Menu.Item>
                {!routine && canMoveUp && onMove ? (
                  <Menu.Item
                    className="first-menu-item"
                    onClick={() => {
                      onMenuChange(null);
                      onMove(-1);
                    }}
                  >
                    {t("list.moveUp")}
                  </Menu.Item>
                ) : null}
                {!routine && canMoveDown && onMove ? (
                  <Menu.Item
                    className="first-menu-item"
                    onClick={() => {
                      onMenuChange(null);
                      onMove(1);
                    }}
                  >
                    {t("list.moveDown")}
                  </Menu.Item>
                ) : null}
                {routine ? (
                  <Menu.Item
                    className="first-menu-item"
                    onClick={() => {
                      onMenuChange(null);
                      onEditRoutine(routine);
                    }}
                  >
                    {t("routine.edit")}
                  </Menu.Item>
                ) : canConvertToRoutine ? (
                  <Menu.Item
                    className="first-menu-item"
                    onClick={() => {
                      onMenuChange(null);
                      onConvertToRoutine(task);
                    }}
                  >
                    {t("routine.convert")}
                  </Menu.Item>
                ) : null}
                {resolved && occurrence ? (
                  <Menu.Item
                    className="first-menu-item"
                    disabled={reactivatingId === occurrence.id}
                    onClick={() => {
                      onMenuChange(null);
                      onReactivate(task, occurrence);
                    }}
                  >
                    {t("list.reactivate")}
                  </Menu.Item>
                ) : null}
                {!routine ? (
                  <Menu.Item
                    className="first-menu-item"
                    onClick={() => {
                      onMenuChange(null);
                      onDelete(task);
                    }}
                  >
                    {t("list.delete")}
                  </Menu.Item>
                ) : null}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </li>
  );
}

function RoutineOrderRow({
  item,
  step,
  total,
  onMove,
  onRemove,
}: {
  item: { id: string; title: string };
  step: number;
  total: number;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("editor");
  const reduceMotion = useReducedMotion();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reduceMotion ? undefined : transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`border-b border-line${isDragging ? " task-row-dragging" : ""}`}
    >
      <div className="task-row-main flex min-h-14 items-center gap-2 py-3">
        <button
          type="button"
          className="task-grip shrink-0"
          {...attributes}
          {...listeners}
          aria-label={t("list.dragHandle")}
        >
          <GripIcon />
        </button>
        <span className="w-7 shrink-0 text-sm tabular-nums text-muted">{step}.</span>
        <span className="min-w-0 flex-1 text-sm font-semibold">{item.title}</span>
        <Menu.Root>
          <Menu.Trigger
            type="button"
            className="first-more task-row-menu shrink-0"
            aria-label={t("routine.orderOptions", { name: item.title })}
          >
            ⋯
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="first-menu-positioner" sideOffset={8} align="end">
              <Menu.Popup className="first-menu">
                {step > 1 ? (
                  <Menu.Item className="first-menu-item" onClick={() => onMove(-1)}>
                    {t("routine.moveUp", { name: item.title })}
                  </Menu.Item>
                ) : null}
                {step < total ? (
                  <Menu.Item className="first-menu-item" onClick={() => onMove(1)}>
                    {t("routine.moveDown", { name: item.title })}
                  </Menu.Item>
                ) : null}
                <Menu.Item className="first-menu-item" onClick={onRemove}>
                  {t("routine.removeStep", { name: item.title })}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </li>
  );
}

function SortableTaskList<T extends { id: string }>({
  tasks,
  renderTask,
  onReorder,
  ordered = false,
  ariaLabel,
}: {
  tasks: readonly T[];
  renderTask: (task: T) => ReactNode;
  onReorder: (activeId: string, overId: string, visibleIds: string[]) => void;
  ordered?: boolean;
  ariaLabel?: string;
}) {
  const t = useTranslations("editor");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = tasks.map((task) => task.id);
  const rows = tasks.map(renderTask);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id), ids);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: t("list.dragInstructions") },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ordered ? (
          <ol className="task-list" aria-label={ariaLabel}>
            {rows}
          </ol>
        ) : (
          <ul className="task-list" aria-label={ariaLabel}>
            {rows}
          </ul>
        )}
      </SortableContext>
    </DndContext>
  );
}

export function TaskEditor({ initialTaskId }: { initialTaskId?: string | null }) {
  const t = useTranslations("editor");
  const common = useTranslations("common");
  const toast = useTranslations("toast");
  const toastManager = Toast.useToastManager();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [routineDraft, setRoutineDraft] = useState<RoutineDraft | null>(null);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [routineSaving, setRoutineSaving] = useState(false);
  const [stepComposerOpen, setStepComposerOpen] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState("");
  const [newStepMinutes, setNewStepMinutes] = useState("10");
  const [stepComposerError, setStepComposerError] = useState<string | null>(null);
  const [openRoutineBlocks, setOpenRoutineBlocks] = useState<Record<string, boolean>>({});
  const [todayOccurrences, setTodayOccurrences] = useState<Occurrence[]>([]);
  const [today] = useState(() => toLocalDate(Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<FormState | null>(null);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [categoryMode, setCategoryMode] = useState<"existing" | "new">("existing");
  const [customWindow, setCustomWindow] = useState(false);
  const [newBlocks, setNewBlocks] = useState<BlockKey[]>([]);
  const [newCustom, setNewCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedDay, setSelectedDay] = useState<Weekday>(() => new Date().getDay() as Weekday);
  const reduceMotion = useReducedMotion();
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const shortTitleRef = useRef<HTMLInputElement>(null);
  const shortMinutesRef = useRef<HTMLInputElement>(null);
  const openedInitialTask = useRef(false);
  const draftBootstrapped = useRef(false);
  const [draftReady, setDraftReady] = useState(false);
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>(readClosedSections);
  const [taskOrder, setTaskOrder] = useState<TaskOrder>(readTaskOrder);
  const [taskOrderStorageKey] = useState(() => activeStorageKey(TASK_ORDER_KEY));
  const orderRef = useRef(taskOrder);
  const { revision, preferences } = useWorkspace();
  const retryBatch = useRef<{ signature: string; ids: string[]; actionId?: string } | null>(null);

  useEffect(() => {
    if (!draftReady) return;
    if (!form) {
      clearDraft();
      return;
    }
    writeDraft({ form, categoryMode, customWindow, newBlocks, newCustom, selectedDay });
  }, [draftReady, form, categoryMode, customWindow, newBlocks, newCustom, selectedDay]);

  useEffect(() => {
    writeClosedSections(closedSections);
  }, [closedSections]);

  useEffect(() => {
    const onChange = (event: StorageEvent) => {
      if (event.key === taskOrderStorageKey) {
        const next = readTaskOrder(taskOrderStorageKey);
        orderRef.current = next;
        setTaskOrder(next);
      }
    };
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, [taskOrderStorageKey]);

  useEffect(() => {
    if (preferences.pending || preferences.failed) return;
    const next = readTaskOrder(taskOrderStorageKey);
    orderRef.current = next;
    setTaskOrder(next);
  }, [taskOrderStorageKey, revision, preferences.pending, preferences.failed]);

  useEffect(() => {
    if (!fieldErrors.days) return;
    if (["title", "durationMin", "category"].some((key) => fieldErrors[key])) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("habit-days")?.querySelector<HTMLElement>("button")?.focus();
      document.getElementById("habit-days")?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [fieldErrors]);

  useEffect(() => {
    let cancelled = false;
    let db: RunoDatabase | null = null;

    async function load() {
      try {
        db = await openDatabase();
        const [list, groups, dayOccurrences] = await Promise.all([
          listTasks(db, true),
          listRoutines(db),
          db.occurrences.where("date").equals(today).toArray(),
        ]);
        if (!cancelled) {
          if (!draftBootstrapped.current) {
            draftBootstrapped.current = true;
            if (initialTaskId) {
              clearDraft();
            } else {
              const draft = readDraft();
              if (draft) {
                setForm(draft.form);
                setCategoryMode(draft.categoryMode);
                setCustomWindow(draft.customWindow);
                setNewBlocks(draft.newBlocks);
                setNewCustom(draft.newCustom);
                setSelectedDay(draft.selectedDay);
              }
            }
            setDraftReady(true);
          }
          setTasks(list);
          setRoutines(groups);
          setTodayOccurrences(dayOccurrences);
          setNow(Date.now());
          setLoadError(null);
          if (initialTaskId && !openedInitialTask.current) {
            const target = list.find((task) => task.id === initialTaskId);
            if (target) {
              openedInitialTask.current = true;
              retryBatch.current = null;
              const targetForm = formFromTask(target);
              const targetBlock = targetForm.useWindow
                ? windowPreset(targetForm.windowStart, targetForm.windowEnd)
                : "any";
              setCategoryMode("existing");
              setCustomWindow(targetBlock === "custom");
              setNewBlocks(isBlockKey(targetBlock) ? [targetBlock] : []);
              setNewCustom(false);
              setForm(targetForm);
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("No se pudieron cargar las tareas", error);
          setLoadError(t("notices.loadError"));
        }
      } finally {
        db?.close();
      }
    }

    void load();
    return () => {
      cancelled = true;
      db?.close();
    };
  }, [initialTaskId, reloadKey, t, today, revision]);

  function closeForm() {
    setForm(null);
    setFormError(null);
    setFieldErrors({});
    setNotice(null);
    clearDraft();
    retryBatch.current = null;
  }

  function startNew() {
    setFormError(null);
    setFieldErrors({});
    setNotice(null);
    retryBatch.current = null;
    const next = emptyForm();
    next.days = [selectedDay];
    setCategoryMode("existing");
    setCustomWindow(false);
    setNewBlocks([]);
    setNewCustom(false);
    setForm(next);
  }

  function startEdit(task: Task) {
    setFormError(null);
    setFieldErrors({});
    setNotice(null);
    retryBatch.current = null;
    setCategoryMode("existing");
    setCustomWindow(false);
    const taskForm = formFromTask(task);
    const block = taskForm.useWindow ? windowPreset(taskForm.windowStart, taskForm.windowEnd) : "any";
    setNewBlocks(isBlockKey(block) ? [block] : []);
    setNewCustom(false);
    setCustomWindow(block === "custom");
    setForm(taskForm);
  }

  function patch(changes: Partial<FormState>) {
    setForm((current) => (current ? { ...current, ...changes } : current));
    setFieldErrors((current) => {
      const next = { ...current };
      let changed = false;
      for (const key of Object.keys(changes)) {
        if (key in next) {
          delete next[key];
          changed = true;
        }
      }
      if ("useShortStep" in changes) {
        delete next.shortStepTitle;
        delete next.shortStepDuration;
        changed = true;
      }
      return changed ? next : current;
    });
  }

  function focusFirstError(errors: Record<string, string>) {
    const order = ["title", "durationMin", "category", "days", "shortStepTitle", "shortStepDuration"];
    const first = order.find((key) => errors[key]);
    if (!first) return;
    if (first === "title") titleRef.current?.focus();
    else if (first === "durationMin") durationRef.current?.focus();
    else if (first === "category") {
      if (categoryMode === "new") categoryInputRef.current?.focus();
      else document.getElementById("task-category-trigger")?.focus();
    } else if (first === "days") {
      document.querySelector<HTMLElement>("#habit-days button")?.focus();
    } else if (first === "shortStepTitle") shortTitleRef.current?.focus();
    else shortMinutesRef.current?.focus();
  }

  function validateForm(instance: FormState): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!instance.title.trim()) errors.title = t("errors.name");
    const duration = Number(instance.durationMin);
    if (!Number.isSafeInteger(duration) || duration < 1) errors.durationMin = t("errors.minutes");
    if (!instance.category.trim()) errors.category = t("errors.type");
    if (instance.days.length === 0) errors.days = t("errors.days");
    if (instance.useShortStep) {
      if (!instance.shortStepTitle.trim()) errors.shortStepTitle = t("errors.firstStep");
      const stepMinutes = Number(instance.shortStepDuration);
      if (!Number.isSafeInteger(stepMinutes) || stepMinutes < 1) {
        errors.shortStepDuration = t("errors.stepMinutes");
      }
    }
    return errors;
  }

  function chooseNewAny() {
    setNewBlocks([]);
    setNewCustom(false);
    setCustomWindow(false);
    patch({ useWindow: false });
  }

  function chooseNewCustom() {
    setNewBlocks([]);
    setNewCustom(true);
    setCustomWindow(true);
    patch({ useWindow: true });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    const errors = validateForm(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError(null);
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setFormError(null);
    setNotice(null);
    let savedMessage: string | null = null;
    try {
      const db = await openDatabase();
      try {
        const now = Date.now();
        if (form.id) {
          const input = toInput(form);
          const copyBlocks = copiesToAdd();
          if (copyBlocks.length === 0) {
            await updateTask(db, form.id, input, now, `edit:${form.id}:${newId()}`);
          } else {
            const copyInputs = copyBlocks.map((block) => {
              const range = BLOCK_RANGES[block];
              return toInput({
                ...form,
                useWindow: true,
                windowStart: range.start,
                windowEnd: range.end,
                useFixedTime: false,
              });
            });
            const signature = JSON.stringify({ id: form.id, input, copyInputs });
            const previous = retryBatch.current;
            const retry =
              previous?.signature === signature &&
              previous.actionId &&
              previous.ids.length === copyInputs.length
                ? { signature, ids: previous.ids, actionId: previous.actionId }
                : {
                    signature,
                    ids: copyInputs.map(() => `task:${newId()}`),
                    actionId: `edit:${form.id}:${newId()}`,
                  };
            retryBatch.current = retry;
            await updateTaskWithCopies(db, {
              id: form.id,
              input,
              copies: copyInputs.map((copyInput, index) => ({ id: retry.ids[index], input: copyInput })),
              now,
              actionId: retry.actionId,
            });
            savedMessage = t("notices.tasksCopied", { count: copyInputs.length });
          }
        } else {
          if (newBlocks.length > 1 && form.useFixedTime) {
            throw new Error(t("notices.sameTime"));
          }
          let inputs;
          if (newCustom) {
            inputs = [toInput(form)];
          } else if (newBlocks.length > 0) {
            inputs = newBlocks.map((block) => {
              const range = BLOCK_RANGES[block];
              return toInput({
                ...form,
                useWindow: true,
                windowStart: range.start,
                windowEnd: range.end,
              });
            });
          } else {
            inputs = [toInput({ ...form, useWindow: false })];
          }
          const signature = JSON.stringify(inputs);
          const ids =
            retryBatch.current?.signature === signature
              ? retryBatch.current.ids
              : inputs.map(() => `task:${newId()}`);
          retryBatch.current = { signature, ids };
          await createTasks(
            db,
            inputs.map((input, index) => ({ id: ids[index], input })),
            now,
          );
          savedMessage =
            inputs.length > 1 ? t("notices.tasksCreated", { count: inputs.length }) : t("notices.saved");
        }
      } finally {
        db.close();
      }
      setForm(null);
      clearDraft();
      retryBatch.current = null;
      if (form.id && !savedMessage) savedMessage = t("notices.saved");
      setReloadKey((key) => key + 1);
      toastManager.add({
        title: savedMessage ?? t("notices.saved"),
        type: "success",
        timeout: 4000,
      });
    } catch {
      setFormError(t("notices.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function undoArchive(task: Task) {
    try {
      const db = await openDatabase();
      try {
        await restoreArchivedTask(db, task.id, Date.now());
      } finally {
        db.close();
      }
      setReloadKey((key) => key + 1);
      toastManager.add({ title: toast("undone"), type: "success", timeout: 4000 });
    } catch (error) {
      console.error("No se pudo deshacer el archivo", error);
      toastManager.add({ title: toast("undoFailed"), type: "error", timeout: 5000 });
    }
  }

  async function archive(task: Task) {
    if (archivingId) return;
    setArchivingId(task.id);
    setNotice(null);
    try {
      const db = await openDatabase();
      try {
        await archiveTask(db, task.id, Date.now());
      } finally {
        db.close();
      }
      setReloadKey((key) => key + 1);
      const toastId = toastManager.add({
        title: t("notices.deleted"),
        type: "success",
        timeout: 8000,
        actionProps: {
          children: toast("undo"),
          onClick() {
            toastManager.close(toastId);
            void undoArchive(task);
          },
        },
      });
    } catch (error) {
      console.error("No se pudo eliminar la tarea", error);
      setNotice(t("notices.deleteError"));
    } finally {
      setArchivingId(null);
    }
  }

  async function reactivate(task: Task, occurrence: Occurrence) {
    if (reactivatingId) return;
    setReactivatingId(occurrence.id);
    setNotice(null);
    try {
      const db = await openDatabase();
      try {
        await reactivateOccurrence(db, occurrence.id, Date.now());
      } finally {
        db.close();
      }
      setReloadKey((key) => key + 1);
      toastManager.add({ title: t("notices.reactivated"), type: "success", timeout: 4000 });
    } catch (error) {
      console.error("No se pudo reactivar la tarea", task.id, error);
      setNotice(t("notices.reactivateError"));
    } finally {
      setReactivatingId(null);
    }
  }

  function resetStepComposer(open = false) {
    setStepComposerOpen(open);
    setNewStepTitle("");
    setNewStepMinutes("10");
    setStepComposerError(null);
  }

  function defaultRoutineBlocks(focusBlocks?: readonly string[]): Record<string, boolean> {
    const ungrouped = active.filter((task) => !routineByTaskId.has(task.id));
    if (ungrouped.length <= 8) {
      return { morning: true, afternoon: true, night: true, any: true };
    }
    if (focusBlocks && focusBlocks.length > 0) {
      return Object.fromEntries(focusBlocks.map((key) => [key, true]));
    }
    const nowTime = `${String(new Date(now).getHours()).padStart(2, "0")}:00`;
    const currentBlock = blockForTime(nowTime);
    const hasCurrent = ungrouped.some((task) => blockForTime(taskTime(task)) === currentBlock);
    if (hasCurrent) return { [currentBlock]: true };
    const firstNonEmpty = (["morning", "afternoon", "night", "any"] as const).find((key) =>
      ungrouped.some((task) => blockForTime(taskTime(task)) === key),
    );
    return firstNonEmpty ? { [firstNonEmpty]: true } : { morning: true };
  }

  function startNewRoutine() {
    setRoutineError(null);
    const availableCount = active.filter((task) => !routineByTaskId.has(task.id)).length;
    resetStepComposer(availableCount < 2);
    setOpenRoutineBlocks(defaultRoutineBlocks());
    setRoutineDraft({ id: null, title: "", taskIds: [], newSteps: [] });
  }

  function startRoutineFromTask(task: Task) {
    setRoutineError(null);
    const otherAvailable = active.some(
      (candidate) => candidate.id !== task.id && !routineByTaskId.has(candidate.id),
    );
    resetStepComposer(!otherAvailable);
    setOpenRoutineBlocks(defaultRoutineBlocks([blockForTime(taskTime(task))]));
    setRoutineDraft({ id: null, title: task.title, taskIds: [task.id], newSteps: [] });
  }

  function startRoutineEdit(routine: Routine) {
    setRoutineError(null);
    resetStepComposer(false);
    const memberBlocks = Array.from(
      new Set(
        routine.taskIds.flatMap((taskId) => {
          const member = active.find((candidate) => candidate.id === taskId);
          return member ? [blockForTime(taskTime(member))] : [];
        }),
      ),
    );
    setOpenRoutineBlocks(defaultRoutineBlocks(memberBlocks));
    setRoutineDraft({
      id: routine.id,
      title: routine.title,
      taskIds: [...routine.taskIds],
      newSteps: [],
    });
  }

  function closeRoutineEditor() {
    setRoutineDraft(null);
    setRoutineError(null);
    resetStepComposer(false);
  }

  function toggleRoutineMember(taskId: string) {
    if (
      routineDraft &&
      !routineDraft.taskIds.includes(taskId) &&
      routineDraft.taskIds.length >= MAX_ROUTINE_STEPS
    ) {
      setRoutineError(t("routine.maxSteps", { count: MAX_ROUTINE_STEPS }));
      return;
    }
    setRoutineDraft((current) => {
      if (!current) return current;
      const taskIds = current.taskIds.includes(taskId)
        ? current.taskIds.filter((id) => id !== taskId)
        : [...current.taskIds, taskId];
      return { ...current, taskIds };
    });
    setRoutineError(null);
  }

  function removeRoutineMember(taskId: string) {
    setRoutineDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        taskIds: current.taskIds.filter((id) => id !== taskId),
        newSteps: current.newSteps.filter((step) => step.id !== taskId),
      };
    });
    setRoutineError(null);
  }

  function addInlineRoutineStep() {
    if (!routineDraft) return;
    if (routineDraft.taskIds.length >= MAX_ROUTINE_STEPS) {
      setRoutineError(t("routine.maxSteps", { count: MAX_ROUTINE_STEPS }));
      return;
    }
    const title = newStepTitle.trim();
    if (!title) {
      setStepComposerError(t("routine.stepNameRequired"));
      return;
    }
    const durationMin = Number(newStepMinutes);
    if (!Number.isSafeInteger(durationMin) || durationMin < 1) {
      setStepComposerError(t("routine.stepMinutesInvalid"));
      return;
    }
    const lastId = routineDraft.taskIds[routineDraft.taskIds.length - 1];
    const referenceTask = lastId
      ? (active.find((task) => task.id === lastId) ??
        routineDraft.newSteps.find((step) => step.id === lastId)?.input)
      : undefined;
    const id = `task:${newId()}`;
    const input: TaskInput = {
      title,
      durationMin,
      days: referenceTask ? [...referenceTask.days] : [...EVERY_DAY],
      category: referenceTask ? referenceTask.category : (categories[0] ?? "personal"),
      priority: referenceTask ? referenceTask.priority : 2,
      ...(referenceTask?.window ? { window: { ...referenceTask.window } } : {}),
    };
    setRoutineDraft((current) =>
      current
        ? {
            ...current,
            taskIds: [...current.taskIds, id],
            newSteps: [...current.newSteps, { id, input }],
          }
        : current,
    );
    setNewStepTitle("");
    setNewStepMinutes("10");
    setStepComposerError(null);
    setRoutineError(null);
  }

  function moveRoutineMember(taskId: string, offset: -1 | 1) {
    setRoutineDraft((current) => {
      if (!current) return current;
      const index = current.taskIds.indexOf(taskId);
      const destination = index + offset;
      if (index < 0 || destination < 0 || destination >= current.taskIds.length) return current;
      const taskIds = [...current.taskIds];
      const [moving] = taskIds.splice(index, 1);
      if (!moving) return current;
      taskIds.splice(destination, 0, moving);
      return { ...current, taskIds };
    });
  }

  function reorderRoutineDraft(activeId: string, overId: string) {
    setRoutineDraft((current) => {
      if (!current) return current;
      const from = current.taskIds.indexOf(activeId);
      const to = current.taskIds.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return current;
      const taskIds = [...current.taskIds];
      const [moving] = taskIds.splice(from, 1);
      if (!moving) return current;
      taskIds.splice(to, 0, moving);
      return { ...current, taskIds };
    });
  }

  async function saveRoutine(event: FormEvent) {
    event.preventDefault();
    if (!routineDraft || routineSaving) return;
    if (!routineDraft.title.trim()) {
      setRoutineError(t("routine.nameRequired"));
      return;
    }
    if (routineDraft.taskIds.length < 2) {
      setRoutineError(t("routine.needsTwoSteps"));
      return;
    }
    setRoutineSaving(true);
    setRoutineError(null);
    try {
      const db = await openDatabase();
      try {
        const nowTs = Date.now();
        const input = { title: routineDraft.title, taskIds: routineDraft.taskIds };
        const newTasks = routineDraft.newSteps.filter((step) => routineDraft.taskIds.includes(step.id));
        if (routineDraft.id) await updateRoutine(db, routineDraft.id, input, nowTs, newTasks);
        else await createRoutine(db, `routine:${newId()}`, input, nowTs, newTasks);
      } finally {
        db.close();
      }
      setRoutineDraft(null);
      resetStepComposer(false);
      setReloadKey((key) => key + 1);
      toastManager.add({ title: t("routine.saved"), type: "success", timeout: 4000 });
    } catch (error) {
      console.error("No se pudo guardar la rutina", error);
      setRoutineError(t("routine.saveError"));
    } finally {
      setRoutineSaving(false);
    }
  }

  async function ungroupRoutine(routine: Routine) {
    try {
      const db = await openDatabase();
      try {
        await archiveRoutine(db, routine.id, Date.now());
      } finally {
        db.close();
      }
      setReloadKey((key) => key + 1);
      toastManager.add({ title: t("routine.ungrouped"), type: "success", timeout: 4000 });
    } catch (error) {
      console.error("No se pudo deshacer la rutina", error);
      setNotice(t("routine.saveError"));
    }
  }

  const active = tasks?.filter((task) => task.archivedAt === null) ?? [];
  const activeRoutines = routines?.filter((routine) => routine.archivedAt === null) ?? [];
  const routineByTaskId = new Map(
    activeRoutines.flatMap((routine) => routine.taskIds.map((taskId) => [taskId, routine] as const)),
  );
  const effectiveTaskOrder = useMemo(
    () => (tasks ? buildTaskOrder(tasks, taskOrder) : taskOrder),
    [tasks, taskOrder],
  );
  const categories = Array.from(new Set(active.map((task) => task.category.trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b),
  );

  function formBlock(): "any" | "morning" | "afternoon" | "night" | "custom" {
    if (!form?.useWindow) return "any";
    if (customWindow) return "custom";
    return windowPreset(form.windowStart, form.windowEnd);
  }

  function whenSelection(): string[] {
    if (newCustom || formBlock() === "custom") return ["custom"];
    if (newBlocks.length > 0) return newBlocks;
    return [formBlock()];
  }

  function chooseWhen(values: string[]) {
    const selectedBefore = whenSelection();
    const added = values.find((value) => !selectedBefore.includes(value));
    if (added === "custom") {
      chooseNewCustom();
      return;
    }
    if (added === "any") {
      chooseNewAny();
      return;
    }

    const blocks = BLOCKS.filter((block) => values.includes(block.value)).map((block) => block.value);
    if (blocks.length === 0) {
      chooseNewAny();
      return;
    }

    const exactTimeOnly = Boolean(form?.id && form.useFixedTime && !form.useWindow);
    const current = form?.id ? formBlock() : "any";
    const primary = isBlockKey(current) && blocks.includes(current) ? current : blocks[0];
    setNewBlocks(blocks);
    setNewCustom(false);
    setCustomWindow(false);
    if (exactTimeOnly) return;
    patch({
      useWindow: true,
      windowStart: BLOCK_RANGES[primary].start,
      windowEnd: BLOCK_RANGES[primary].end,
    });
  }

  function copiesToAdd(): BlockKey[] {
    if (!form?.id || newBlocks.length === 0) return [];
    if (form.useFixedTime && !form.useWindow) return newBlocks;
    if (newBlocks.length < 2) return [];
    const primary = formBlock();
    return newBlocks.filter((block) => block !== primary);
  }
  const dayTasks = active.filter((task) => task.days.includes(selectedDay));
  const dayTaskIds = new Set(dayTasks.map((task) => task.id));
  const dayRoutines = activeRoutines.filter((routine) => routine.taskIds.some((id) => dayTaskIds.has(id)));
  const groupedTaskIds = new Set(activeRoutines.flatMap((routine) => routine.taskIds));
  const routineCandidates = routineDraft
    ? active
        .filter((task) => {
          const existingRoutine = routineByTaskId.get(task.id);
          return !existingRoutine || existingRoutine.id === routineDraft.id;
        })
        .sort(
          (a, b) =>
            blockOrderRank(blockForTime(taskTime(a))) - blockOrderRank(blockForTime(taskTime(b))) ||
            (effectiveTaskOrder[a.id] ?? 0) - (effectiveTaskOrder[b.id] ?? 0),
        )
    : [];
  const routineCandidateBlocks = (
    [
      { key: "morning", labelKey: "blocks.morning" },
      { key: "afternoon", labelKey: "blocks.afternoon" },
      { key: "night", labelKey: "blocks.night" },
      { key: "any", labelKey: "blocks.none" },
    ] as const
  )
    .map((block) => ({
      ...block,
      tasks: routineCandidates.filter((task) => blockForTime(taskTime(task)) === block.key),
    }))
    .filter((block) => block.tasks.length > 0);
  function candidateMeta(task: Task): string {
    const parts = [common("minutes", { count: task.durationMin })];
    if (task.fixedTime) {
      parts.push(task.fixedTime);
    } else if (task.window && windowPreset(task.window.start, task.window.end) === "custom") {
      parts.push(t("range", { from: task.window.start, to: task.window.end }));
    }
    const daysNote = shortDaysSummary(task.days);
    if (daysNote) parts.push(daysNote);
    return parts.join(" · ");
  }
  const routineStepItems = routineDraft
    ? routineDraft.taskIds.flatMap((taskId) => {
        const existing = active.find((candidate) => candidate.id === taskId);
        if (existing) return [{ id: existing.id, title: existing.title }];
        const pending = routineDraft.newSteps.find((step) => step.id === taskId);
        return pending ? [{ id: pending.id, title: pending.input.title }] : [];
      })
    : [];
  function shortDaysSummary(days: readonly Weekday[]): string | null {
    if (days.length >= 7) return null;
    return WEEKDAYS.filter((day) => days.includes(day.value))
      .map((day) => t(day.short))
      .join(", ");
  }
  const dayCounts = WEEKDAYS.map((day) => ({
    ...day,
    count: active.filter((task) => task.days.includes(day.value)).length,
  }));
  const selectedDayInfo = WEEKDAYS.find((day) => day.value === selectedDay) ?? WEEKDAYS[0];
  const editCopies = copiesToAdd();
  const selectedMoment = formBlock();
  const selectedMomentOption = BLOCKS.find((block) => block.value === selectedMoment);
  const selectedMomentLabel =
    form?.id && form.useFixedTime && !form.useWindow
      ? t("exactTime")
      : selectedMomentOption
        ? t(selectedMomentOption.labelKey)
        : t(selectedMoment === "custom" ? "chooseHours" : "anyTime");

  const blocks = (
    [
      { key: "morning", labelKey: "blocks.morning" },
      { key: "afternoon", labelKey: "blocks.afternoon" },
      { key: "night", labelKey: "blocks.night" },
      { key: "any", labelKey: "blocks.none" },
    ] as const
  ).map((block) => ({
    ...block,
    tasks: sortTasksForDisplay(
      dayTasks.filter((task) => blockForTime(taskTime(task)) === block.key && !groupedTaskIds.has(task.id)),
      effectiveTaskOrder,
    ),
  }));

  function rememberSection(key: string, open: boolean) {
    setClosedSections((current) => ({ ...current, [key]: !open }));
  }

  const todayWeekday = weekdayOf(today);
  const occurrenceByTask = new Map(todayOccurrences.map((occurrence) => [occurrence.taskId, occurrence]));

  function renderTaskRow(task: Task, routine?: Routine, sectionIds?: readonly string[]) {
    const occurrence =
      selectedDay === todayWeekday && task.days.includes(selectedDay)
        ? occurrenceByTask.get(task.id)
        : undefined;
    const canConvertToRoutine = !routine && routines !== null;
    const indexInSection = sectionIds ? sectionIds.indexOf(task.id) : -1;
    const daysLabel = routine && !task.days.includes(selectedDay) ? shortDaysSummary(task.days) : null;
    return (
      <TaskRow
        key={task.id}
        task={task}
        routine={routine}
        canConvertToRoutine={canConvertToRoutine}
        canMoveUp={indexInSection > 0}
        canMoveDown={
          sectionIds !== undefined && indexInSection >= 0 && indexInSection < sectionIds.length - 1
        }
        onMove={
          sectionIds && indexInSection >= 0
            ? (offset) => {
                const targetId = sectionIds[indexInSection + offset];
                if (targetId) reorderSection(task.id, targetId, [...sectionIds]);
              }
            : undefined
        }
        daysLabel={daysLabel}
        occurrence={occurrence}
        now={now}
        menuTaskId={menuTaskId}
        onMenuChange={setMenuTaskId}
        onEdit={startEdit}
        onConvertToRoutine={startRoutineFromTask}
        onEditRoutine={startRoutineEdit}
        onDelete={setDeleteTask}
        onReactivate={(target, currentOccurrence) => void reactivate(target, currentOccurrence)}
        reactivatingId={reactivatingId}
      />
    );
  }

  function reorderRoutine(routine: Routine, activeId: string, overId: string) {
    const from = routine.taskIds.indexOf(activeId);
    const to = routine.taskIds.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const taskIds = [...routine.taskIds];
    const [moving] = taskIds.splice(from, 1);
    if (!moving) return;
    taskIds.splice(to, 0, moving);
    void openDatabase()
      .then(async (db) => {
        try {
          await updateRoutine(db, routine.id, { title: routine.title, taskIds }, Date.now());
        } finally {
          db.close();
        }
        setReloadKey((key) => key + 1);
      })
      .catch((error) => {
        console.error("No se pudo reordenar la rutina", error);
        setNotice(t("routine.saveError"));
      });
  }

  function reorderSection(activeId: string, overId: string, visibleIds: string[]) {
    const next = reorderTaskOrder(active, visibleIds, activeId, overId, orderRef.current);
    if (next === orderRef.current) return;
    orderRef.current = next;
    setTaskOrder(next);
    try {
      window.localStorage.setItem(taskOrderStorageKey, JSON.stringify(next));
    } catch {
      // Storage mirror is best-effort; IndexedDB remains the durable source.
    }
    void writeTaskOrder(next).catch(() => setNotice(t("notices.saveError")));
  }

  return (
    <section aria-labelledby="tasks-title" className="task-editor">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</p>
          <div className="mt-1 flex items-start gap-2">
            <h2 id="tasks-title" className="text-3xl font-semibold tracking-tight">
              {t("title")}
            </h2>
            <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
          </div>
        </div>
        {!form && !routineDraft ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={startNewRoutine}
              className="max-w-full min-h-11 rounded-none border border-control px-4 text-sm font-semibold"
            >
              {t("routine.new")}
            </button>
            <button
              type="button"
              onClick={startNew}
              className="max-w-full min-h-11 rounded-none bg-foreground px-4 text-sm font-semibold text-background"
            >
              {t("new")}
            </button>
          </div>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-4 border-l-2 border-line pl-4 text-sm" role="status">
          {notice}
        </p>
      ) : null}

      {routineDraft ? (
        <form
          onSubmit={saveRoutine}
          aria-labelledby="routine-form-title"
          className="mt-5 border-y border-line py-6"
        >
          <h3 id="routine-form-title" className="text-xl font-semibold">
            {routineDraft.id ? t("routine.editTitle") : t("routine.createTitle")}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted">{t("routine.help")}</p>
          <label htmlFor="routine-title" className="form-label mt-4 block">
            {t("routine.name")}
          </label>
          <input
            id="routine-title"
            name="routineTitle"
            value={routineDraft.title}
            placeholder={t("routine.namePlaceholder")}
            aria-invalid={Boolean(routineError) || undefined}
            aria-describedby={routineError ? "routine-form-error" : undefined}
            onChange={(event) => {
              setRoutineDraft({ ...routineDraft, title: event.target.value });
              if (routineError) setRoutineError(null);
            }}
            maxLength={1024}
            className="mt-1 min-h-11 w-full rounded-none border border-control bg-background px-3 text-base"
          />
          {routineCandidateBlocks.length > 0 ? (
            <fieldset className="mt-5">
              <legend className="text-sm font-semibold">{t("routine.chooseSteps")}</legend>
              {routineCandidateBlocks.length === 1 ? (
                <div className="mt-2 grid gap-1">
                  {routineCandidateBlocks[0]!.tasks.map((task) => (
                    <label
                      key={task.id}
                      className="flex min-h-11 items-center gap-3 border-b border-line py-2"
                    >
                      <input
                        type="checkbox"
                        name="routineStep"
                        value={task.id}
                        checked={routineDraft.taskIds.includes(task.id)}
                        disabled={
                          !routineDraft.taskIds.includes(task.id) &&
                          routineDraft.taskIds.length >= MAX_ROUTINE_STEPS
                        }
                        onChange={() => toggleRoutineMember(task.id)}
                        className="h-5 w-5 shrink-0 accent-foreground"
                      />
                      <span className="min-w-0 flex-1 text-sm font-medium">{task.title}</span>
                      <span className="shrink-0 text-xs text-muted">{candidateMeta(task)}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="mt-2">
                  {routineCandidateBlocks.map((block) => (
                    <details
                      key={block.key}
                      className="task-block task-plain mt-3"
                      open={Boolean(openRoutineBlocks[block.key])}
                      onToggle={(event) => {
                        const isOpen = event.currentTarget.open;
                        setOpenRoutineBlocks((current) => ({ ...current, [block.key]: isOpen }));
                      }}
                    >
                      <summary className="flex min-h-11 w-full cursor-pointer flex-wrap items-center justify-between gap-x-2 border-b-2 border-control pb-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                          {t(block.labelKey)}
                        </span>
                        <span className="flex items-center gap-2 text-xs tabular-nums text-muted">
                          {block.tasks.length}
                          <DisclosureChevron />
                        </span>
                      </summary>
                      <div className="grid gap-1">
                        {block.tasks.map((task) => (
                          <label
                            key={task.id}
                            className="flex min-h-11 items-center gap-3 border-b border-line py-2"
                          >
                            <input
                              type="checkbox"
                              name="routineStep"
                              value={task.id}
                              checked={routineDraft.taskIds.includes(task.id)}
                              disabled={
                                !routineDraft.taskIds.includes(task.id) &&
                                routineDraft.taskIds.length >= MAX_ROUTINE_STEPS
                              }
                              onChange={() => toggleRoutineMember(task.id)}
                              className="h-5 w-5 shrink-0 accent-foreground"
                            />
                            <span className="min-w-0 flex-1 text-sm font-medium">{task.title}</span>
                            <span className="shrink-0 text-xs text-muted">{candidateMeta(task)}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </fieldset>
          ) : null}
          <div className="mt-4">
            {!stepComposerOpen ? (
              <button
                type="button"
                onClick={() => setStepComposerOpen(true)}
                disabled={routineDraft.taskIds.length >= MAX_ROUTINE_STEPS}
                className="min-h-11 text-sm font-semibold underline underline-offset-4 disabled:opacity-60"
              >
                {t("routine.addNewStep")}
              </button>
            ) : (
              <div className="border-y border-line py-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8.5rem]">
                  <div>
                    <label htmlFor="routine-step-title" className="form-label">
                      {t("routine.newStepName")}
                    </label>
                    <input
                      id="routine-step-title"
                      name="newStepTitle"
                      value={newStepTitle}
                      placeholder={t("routine.newStepPlaceholder")}
                      maxLength={1024}
                      aria-invalid={Boolean(stepComposerError) || undefined}
                      aria-describedby={stepComposerError ? "routine-step-error" : undefined}
                      onChange={(event) => {
                        setNewStepTitle(event.target.value);
                        if (stepComposerError) setStepComposerError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          addInlineRoutineStep();
                        }
                      }}
                      className="mt-1 min-h-11 w-full rounded-none border border-control bg-background px-3 text-base"
                    />
                  </div>
                  <div>
                    <label htmlFor="routine-step-minutes" className="form-label">
                      {t("minutes")}
                    </label>
                    <NumberField.Root
                      id="routine-step-minutes"
                      value={newStepMinutes === "" ? null : Number(newStepMinutes)}
                      onValueChange={(value) => {
                        setNewStepMinutes(value === null ? "" : String(value));
                        if (stepComposerError) setStepComposerError(null);
                      }}
                      min={1}
                      step={1}
                      className="number-field"
                    >
                      <NumberField.Group className="number-field-group">
                        <NumberField.Decrement
                          className="number-field-stepper"
                          aria-label={common("decrease")}
                        >
                          −
                        </NumberField.Decrement>
                        <NumberField.Input className="number-field-input" />
                        <NumberField.Increment
                          className="number-field-stepper"
                          aria-label={common("increase")}
                        >
                          +
                        </NumberField.Increment>
                      </NumberField.Group>
                    </NumberField.Root>
                  </div>
                </div>
                {stepComposerError ? (
                  <p id="routine-step-error" className="form-error" role="alert">
                    {stepComposerError}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={addInlineRoutineStep}
                    className="min-h-11 border border-control px-4 text-sm font-semibold"
                  >
                    {t("routine.addStepConfirm")}
                  </button>
                  {routineCandidates.length >= 2 || routineDraft.taskIds.length >= 2 ? (
                    <button
                      type="button"
                      onClick={() => resetStepComposer(false)}
                      className="min-h-11 px-2 text-sm font-semibold text-muted underline underline-offset-4"
                    >
                      {common("close")}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <div className="mt-5">
            <h4 className="text-sm font-semibold">{t("routine.order")}</h4>
            {routineStepItems.length > 0 ? (
              <SortableTaskList
                tasks={routineStepItems}
                ordered
                ariaLabel={t("routine.order")}
                onReorder={(activeId, overId) => reorderRoutineDraft(activeId, overId)}
                renderTask={(item) => (
                  <RoutineOrderRow
                    key={item.id}
                    item={item}
                    step={routineDraft.taskIds.indexOf(item.id) + 1}
                    total={routineDraft.taskIds.length}
                    onMove={(offset) => moveRoutineMember(item.id, offset)}
                    onRemove={() => removeRoutineMember(item.id)}
                  />
                )}
              />
            ) : (
              <p className="mt-2 text-sm text-muted">{t("routine.orderEmpty")}</p>
            )}
          </div>
          {routineError ? (
            <p id="routine-form-error" className="mt-4 text-sm" role="alert">
              {routineError}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={routineSaving}
              className="min-h-11 bg-foreground px-6 text-sm font-semibold text-background disabled:opacity-60"
            >
              {routineSaving ? t("saving") : t("routine.save")}
            </button>
            <button
              type="button"
              disabled={routineSaving}
              onClick={closeRoutineEditor}
              className="min-h-11 border border-control px-6 text-sm font-semibold disabled:opacity-60"
            >
              {common("cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {form ? (
        <Form
          ref={formRef}
          noValidate
          errors={fieldErrors}
          onSubmit={save}
          className="mt-5 border-y border-line py-6"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xl font-semibold">{form.id ? t("edit") : t("new")}</h3>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="min-h-11 text-sm font-semibold text-muted underline underline-offset-4 disabled:opacity-60"
            >
              {t("back")}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <Field.Root name="title" className="form-field block sm:col-span-2">
              <Field.Label className="form-label">{t("name")}</Field.Label>
              <Field.Control
                ref={titleRef}
                value={form.title}
                onChange={(event) => patch({ title: event.target.value })}
                className="mt-1 min-h-11 w-full rounded-none border border-control bg-background px-3 text-base"
                placeholder={t("namePlaceholder")}
              />
              <Field.Error className="form-error" />
            </Field.Root>
            <div className="block">
              <span className="form-label">{t("type")}</span>
              {categoryMode === "existing" ? (
                <SelectControl
                  id="task-category-trigger"
                  value={form.category}
                  label={t("type")}
                  invalid={Boolean(fieldErrors.category)}
                  describedBy={fieldErrors.category ? "task-category-error" : undefined}
                  options={[
                    ...categories.map((category) => ({
                      value: category,
                      label: category.toLocaleUpperCase(),
                    })),
                    { value: "__new__", label: t("newType") },
                  ]}
                  onChange={(value) => {
                    if (value === "__new__") {
                      setCategoryMode("new");
                      patch({ category: "" });
                    } else {
                      patch({ category: value });
                    }
                  }}
                />
              ) : (
                <input
                  ref={categoryInputRef}
                  id="task-category-new"
                  autoFocus
                  aria-invalid={Boolean(fieldErrors.category) || undefined}
                  aria-describedby={fieldErrors.category ? "task-category-error" : undefined}
                  value={form.category}
                  onChange={(event) => patch({ category: event.target.value })}
                  className="mt-1 min-h-11 w-full rounded-none border border-control bg-background px-3 text-base"
                  placeholder={t("typePlaceholder")}
                />
              )}
              {fieldErrors.category ? (
                <p id="task-category-error" className="form-error" role="alert">
                  {fieldErrors.category}
                </p>
              ) : null}
              {categoryMode === "new" ? (
                <button
                  type="button"
                  onClick={() => {
                    setCategoryMode("existing");
                    patch({ category: categories[0] ?? "personal" });
                  }}
                  className="mt-2 min-h-11 text-sm font-semibold text-muted underline underline-offset-4"
                >
                  {t("chooseType")}
                </button>
              ) : null}
            </div>
            <Field.Root name="durationMin" className="form-field block">
              <label htmlFor="task-duration" className="form-label">
                {t("minutes")}
              </label>
              <NumberField.Root
                id="task-duration"
                value={form.durationMin === "" ? null : Number(form.durationMin)}
                onValueChange={(value) => patch({ durationMin: value === null ? "" : String(value) })}
                min={1}
                step={1}
                inputRef={durationRef}
                className="number-field"
              >
                <NumberField.Group className="number-field-group">
                  <NumberField.Decrement className="number-field-stepper" aria-label={common("decrease")}>
                    −
                  </NumberField.Decrement>
                  <NumberField.Input className="number-field-input" />
                  <NumberField.Increment className="number-field-stepper" aria-label={common("increase")}>
                    +
                  </NumberField.Increment>
                </NumberField.Group>
              </NumberField.Root>
              <Field.Error className="form-error" />
            </Field.Root>
            <div className="block">
              <span className="form-label">{t("importance")}</span>
              <SelectControl
                value={String(form.priority)}
                label={t("importance")}
                options={[3, 2, 1].map((priority) => ({
                  value: String(priority),
                  label: t(PRIORITY_LABEL[priority as 1 | 2 | 3]),
                }))}
                onChange={(value) => patch({ priority: Number(value) as 1 | 2 | 3 })}
              />
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="flex items-center gap-2 text-sm font-medium">
              {t("days")}
              <HelpTip label={t("daysHelp")}>{t("daysHelp")}</HelpTip>
            </legend>
            <ToggleGroup
              multiple
              value={form.days.map(String)}
              onValueChange={(values) => {
                const days = values
                  .map(Number)
                  .filter((value): value is Weekday => WEEKDAYS.some((day) => day.value === value));
                setForm((current) => (current ? { ...current, days } : current));
                setFieldErrors((current) => {
                  if (!current.days) return current;
                  const next = { ...current };
                  delete next.days;
                  return next;
                });
              }}
              id="habit-days"
              className="mt-2 flex flex-wrap gap-2"
              aria-label={t("days")}
              aria-invalid={fieldErrors.days ? true : undefined}
              aria-describedby={fieldErrors.days ? "task-days-error" : undefined}
            >
              {WEEKDAYS.map((day) => (
                <Toggle key={day.value} value={String(day.value)} className="day-toggle" data-day-toggle>
                  {t(day.short)}
                </Toggle>
              ))}
            </ToggleGroup>
            {fieldErrors.days ? (
              <p id="task-days-error" role="alert" className="form-error">
                {fieldErrors.days}
              </p>
            ) : null}
          </fieldset>

          <div className="mt-5 space-y-4">
            <fieldset>
              <legend className="flex items-center gap-2 text-sm font-medium">
                {t("when")}
                <HelpTip label={form.id ? t("whenHelpEdit") : t("whenHelpNew")}>
                  {form.id ? t("whenHelpEdit") : t("whenHelpNew")}
                </HelpTip>
              </legend>
              <ToggleGroup
                multiple
                value={whenSelection()}
                onValueChange={chooseWhen}
                className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5"
                aria-label={t("when")}
              >
                <Toggle value="any" className="day-toggle block-toggle justify-center">
                  {t("anyTime")}
                </Toggle>
                {BLOCKS.map((block) => (
                  <Toggle
                    key={block.value}
                    value={block.value}
                    className="day-toggle block-toggle justify-center"
                  >
                    {t(block.labelKey)}
                  </Toggle>
                ))}
                <Toggle value="custom" className="day-toggle block-toggle justify-center">
                  {t("chooseHours")}
                </Toggle>
              </ToggleGroup>
              <Reveal show={formBlock() === "custom"} reduceMotion={reduceMotion} className="mt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm text-muted">{t("from")}</span>
                    <input
                      type="time"
                      value={form.windowStart}
                      onChange={(event) => patch({ windowStart: event.target.value })}
                      className="mt-1 min-h-11 w-full rounded-none border border-control bg-background px-3 text-base"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-muted">{t("to")}</span>
                    <input
                      type="time"
                      value={form.windowEnd}
                      onChange={(event) => patch({ windowEnd: event.target.value })}
                      className="mt-1 min-h-11 w-full rounded-none border border-control bg-background px-3 text-base"
                    />
                  </label>
                </div>
              </Reveal>
              {form.useWindow ? (
                <p className="mt-2 text-xs tabular-nums text-muted">
                  {t("range", { from: form.windowStart, to: form.windowEnd })}
                </p>
              ) : null}
              {form.id ? (
                <div role="status" className="mt-3 border-s-2 border-line ps-3 text-sm text-muted">
                  <p>{t("whenEditLocation", { moment: selectedMomentLabel })}</p>
                  {editCopies.length > 0 ? (
                    <p>{t("whenEditCopiesPreview", { count: editCopies.length })}</p>
                  ) : null}
                </div>
              ) : null}
            </fieldset>

            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <Switch.Root
                checked={form.useFixedTime}
                onCheckedChange={(checked) => patch({ useFixedTime: checked })}
                className="runo-switch"
              >
                <Switch.Thumb className="runo-switch-thumb" />
              </Switch.Root>
              {t("exactTime")}
            </label>
            <Reveal show={form.useFixedTime} reduceMotion={reduceMotion} className="max-w-40">
              <label className="block">
                <span className="text-sm text-muted">{t("hours")}</span>
                <input
                  type="time"
                  value={form.fixedTime}
                  onChange={(event) => patch({ fixedTime: event.target.value })}
                  className="mt-1 min-h-11 w-full rounded-none border border-control bg-background px-3 text-base"
                />
              </label>
            </Reveal>

            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <Switch.Root
                checked={form.useShortStep}
                onCheckedChange={(checked) => patch({ useShortStep: checked })}
                className="runo-switch"
              >
                <Switch.Thumb className="runo-switch-thumb" />
              </Switch.Root>
              {t("firstStep")}
            </label>
            <Reveal show={form.useShortStep} reduceMotion={reduceMotion}>
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <Field.Root name="shortStepTitle" className="form-field block">
                  <Field.Label className="form-label text-muted">{t("firstStepWhat")}</Field.Label>
                  <Field.Control
                    ref={shortTitleRef}
                    value={form.shortStepTitle}
                    onChange={(event) => patch({ shortStepTitle: event.target.value })}
                    className="mt-1 min-h-11 w-full rounded-none border border-control bg-background px-3 text-base"
                    placeholder={t("firstStepPlaceholder")}
                  />
                  <Field.Error className="form-error" />
                </Field.Root>
                <Field.Root name="shortStepDuration" className="form-field block">
                  <label htmlFor="task-step-duration" className="form-label text-muted">
                    {t("minutes")}
                  </label>
                  <NumberField.Root
                    id="task-step-duration"
                    value={form.shortStepDuration === "" ? null : Number(form.shortStepDuration)}
                    onValueChange={(value) =>
                      patch({
                        shortStepDuration: value === null ? "" : String(value),
                      })
                    }
                    min={1}
                    step={1}
                    inputRef={shortMinutesRef}
                    className="number-field"
                  >
                    <NumberField.Group className="number-field-group">
                      <NumberField.Decrement className="number-field-stepper" aria-label={common("decrease")}>
                        −
                      </NumberField.Decrement>
                      <NumberField.Input className="number-field-input" />
                      <NumberField.Increment className="number-field-stepper" aria-label={common("increase")}>
                        +
                      </NumberField.Increment>
                    </NumberField.Group>
                  </NumberField.Root>
                  <Field.Error className="form-error" />
                </Field.Root>
              </div>
            </Reveal>
          </div>

          {formError ? (
            <p className="mt-4 border-l-2 border-accent pl-4 text-sm" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <motion.button
              type="submit"
              disabled={saving}
              className="min-h-11 rounded-none bg-foreground px-6 text-sm font-semibold text-background disabled:opacity-60"
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              transition={{ duration: 0.12 }}
            >
              {saving ? t("saving") : t("save")}
            </motion.button>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="min-h-11 rounded-none border border-control px-6 text-sm font-semibold disabled:opacity-60"
            >
              {t("cancel")}
            </button>
          </div>
        </Form>
      ) : null}

      {form || routineDraft ? null : loadError ? (
        <div className="mt-6 border-l-2 border-accent pl-4" role="alert">
          <p className="text-sm leading-6">{loadError}</p>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="mt-3 min-h-11 text-sm font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      ) : tasks === null ? (
        <p className="mt-6 text-sm text-muted">{t("list.loading")}</p>
      ) : (
        <>
          <div className="mt-5">
            <div className="days-strip">
              <ToggleGroup
                value={[String(selectedDay)]}
                onValueChange={(values) => {
                  const value = values[0];
                  if (value === undefined) return;
                  setSelectedDay(Number(value) as Weekday);
                }}
                className="days-strip-track"
                aria-label={t("list.filterAria")}
              >
                {dayCounts.map((day) => (
                  <Toggle
                    key={day.value}
                    value={String(day.value)}
                    aria-controls="day-tasks"
                    className="day-toggle min-h-14 px-1 py-2 text-xs"
                  >
                    <span className="block">{t(day.short)}</span>
                    <span className="mt-1 block tabular-nums opacity-70">{day.count}</span>
                  </Toggle>
                ))}
              </ToggleGroup>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <h3 id="day-tasks-title" className="text-2xl font-semibold tracking-tight">
              {t(selectedDayInfo.full)}
            </h3>
            <p className="text-sm text-muted">{t("list.count", { count: dayTasks.length })}</p>
          </div>

          <div id="day-tasks" role="region" aria-labelledby="day-tasks-title">
            {dayTasks.length === 0 ? (
              <div className="mt-4 border-l-2 border-line pl-4">
                <p className="text-sm leading-6 text-muted">{t("list.noTasks")}</p>
                <button
                  type="button"
                  onClick={startNew}
                  className="mt-2 min-h-11 text-sm font-semibold underline underline-offset-4"
                >
                  {t("list.addFor", { day: t(selectedDayInfo.full) })}
                </button>
              </div>
            ) : (
              <div className="mt-2">
                {dayRoutines.map((routine) => (
                  <section
                    key={routine.id}
                    className="mt-5 border border-line px-3"
                    aria-label={t("routine.groupLabel", { name: routine.title })}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
                      <div className="min-w-0">
                        <h4 className="text-base font-semibold">{routine.title}</h4>
                        <p className="mt-1 text-xs text-muted">
                          {t("routine.stepCount", { count: routine.taskIds.length })}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startRoutineEdit(routine)}
                          className="min-h-11 px-2 text-sm font-semibold underline underline-offset-4"
                        >
                          {t("routine.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void ungroupRoutine(routine)}
                          className="min-h-11 px-2 text-sm font-semibold underline underline-offset-4"
                        >
                          {t("routine.ungroup")}
                        </button>
                      </div>
                    </div>
                    <SortableTaskList
                      tasks={routine.taskIds.flatMap((taskId) => {
                        const task = active.find((candidate) => candidate.id === taskId);
                        return task ? [task] : [];
                      })}
                      ordered
                      ariaLabel={t("routine.order")}
                      onReorder={(activeId, overId) => reorderRoutine(routine, activeId, overId)}
                      renderTask={(task) => renderTaskRow(task, routine)}
                    />
                  </section>
                ))}
                {blocks.map((block) =>
                  block.tasks.length > 0 ? (
                    <details
                      key={block.key}
                      className="task-block task-plain mt-5"
                      open={!closedSections[block.key]}
                      onToggle={(event) => rememberSection(block.key, event.currentTarget.open)}
                    >
                      <summary className="flex min-h-11 w-full cursor-pointer flex-wrap items-center justify-between gap-x-2 border-b-2 border-control pb-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                          {t(block.labelKey)}
                        </span>
                        <span className="flex items-center gap-2 text-xs tabular-nums text-muted">
                          {block.tasks.length}
                          <DisclosureChevron />
                        </span>
                      </summary>
                      <SortableTaskList
                        tasks={block.tasks}
                        onReorder={reorderSection}
                        renderTask={(task) =>
                          renderTaskRow(
                            task,
                            undefined,
                            block.tasks.map((candidate) => candidate.id),
                          )
                        }
                      />
                    </details>
                  ) : null,
                )}
              </div>
            )}
          </div>
        </>
      )}

      <AlertDialog.Root
        open={deleteTask !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTask(null);
        }}
      >
        <AlertDialog.Portal className="runo-dialog-portal">
          <AlertDialog.Backdrop className="runo-dialog-backdrop" />
          <AlertDialog.Popup className="runo-dialog">
            <AlertDialog.Title className="runo-dialog-title">{t("list.deleteTitle")}</AlertDialog.Title>
            <AlertDialog.Description className="runo-dialog-copy">
              {t("list.deleteCopy")}
            </AlertDialog.Description>
            <div className="runo-dialog-actions">
              <AlertDialog.Close className="runo-dialog-cancel">{common("cancel")}</AlertDialog.Close>
              <AlertDialog.Close
                className="runo-dialog-danger"
                onClick={() => {
                  const task = deleteTask;
                  setDeleteTask(null);
                  if (task) void archive(task);
                }}
              >
                {t("list.deleteConfirm")}
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
