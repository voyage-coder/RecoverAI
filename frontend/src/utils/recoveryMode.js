/** Two merchant-facing modes. Stored values stay MANUAL / AUTOMATIC. */

export const RECOVERY_MODES = [
  {
    id: "MANUAL",
    label: "Manual",
    detail:
      "You run each allowed action from the case or Operations. Best when you want to click through the demo.",
  },
  {
    id: "AUTOMATIC",
    label: "Run agent on every case",
    detail:
      "After you save, the agent runs every open case that Safety and your rupee cap still allow. Tagged Agent on the timeline.",
  },
];

export function recoveryModeLabel(mode) {
  const key = String(mode || "MANUAL").toUpperCase();
  if (key === "AUTOMATIC") return "Run agent on every case";
  if (key === "APPROVAL_REQUIRED") return "Manual";
  return "Manual";
}

export function normalizeRecoveryMode(mode) {
  return String(mode || "MANUAL").toUpperCase() === "AUTOMATIC"
    ? "AUTOMATIC"
    : "MANUAL";
}
