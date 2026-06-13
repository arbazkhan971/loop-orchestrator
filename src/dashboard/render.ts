export function renderDashboard(projectName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Loop Orchestrator</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #101418; color: #e6edf3; }
    header { padding: 24px; border-bottom: 1px solid #29313a; display: flex; justify-content: space-between; align-items: center; }
    main { padding: 24px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .card { border: 1px solid #29313a; border-radius: 8px; background: #161b22; padding: 16px; }
    button { border: 1px solid #3b4552; background: #202733; color: #e6edf3; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
    pre { white-space: pre-wrap; max-height: 320px; overflow: auto; background: #0b0f14; padding: 12px; border-radius: 6px; }
    .muted { color: #9aa4b2; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Loop Orchestrator</h1>
      <div class="muted">${escapeHtml(projectName)}</div>
    </div>
    <button onclick="refresh()">Refresh</button>
  </header>
  <main id="sessions"></main>
  <script>
    async function refresh() {
      const data = await fetch('/api/status').then(r => r.json());
      const root = document.getElementById('sessions');
      root.innerHTML = '';
      for (const session of data.sessions) {
        const card = document.createElement('section');
        card.className = 'card';
        card.innerHTML = '<h2>' + session + '</h2><button>Load logs</button><pre class="muted">No logs loaded.</pre>';
        card.querySelector('button').onclick = async () => {
          const logs = await fetch('/api/logs?session=' + encodeURIComponent(session)).then(r => r.json());
          card.querySelector('pre').textContent = logs.logs || 'No output captured.';
        };
        root.appendChild(card);
      }
      if (!data.sessions.length) root.innerHTML = '<section class="card">No running sessions.</section>';
    }
    refresh();
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    return entities[char] ?? char;
  });
}
