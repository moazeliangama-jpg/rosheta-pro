/**
 * ربط منطق تجربة الاستخدام بحالة البرنامج الحقيقية.
 *
 * كل القيم بتيجي من الـ store (شغل حقيقي) — مفيش أي حالة وهمية،
 * ولو معلومة لسه مش معروفة (زي اتصال واتساب) بنسيبها `undefined`
 * بدل ما نخمّن.
 */
import { useMemo } from "react";
import { useAppStore } from "./store";
import {
  canStartRun,
  nextBestAction,
  readinessChecks,
  smartTips,
  stageProgress,
  type UxSnapshot,
} from "./ux";

export function useUxSnapshot(extra: { waState?: string } = {}): UxSnapshot {
  const patients = useAppStore((s) => s.patients);
  const settings = useAppStore((s) => s.settings);
  const loggedIn = useAppStore((s) => s.niceDeerLoggedIn);
  const cases = useAppStore((s) => s.cases);
  const session = useAppStore((s) => s.session);
  const outreach = useAppStore((s) => s.outreach);
  const waState = extra.waState;

  return useMemo<UxSnapshot>(() => {
    const list = Object.values(cases);
    return {
      hasPatients: patients.length > 0,
      patientsCount: patients.length,
      hasPayer: Boolean(settings.payerId),
      loggedIn,
      cases: list.map((c) => ({ rx: { status: c.rx.status }, valid: c.valid, hasDrugs: c.hasDrugs })),
      sessionState: session.state,
      lastSab: session.lastSab || undefined,
      waState,
      outreachQueued: outreach.filter((m) => m.status === "queued" || m.status === "failed").length,
    };
  }, [patients.length, settings.payerId, loggedIn, cases, session.state, session.lastSab, outreach, waState]);
}

/** كل اللي الواجهة محتاجاه من UX في نداء واحد */
export function useUx(extra: { waState?: string } = {}) {
  const snap = useUxSnapshot(extra);
  const action = useMemo(() => nextBestAction(snap), [snap]);
  const stages = useMemo(() => stageProgress(snap), [snap]);
  const checks = useMemo(() => readinessChecks(snap), [snap]);
  const tips = useMemo(() => smartTips(snap), [snap]);
  const ready = useMemo(() => canStartRun(snap), [snap]);
  return { snap, action, stages, checks, tips, ready };
}
