function Settings() {
  return (
    <div className="page-enter space-y-6">
      <div>
        <p className="eyebrow">Configuration</p>
        <h2 className="page-title">Settings</h2>
      </div>

      <div className="panel relative overflow-hidden p-8">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-pine-soft blur-2xl" />
        <div className="relative max-w-lg">
          <p className="font-display text-2xl font-medium text-ink">
            Settings arrive later.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-mute">
            Authentication, notification preferences, and operator controls
            will land here when you are ready — the recovery desk stays open
            without them for now.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Settings;
