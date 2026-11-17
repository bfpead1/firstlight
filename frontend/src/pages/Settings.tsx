import { useState } from "react";
import { CanvasConnect } from "../components/CanvasConnect";
import { Card, ListRow } from "../components/Card";
import { SecondaryButton } from "../components/PrimaryButton";
import { SectionLabel } from "../components/SectionLabel";
import {
  GOOGLE_RECONNECT_URL,
  useCurrentUser,
  useDisconnectGoogle,
  useLogout,
} from "../lib/auth";
import { type AiRoute, useAiStatus, useSettings, useUpdateSettings } from "../lib/settings";
import { setTheme, type ThemeChoice, useTheme } from "../lib/theme";
import { currentPosition, type PlaceResult, searchPlaces } from "../lib/weather";

export function Settings() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const disconnect = useDisconnectGoogle();

  if (!user) return null;

  const { calendar, calendarEdit, gmail } = user.connections;
  const googleServices = [
    {
      id: "calendar",
      label: "Google Calendar",
      connected: calendar,
      status: calendarEdit ? "View & edit" : calendar ? "View only" : "Not allowed",
    },
    { id: "gmail", label: "Gmail", connected: gmail, status: gmail ? "Read only" : "Not allowed" },
  ];
  const missingGoogleAccess = !calendarEdit || !gmail;

  return (
    <div className="px-6 pb-8 pt-7">
      <h1 className="mb-5 font-display text-[28px] leading-tight text-ink">
        Settings
      </h1>

      <section className="mb-5">
        <SectionLabel>Account</SectionLabel>
        <Card>
          <div className="flex items-center gap-3">
            {user.picture ? (
              <img
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
                className="h-11 w-11 shrink-0 rounded-full"
              />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[16px] font-medium text-accent">
                {user.name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink">
                {user.name}
              </p>
              <p className="truncate text-[13px] text-ink-soft-62">{user.email}</p>
            </div>
          </div>
        </Card>
      </section>

      <section className="mb-5">
        <SectionLabel>Connected accounts</SectionLabel>
        <Card padded={false}>
          {googleServices.map((s, i) => (
            <ListRow key={s.id} first={i === 0} className="justify-between">
              <span className="text-[15px] text-ink">{s.label}</span>
              <span
                className={`text-[13px] font-semibold ${
                  s.connected ? "text-ink" : "text-ink-soft-55"
                }`}
              >
                {s.status}
              </span>
            </ListRow>
          ))}
          {missingGoogleAccess && (
            <a
              href={GOOGLE_RECONNECT_URL}
              className="block border-t border-divider px-[18px] py-3 text-[14px] font-semibold text-ink"
            >
              Grant missing Google access
            </a>
          )}
          <CanvasConnect />
        </Card>
      </section>

      <AppearanceSection />
      <LocationSection />
      <StatusSection />
      <AiRoutingSection />

      <div className="space-y-3">
        <SecondaryButton
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Sign out
        </SecondaryButton>
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                "Disconnect Google? Morning will lose access to your Calendar and Gmail and you'll be signed out.",
              )
            ) {
              disconnect.mutate();
            }
          }}
          disabled={disconnect.isPending}
          className="w-full py-2 text-[13px] font-semibold text-ink-soft-55"
        >
          Disconnect Google account
        </button>
      </div>
    </div>
  );
}

function LocationSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const found = await searchPlaces(query.trim());
      setResults(found);
      if (!found.length) setMessage("No places found.");
    } catch {
      setMessage("Search failed. Try again.");
    }
  }

  async function useCurrent() {
    setMessage(null);
    try {
      update.mutate({ location: await currentPosition() });
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <section className="mb-5">
      <SectionLabel>Weather location</SectionLabel>
      <Card>
        <p className="mb-3 text-[14px] text-ink">
          {settings.data?.location?.label ?? "Not set"}
        </p>
        <form onSubmit={search} className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city, e.g. Provo"
            className="min-w-0 flex-1 rounded-button border border-card-border bg-page px-3 py-2 text-[14px] text-ink"
          />
          <button
            type="submit"
            disabled={query.trim().length < 2}
            className="btn btn-primary shrink-0"
          >
            Search
          </button>
        </form>
        {results && results.length > 0 && (
          <ul className="mt-2 divide-y divide-divider">
            {results.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => {
                    update.mutate({ location: { latitude: place.latitude, longitude: place.longitude, label: place.label } });
                    setResults(null);
                    setQuery("");
                  }}
                  className="w-full py-2.5 text-left text-[14px] text-ink"
                >
                  {place.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={useCurrent}
          className="mt-3 text-[13px] font-semibold text-ink underline"
        >
          Use my current location
        </button>
        {message && <p className="mt-2 text-[13px] text-ink-soft-62">{message}</p>}
      </Card>
    </section>
  );
}

function StatusSection() {
  const settings = useSettings();
  const features = settings.data?.features;
  if (!features) return null;
  return (
    <section className="mb-5">
      <SectionLabel>App status</SectionLabel>
      <Card padded={false}>
        <ListRow first className="justify-between">
          <span className="text-[15px] text-ink">AI features (Groq)</span>
          <span className="text-[13px] font-semibold text-ink-soft-62">
            {features.ai ? "On" : "Off (no API key)"}
          </span>
        </ListRow>
        <ListRow className="justify-between">
          <span className="text-[15px] text-ink">Data storage</span>
          <span className="text-[13px] font-semibold text-ink-soft-62">
            {features.database === "supabase" ? "Supabase" : "Local file (dev)"}
          </span>
        </ListRow>
      </Card>
    </section>
  );
}

const themeOptions: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Light / dark switch. Saved on this device only. */
function AppearanceSection() {
  const theme = useTheme();
  return (
    <section className="mb-5">
      <SectionLabel>Appearance</SectionLabel>
      <Card>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-button bg-page p-1">
          {themeOptions.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              onClick={() => setTheme(value)}
              className={`min-h-10 rounded-[6px] text-[14px] font-medium transition-colors ${
                theme === value
                  ? "bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,0.12)] ring-1 ring-card-border"
                  : "text-ink-soft-62 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[13px] text-ink-soft-55">System follows your device's light or dark setting.</p>
      </Card>
    </section>
  );
}

const taskLabels: Record<string, string> = {
  triage: "Email triage",
  extract: "Deadline extraction",
  plan: "Daily plan",
  workout: "Workout coach",
};

/** The model each AI task is using right now, plus any model that failed the startup check. */
function AiRoutingSection() {
  const settings = useSettings();
  const enabled = settings.data?.features.ai ?? false;
  const status = useAiStatus(enabled);
  if (!enabled || !status.data) return null;

  const tasks = Object.entries(status.data.tasks).filter(([, routes]) => routes.length);
  const problems = tasks.flatMap(([, routes]) =>
    routes.filter((r) => r.configured && r.available === false),
  );
  const { today } = status.data;

  return (
    <section className="mb-5">
      <SectionLabel>AI models</SectionLabel>
      <Card padded={false}>
        {problems.length > 0 && (
          <div role="alert" className="border-b border-divider bg-accent-soft px-[18px] py-3 text-[13.5px] text-ink">
            {problems.map((r) => (
              <p key={`${r.provider}:${r.model}`}>
                {r.note}. Using the next model in the list instead.
              </p>
            ))}
          </div>
        )}
        {tasks.map(([task, routes], i) => {
          const active: AiRoute | undefined = routes.find((r) => r.available !== false);
          const isFallback = active && active !== routes[0];
          return (
            <ListRow key={task} first={i === 0 && problems.length === 0} className="justify-between">
              <span className="text-[15px] text-ink">{taskLabels[task] ?? task}</span>
              <span className={`text-right text-[13px] ${active ? "text-ink-soft-62" : "font-medium text-danger"}`}>
                {active ? `${active.provider} · ${active.model}` : "No usable model"}
                {isFallback && <span className="ml-1.5 text-accent">(fallback)</span>}
                {active?.available === null && <span className="ml-1.5">(unverified)</span>}
              </span>
            </ListRow>
          );
        })}
        <p className="border-t border-divider px-[18px] py-2.5 text-[12.5px] text-ink-soft-55">
          Today: {today.calls} calls · {today.cached} cached · {today.fallbacks} fallbacks · {today.rateLimited} rate limits ·{" "}
          {today.failures} failures
        </p>
      </Card>
    </section>
  );
}
