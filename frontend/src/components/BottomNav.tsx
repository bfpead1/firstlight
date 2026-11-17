import { BrandMark } from "./BrandMark";
import { NavLink } from "react-router-dom";
import {
  DumbbellIcon,
  HistoryIcon,
  HomeIcon,
  PlanIcon,
  SettingsIcon,
  StudyIcon,
} from "./icons";

const tabs = [
  { to: "/", label: "Home", Icon: HomeIcon, end: true },
  { to: "/plan", label: "Plan", Icon: PlanIcon, end: false },
  { to: "/study", label: "Study", Icon: StudyIcon, end: false },
  { to: "/workout", label: "Workout", Icon: DumbbellIcon, end: false },
  { to: "/history", label: "History", Icon: HistoryIcon, end: false },
  { to: "/settings", label: "Settings", Icon: SettingsIcon, end: false },
];

/** Tab bar pinned to the bottom of the screen on phones; hidden on larger screens. */
export function BottomNav() {
  return (
    <nav className="sticky bottom-0 z-10 border-t border-card-border bg-card md:hidden">
      <div className="mx-auto flex max-w-[480px] items-stretch justify-between px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2">
        {tabs.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 rounded-button px-1 py-1.5 transition-colors ${
                isActive ? "text-ink" : "text-ink-soft-42"
              }`
            }
          >
            <Icon width={22} height={22} />
            <span className="text-[10.5px] font-medium">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** Sidebar navigation for tablet and desktop widths; hidden on phones. */
export function SideNav() {
  return (
    <nav className="sticky top-0 hidden h-screen w-[224px] shrink-0 flex-col border-r border-card-border bg-page px-3 py-5 md:flex">
      <NavLink to="/" className="mb-7 flex items-center gap-2.5 px-2.5">
        <BrandMark className="h-[19px] w-[29px] text-accent" />
        <span className="font-display text-[18px] font-semibold tracking-[-0.03em] text-ink">Firstlight</span>
      </NavLink>
      <div className="flex flex-col gap-1">
        {tabs.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-button px-2.5 py-2 text-[14px] font-medium transition-colors ${
                isActive
                  ? "bg-ink/[0.06] text-ink"
                  : "text-ink-soft-55 hover:bg-divider hover:text-ink"
              }`
            }
          >
            <Icon width={18} height={18} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
