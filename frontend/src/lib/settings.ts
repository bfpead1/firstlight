import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { Weekday } from "./workout";

export type Location = { latitude: number; longitude: number; label: string };

export type Settings = {
  workoutCycleStart: string;
  scripturePace: { daysPerWeek: number; minutesPerSession: number };
  scriptureLearningMode: boolean;
  /** A workout picked for one specific day, instead of the scheduled one. */
  workoutOverride: { date: string; weekIndex: number; weekday: Weekday } | null;
  /** What the AI workout generator designs around. */
  workoutProfile: { goals: string; equipment: string; daysPerWeek: number };
  location: Location | null;
  features: { ai: boolean; database: "json" | "supabase" };
};

export type SettingsPatch = Partial<Omit<Settings, "features">>;

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => getJson<Settings>("/api/settings"),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => sendJson<Settings>("/api/settings", "PATCH", patch),
    onSuccess: (settings) => queryClient.setQueryData(["settings"], settings),
  });
}

export type AiRoute = {
  provider: string;
  model: string;
  configured: boolean;
  /** true: in the provider's live model list. false: missing, preview, or provider not set up. null: unverified. */
  available: boolean | null;
  note: string | null;
};

export type AiStatus = {
  tasks: Record<string, AiRoute[]>;
  today: { calls: number; cached: number; fallbacks: number; rateLimited: number; failures: number; tokens: Record<string, number> };
};

/** Which model each AI task uses, models that failed the startup check, and today's counters. */
export function useAiStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["settings", "ai"],
    queryFn: () => getJson<AiStatus>("/api/settings/ai"),
    enabled,
  });
}
