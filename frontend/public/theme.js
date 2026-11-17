// Applies the saved light/dark choice before the app paints (see src/lib/theme.ts).
// A separate file rather than an inline script, so the Content-Security-Policy can stay strict.
try {
  var theme = localStorage.getItem("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (e) {
  // Storage blocked: the system setting applies.
}
