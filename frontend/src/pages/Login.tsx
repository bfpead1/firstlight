import { BrandMark } from "../components/BrandMark";
import { useSearchParams } from "react-router-dom";
import { Card, ListRow } from "../components/Card";
import { GoogleIcon, MailIcon, PlanIcon } from "../components/icons";
import { GOOGLE_LOGIN_URL } from "../lib/auth";

const errorMessages: Record<string, string> = {
  access_denied: "Sign-in was cancelled. Try again whenever you're ready.",
  invalid_state: "That sign-in link expired. Please try again.",
  google_error: "Google couldn't complete the sign-in. Please try again.",
  not_allowed: "This Google account doesn't have access to this app.",
};

const permissions = [
  {
    Icon: PlanIcon,
    title: "Google Calendar",
    access: "view & edit events",
    detail: "Build today's schedule, and add or change events when you ask",
  },
  {
    Icon: MailIcon,
    title: "Gmail",
    access: "read-only",
    detail: "Read recent emails to surface what's important",
  },
];

export function Login() {
  const [params] = useSearchParams();
  const errorCode = params.get("error");
  const error = errorCode
    ? (errorMessages[errorCode] ?? errorMessages.google_error)
    : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col justify-center px-6 py-10">
      <header className="mb-8">
        <div className="mb-8 flex items-center gap-2.5">
          <BrandMark className="h-[23px] w-[35px] text-accent" />
          <span className="font-display text-[20px] font-semibold tracking-[-0.03em] text-ink">Firstlight</span>
        </div>
        <h1 className="font-display text-[32px] leading-[1.1] text-ink">
          Your calendar, inbox and plan for the day, ready when you wake up.
        </h1>
        <p className="mt-3 text-[15px] text-ink-soft-62">
          Sign in with Google to connect your calendar and Gmail.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-button border border-ink/15 bg-card px-4 py-3 text-[14px] text-ink"
        >
          {error}
        </p>
      )}

      <div className="mb-8">
        <a
          href={GOOGLE_LOGIN_URL}
          className="btn btn-secondary w-full gap-3 text-[15px]"
        >
          <GoogleIcon width={18} height={18} />
          Continue with Google
        </a>
      </div>

      <section>
        <h2 className="mb-2.5 text-[14px] font-medium text-ink">What Firstlight can see</h2>
        <Card padded={false}>
          {permissions.map(({ Icon, title, access, detail }, i) => (
            <ListRow key={title} first={i === 0}>
              <Icon width={20} height={20} className="shrink-0 text-ink-soft-62" />
              <div>
                <p className="text-[15px] font-medium text-ink">
                  {title}{" "}
                  <span className="text-[13px] font-normal text-ink-soft-55">
                    · {access}
                  </span>
                </p>
                <p className="text-[13px] text-ink-soft-62">{detail}</p>
              </div>
            </ListRow>
          ))}
        </Card>
        <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-ink-soft-55">
          Firstlight never sends email, and only changes your calendar when you edit an
          event in the app. You can disconnect anytime from Settings.
        </p>
      </section>
    </div>
  );
}
