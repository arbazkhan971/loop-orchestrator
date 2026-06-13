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
    section.board { margin: 0 24px; }
    table.board { width: 100%; border-collapse: collapse; font-size: 14px; }
    table.board th, table.board td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #29313a; vertical-align: top; }
    table.board th { color: #9aa4b2; font-weight: 600; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #202733; border: 1px solid #3b4552; }
    .status-done { background: #133a23; border-color: #1f6f3e; color: #7ee2a8; }
    .status-blocked, .status-rejected { background: #3a1717; border-color: #7a2b2b; color: #f3a9a9; }
    .status-needs-review, .status-in-progress, .status-claimed { background: #2c2a13; border-color: #6f661f; color: #e8dc8a; }
    .tag { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #9aa4b2; }
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
  <section class="board card" style="margin: 24px;">
    <h2 style="margin-top: 0;">Board</h2>
    <div id="board-summary" class="muted">Loading board…</div>
    <div id="board"></div>
  </section>
  <main id="sessions"></main>
  <script>
    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    }
    async function refreshBoard() {
      const summary = document.getElementById('board-summary');
      const root = document.getElementById('board');
      let data;
      try {
        data = await fetch('/api/board').then(r => r.json());
      } catch (err) {
        summary.textContent = 'Board unavailable.';
        root.innerHTML = '';
        return;
      }
      const views = (data && data.views) || [];
      if (!views.length) {
        summary.textContent = 'No board tasks yet.';
        root.innerHTML = '';
        return;
      }
      const byStatus = (data && data.byStatus) || {};
      const parts = Object.keys(byStatus).map(function (k) { return esc(k) + ': ' + byStatus[k]; });
      summary.innerHTML = esc(data.total) + ' task(s)' + (parts.length ? ' — ' + parts.join(', ') : '');
      let rows = '';
      for (const t of views) {
        const status = String(t.status || 'open');
        rows += '<tr>'
          + '<td class="tag">' + esc(t.id) + '</td>'
          + '<td>' + esc(t.title) + '</td>'
          + '<td class="tag">' + esc(t.claimedBy || t.assignee) + '</td>'
          + '<td><span class="status status-' + esc(status) + '">' + esc(status) + '</span></td>'
          + '</tr>';
      }
      root.innerHTML = '<table class="board"><thead><tr>'
        + '<th>ID</th><th>Title</th><th>Assignee</th><th>Status</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table>';
    }
    async function refresh() {
      refreshBoard();
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
