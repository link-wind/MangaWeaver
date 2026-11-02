import type { RunData } from "./types";
export const filename = (path: string) => path.split("/").pop() || path;
export function planVersions(run: RunData | null) {
  return (
    run?.records
      .filter((r) => r.data?.shot_list || r.data?.script)
      .sort((a, b) =>
        a.file.localeCompare(b.file, undefined, { numeric: true }),
      ) || []
  );
}
export function currentPlan(run: RunData | null) {
  const records = run?.records || [];
  return (
    records.find((r) => r.file === "planning_draft.json")?.data ||
    records.find((r) => r.file === "production.json")?.data ||
    records.find((r) => r.file === "planning_state.json")?.data
  );
}
export function sourceData(run: RunData | null) {
  return (
    currentPlan(run)?.source ||
    run?.records.find((r) => r.file === "source/manifest.json")?.data ||
    run?.records.find((r) => r.file === "source/prepared.json")?.data
  );
}
export function reviewRecords(run: RunData | null) {
  return (
    run?.records.filter(
      (r) =>
        r.data &&
        (r.data.accepted !== undefined ||
          r.data.video_review ||
          r.file === "visual_inspection.json" ||
          r.file === "TEST_REPORT.json"),
    ) || []
  );
}
export function taskEntries(run: RunData | null) {
  return (
    run?.records
      .filter((r) => r.file.endsWith("/tasks.json"))
      .flatMap((r) =>
        Object.entries(r.data?.candidates || {}).map(([id, entry]) => ({
          file: r.file,
          id,
          ...(entry as object),
        })),
      ) || []
  );
}
