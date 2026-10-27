import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./args";
import { loadExecutableManifest, type Effect } from "./manifest";

const TASK_KINDS = ["explicit_provider", "business_goal", "long_tail_native", "negative"] as const;
type TaskKind = (typeof TASK_KINDS)[number];

type EvalTask = {
  id: string;
  kind: TaskKind;
  prompt: string;
  answer: {
    provider: string | null;
    capabilityId: string | null;
    effects: Effect[];
    commands: string[];
    expected: { networkCalls: number; exitCode: number };
  };
  legacy: {
    workflow: string | null;
    disposition: "replace" | "keep" | "drop";
    reason: string;
  };
};

type EvalObservation = {
  id: string;
  selectedProvider: string | null;
  discoverySteps: number;
  firstExecutableCommandCorrect: boolean | null;
  negativeCorrect: boolean | null;
};

export type Slice5EvalReport = {
  tasks: number;
  distribution: Record<TaskKind, number>;
  metrics: {
    providerTop1: number;
    discoveryWithinTwoSteps: number;
    firstExecutableCommand: number;
    negativePrecision: number;
  };
  thresholds: {
    providerTop1: 0.95;
    discoveryWithinTwoSteps: 0.9;
    firstExecutableCommand: 0.9;
    negativePrecision: 0.95;
  };
  replaceTasks: number;
  passed: true;
};

const defaultTasksPath = fileURLToPath(new URL("../evals/tasks.jsonl", import.meta.url));
const defaultObservationsPath = fileURLToPath(
  new URL("../evals/slice5-observations.jsonl", import.meta.url),
);
const defaultManifestPaths = [
  fileURLToPath(new URL("../generated/dataforseo/manifest.json", import.meta.url)),
  fileURLToPath(new URL("../generated/posthog/manifest.json", import.meta.url)),
  fileURLToPath(new URL("../generated/google-ads/manifest.json", import.meta.url)),
  fileURLToPath(new URL("../generated/gsc/manifest.json", import.meta.url)),
  fileURLToPath(new URL("../generated/bing/manifest.json", import.meta.url)),
];

export async function evaluateSlice5(options?: {
  tasksPath?: string;
  observationsPath?: string;
  manifestPaths?: string[];
}): Promise<Slice5EvalReport> {
  const tasks = await readJsonLines<EvalTask>(options?.tasksPath ?? defaultTasksPath);
  const observations = await readJsonLines<EvalObservation>(
    options?.observationsPath ?? defaultObservationsPath,
  );
  const manifests = await Promise.all(
    (options?.manifestPaths ?? defaultManifestPaths).map(loadExecutableManifest),
  );
  const capabilities = new Map(
    manifests.flatMap((manifest) => [...manifest.records].map(([id, record]) => [id, record])),
  );

  assertUnique(tasks, "task");
  assertUnique(observations, "observation");
  assert(tasks.length === 40, `Expected 40 tasks, received ${tasks.length}.`);
  assert(observations.length === tasks.length, "Every task must have exactly one observation.");

  const distribution = Object.fromEntries(
    TASK_KINDS.map((kind) => [kind, tasks.filter((task) => task.kind === kind).length]),
  ) as Record<TaskKind, number>;
  const expectedDistribution: Record<TaskKind, number> = {
    explicit_provider: 10,
    business_goal: 15,
    long_tail_native: 10,
    negative: 5,
  };
  for (const kind of TASK_KINDS) {
    assert(
      distribution[kind] === expectedDistribution[kind],
      `Expected ${expectedDistribution[kind]} ${kind} tasks, received ${distribution[kind]}.`,
    );
  }

  const observationsById = new Map(observations.map((observation) => [observation.id, observation]));
  for (const task of tasks) {
    assert(task.prompt.trim().length > 0, `Task ${task.id} has an empty prompt.`);
    assert(task.legacy.reason.trim().length > 0, `Task ${task.id} has no disposition reason.`);
    const observation = observationsById.get(task.id);
    assert(observation, `Task ${task.id} has no observation.`);

    if (task.kind === "negative") {
      assert(task.answer.expected.networkCalls === 0, `Negative task ${task.id} permits a network call.`);
      assert(observation.negativeCorrect !== null, `Negative task ${task.id} has no precision result.`);
      continue;
    }

    assert(task.answer.provider !== null, `Positive task ${task.id} has no provider.`);
    assert(observation.negativeCorrect === null, `Positive task ${task.id} has a negative result.`);

    if (task.answer.capabilityId !== null) {
      const capability = capabilities.get(task.answer.capabilityId);
      assert(capability, `Task ${task.id} references missing capability ${task.answer.capabilityId}.`);
      assert(capability.provider === task.answer.provider, `Task ${task.id} provider does not match manifest.`);
      assert(
        sameSet(capability.effects, task.answer.effects),
        `Task ${task.id} effects do not match ${task.answer.capabilityId}.`,
      );
      const executable = task.answer.commands.find((command) => command.includes(" api call "));
      assert(executable, `Executable task ${task.id} has no api call command.`);
      const parsed = parseGkitCommand(executable);
      assert("capabilityId" in parsed, `Task ${task.id} did not parse as an api call.`);
      assert(parsed.capabilityId === task.answer.capabilityId, `Task ${task.id} command targets the wrong capability.`);
    }
  }

  for (const observation of observations) {
    assert(tasks.some((task) => task.id === observation.id), `Unknown observation ${observation.id}.`);
    assert(
      Number.isInteger(observation.discoverySteps) && observation.discoverySteps >= 0,
      `Observation ${observation.id} has invalid discoverySteps.`,
    );
  }

  const positive = tasks.filter((task) => task.kind !== "negative");
  const negative = tasks.filter((task) => task.kind === "negative");
  const executableObservations = positive
    .map((task) => observationsById.get(task.id)!)
    .filter((observation) => observation.firstExecutableCommandCorrect !== null);
  const metrics = {
    providerTop1: ratio(
      positive.filter(
        (task) => observationsById.get(task.id)!.selectedProvider === task.answer.provider,
      ).length,
      positive.length,
    ),
    discoveryWithinTwoSteps: ratio(
      positive.filter((task) => observationsById.get(task.id)!.discoverySteps <= 2).length,
      positive.length,
    ),
    firstExecutableCommand: ratio(
      executableObservations.filter((observation) => observation.firstExecutableCommandCorrect).length,
      executableObservations.length,
    ),
    negativePrecision: ratio(
      negative.filter((task) => observationsById.get(task.id)!.negativeCorrect === true).length,
      negative.length,
    ),
  };
  const thresholds = {
    providerTop1: 0.95,
    discoveryWithinTwoSteps: 0.9,
    firstExecutableCommand: 0.9,
    negativePrecision: 0.95,
  } as const;

  for (const [metric, threshold] of Object.entries(thresholds)) {
    assert(
      metrics[metric as keyof typeof metrics] >= threshold,
      `${metric} did not meet the ${threshold} threshold.`,
    );
  }

  return {
    tasks: tasks.length,
    distribution,
    metrics,
    thresholds,
    replaceTasks: tasks.filter((task) => task.legacy.disposition === "replace").length,
    passed: true,
  };
}

function parseGkitCommand(command: string) {
  const argv = command.trim().split(/\s+/);
  assert(argv.shift() === "gkit", `Expected a gkit command: ${command}`);
  return parseArgs(argv);
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const source = await readFile(path, "utf8");
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}.`, { cause: error });
      }
    });
}

function assertUnique(values: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    assert(value.id.trim().length > 0, `Encountered an empty ${label} ID.`);
    assert(!ids.has(value.id), `Duplicate ${label} ID ${value.id}.`);
    ids.add(value.id);
  }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value as Effect));
}

function ratio(numerator: number, denominator: number): number {
  assert(denominator > 0, "Metric denominator must be positive.");
  return numerator / denominator;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

if (import.meta.main) {
  const report = await evaluateSlice5();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
