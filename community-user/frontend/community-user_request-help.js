document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("helplineButton");
  const panel = document.getElementById("helplinePanel");
  const close = document.getElementById("closeHelpline");
  if (!button || !panel) return;
  const setOpen = (open) => {
    panel.classList.toggle("show", open);
    panel.setAttribute("aria-hidden", String(!open));
    if (open) close?.focus(); else button.focus();
  };
  button.addEventListener("click", () => setOpen(!panel.classList.contains("show")));
  close?.addEventListener("click", () => setOpen(false));
  panel.addEventListener("click", (event) => { if (event.target === panel) setOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && panel.classList.contains("show")) setOpen(false); });
});
