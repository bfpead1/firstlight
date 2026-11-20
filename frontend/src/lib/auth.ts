import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, isGuest } from "./guest";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  connections: { gmail: boolean; calendar: boolean; calendarEdit: boolean };
};

/** Full-page navigation: the backend redirects to Google and back. */
export const GOOGLE_LOGIN_URL = "/api/auth/google";
/** Forces Google's consent screen, for re-granting Gmail/Calendar access. */
export const GOOGLE_RECONNECT_URL = "/api/auth/google?consent=1";

async function fetchMe(): Promise<CurrentUser | null> {
  const res = await apiFetch("/api/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Failed to load session (${res.status})`);
  return res.json();
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

function useSessionEndingMutation(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const guest = isGuest();
      const res = await apiFetch(path, { method: "POST" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return { guest };
    },
    onSuccess: ({ guest }) => {
      // Leaving guest mode: reload into the login page so no sample data stays in memory.
      if (guest) return window.location.assign("/login");
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
    },
  });
}

export const useLogout = () => useSessionEndingMutation("/api/auth/logout");
export const useDisconnectGoogle = () => useSessionEndingMutation("/api/auth/disconnect");
