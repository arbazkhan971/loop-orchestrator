/**
 * The dashboard HTML — zero runtime dependencies: one self-contained document with
 * inline CSS and vanilla JS that polls the JSON endpoints (every 2.5s) and renders an
 * insightful, actionable view of the autonomous run:
 *
 *  - a KPI header (progress, agents active, $ vs budget, under-review, retries, ETA)
 *  - a "needs attention" strip (blocked / rejected / escalated + budget warnings)
 *  - per-agent swimlane cards (current task, live idle timer, output peek)
 *  - a kanban board by status with dependency chips, "ready" + critical-path markers
 *  - an activity timeline (events + inter-agent messages)
 *
 * renderDashboard(projectName) keeps its signature (and HTML-escapes the name) so the
 * existing dashboard-render test holds.
 */
export function renderDashboard(projectName: string): string {
  const safeName = escapeHtml(projectName);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Loop Orchestrator — ${safeName}</title>
  <style>${STYLE}</style>
</head>
<body>
  <header>
    <h1>🛰 Loop Orchestrator <span class="sub">${safeName}</span></h1>
    <div class="hdr-right">
      <span class="live"><span class="dot"></span><span id="livetext">connecting…</span></span>
      <button class="refresh" onclick="tick()">Refresh</button>
    </div>
  </header>

  <section class="kpis" id="kpis"></section>
  <section id="attention-strip"></section>

  <main>
    <div class="card span-agents"><h2>Agents <span class="count" id="agents-count"></span></h2><div class="agents" id="agents"></div></div>
    <div class="card span-board"><h2>Task board <span class="count" id="board-count"></span></h2><div class="kanban" id="kanban"></div></div>
    <div class="card span-timeline"><h2>Activity <span class="count">live</span></h2><div class="timeline" id="timeline"></div></div>
  </main>

  <script>${CLIENT_JS}</script>
</body>
</html>`;
}

const STYLE = String.raw`
:root {
  color-scheme: dark;
  --bg:#0b0f14; --panel:#11161d; --panel2:#161c25; --border:#232c38;
  --fg:#e6edf3; --muted:#8b97a7; --dim:#5b6675;
  --green:#3fb950; --amber:#d29922; --red:#f85149; --blue:#58a6ff;
  --cyan:#56b6c2; --magenta:#c98bdb; --grey:#6e7681; --orange:#f0a868;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
*{box-sizing:border-box;} body{margin:0;background:var(--bg);color:var(--fg);font-size:14px;}
header{display:flex;align-items:center;justify-content:space-between;padding:13px 20px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(11,15,20,.93);backdrop-filter:blur(6px);z-index:20;}
header h1{font-size:1.02rem;margin:0;display:flex;align-items:center;gap:9px;font-weight:650;}
header .sub{color:var(--muted);font-size:.8rem;font-weight:400;}
.hdr-right{display:flex;align-items:center;gap:14px;}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:.76rem;}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(63,185,80,.5);}70%{box-shadow:0 0 0 6px rgba(63,185,80,0);}100%{box-shadow:0 0 0 0 rgba(63,185,80,0);}}
.refresh{border:1px solid var(--border);background:var(--panel2);color:var(--fg);border-radius:8px;padding:6px 11px;cursor:pointer;font-size:.8rem;}
.refresh:hover{border-color:var(--blue);}

.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;padding:16px 20px 6px;}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:11px 14px;transition:background .4s;}
.kpi.flash{background:#1b2530;}
.kpi .label{color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;}
.kpi .value{font-size:1.5rem;font-weight:650;margin-top:3px;line-height:1.1;}
.kpi .value small{font-size:.8rem;color:var(--muted);font-weight:400;}
.bar{height:5px;border-radius:4px;background:var(--panel2);margin-top:9px;overflow:hidden;}
.bar>span{display:block;height:100%;background:var(--green);transition:width .5s;}
.bar.warn>span{background:var(--amber);} .bar.crit>span{background:var(--red);}

#attention-strip:not(:empty){padding:8px 20px 4px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;}
.att{border-radius:9px;padding:9px 12px;font-size:.82rem;border:1px solid var(--border);background:var(--panel);}
.att.warn{border-color:#5a4a16;background:#211c0e;color:var(--amber);}
.att.blocked,.att.escalated{border-color:#5a2020;background:#211010;}
.att.rejected{border-color:#4a2a52;background:#1d1322;}
.att .att-top{display:flex;justify-content:space-between;gap:8px;align-items:center;}
.att code{font-family:ui-monospace,monospace;color:var(--fg);}
.att .why{color:var(--muted);font-size:.76rem;margin-top:3px;}

main{padding:10px 20px 28px;display:grid;grid-template-columns:minmax(250px,1fr) 1.7fr minmax(280px,1fr);gap:14px;align-items:start;}
@media (max-width:1100px){main{grid-template-columns:1fr;}}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.card>h2{font-size:.84rem;margin:0;padding:11px 15px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-weight:600;}
.card>h2 .count{color:var(--muted);font-weight:400;font-size:.76rem;}

.agents{display:flex;flex-direction:column;gap:9px;padding:12px 14px;}
.agent{background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;border-left:3px solid var(--grey);}
.agent.working{border-left-color:var(--blue);} .agent.review-pending{border-left-color:var(--amber);}
.agent.blocked{border-left-color:var(--red);} .agent.idle{opacity:.66;}
.agent .top{display:flex;align-items:center;justify-content:space-between;gap:6px;}
.agent .name{font-weight:600;}
.agent .role-meta{color:var(--dim);font-size:.72rem;margin-top:1px;}
.agent .task{margin-top:7px;font-size:.82rem;}
.agent .muted{color:var(--muted);font-size:.76rem;margin-top:5px;}
.agent .stat-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;color:var(--dim);font-size:.71rem;}
.agent .idle-amber{color:var(--amber);} .agent .idle-red{color:var(--red);}
.statepill{font-size:.66rem;padding:1px 7px;border-radius:999px;border:1px solid var(--border);text-transform:capitalize;}
.statepill.working{color:var(--blue);} .statepill.review-pending{color:var(--amber);}
.statepill.blocked{color:var(--red);} .statepill.idle{color:var(--grey);}
.agent details{margin-top:8px;} .agent summary{cursor:pointer;color:var(--dim);font-size:.72rem;}
.agent pre{white-space:pre-wrap;max-height:160px;overflow:auto;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:.7rem;margin:6px 0 0;color:var(--muted);}

.kanban{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(155px,1fr);gap:10px;padding:12px 14px;overflow-x:auto;}
.lane h3{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 8px;display:flex;justify-content:space-between;}
.ticket{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:8px;border-top:2px solid var(--grey);}
.ticket.crit{box-shadow:inset 2px 0 0 var(--orange);}
.ticket .tid{color:var(--dim);font-size:.69rem;font-family:ui-monospace,monospace;display:flex;justify-content:space-between;}
.ticket .ttitle{font-size:.8rem;margin:2px 0 5px;}
.ticket .tmeta{display:flex;justify-content:space-between;color:var(--dim);font-size:.68rem;}
.chip{display:inline-block;font-size:.64rem;padding:0 6px;border-radius:999px;border:1px solid var(--border);margin:4px 4px 0 0;color:var(--dim);}
.chip.block{color:var(--red);border-color:#5a2020;} .chip.ok{color:var(--green);border-color:#1f5a2a;}
.badge-ready{font-size:.64rem;color:var(--green);border:1px solid #1f5a2a;border-radius:999px;padding:0 6px;}
.badge-crit{font-size:.64rem;color:var(--orange);}

.s-done{color:var(--green);}.s-open{color:var(--grey);}.s-claimed{color:var(--cyan);}
.s-in-progress{color:var(--blue);}.s-needs-review{color:var(--amber);}
.s-blocked{color:var(--red);}.s-rejected{color:var(--magenta);}.s-escalated{color:var(--orange);}
.bt-done{border-top-color:var(--green);}.bt-open{border-top-color:var(--grey);}.bt-claimed{border-top-color:var(--cyan);}
.bt-in-progress{border-top-color:var(--blue);}.bt-needs-review{border-top-color:var(--amber);}
.bt-blocked{border-top-color:var(--red);}.bt-rejected{border-top-color:var(--magenta);}.bt-escalated{border-top-color:var(--orange);}

.timeline{padding:4px 14px 12px;max-height:460px;overflow-y:auto;}
.tl{display:flex;gap:9px;padding:7px 0;border-bottom:1px solid var(--border);}
.tl .when{color:var(--dim);font-size:.69rem;font-variant-numeric:tabular-nums;white-space:nowrap;min-width:52px;}
.tl .who{font-weight:600;font-size:.74rem;white-space:nowrap;}
.tl .what{color:var(--muted);font-size:.77rem;}
.tl.msg .what{color:var(--cyan);}
.empty{color:var(--dim);padding:18px;text-align:center;font-size:.82rem;}
code{font-family:ui-monospace,SFMono-Regular,monospace;}
`;

const CLIENT_JS = String.raw`
const LANES=["open","claimed","in-progress","needs-review","blocked","rejected","escalated","done"];
const LANE_LABEL={"open":"Open","claimed":"Claimed","in-progress":"In progress","needs-review":"In review","blocked":"Blocked","rejected":"Rejected","escalated":"Escalated","done":"Done"};
let prev={};

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function ago(ts){if(!ts)return"";const d=(Date.now()-new Date(ts).getTime())/1000;if(d<60)return Math.floor(d)+"s";if(d<3600)return Math.floor(d/60)+"m";if(d<86400)return Math.floor(d/3600)+"h";return Math.floor(d/86400)+"d";}
function dur(ms){if(ms==null)return"—";if(ms<60000)return Math.round(ms/1000)+"s";if(ms<3600000)return Math.round(ms/60000)+"m";return (ms/3600000).toFixed(1)+"h";}
function clock(ts){try{return new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch{return"";}}
async function getJSON(u){try{const r=await fetch(u);return r.ok?await r.json():null;}catch{return null;}}

function kpi(key,label,value,sub,bar){
  const flash=prev[key]!==undefined&&prev[key]!==value?" flash":"";prev[key]=value;
  const b=bar?'<div class="bar '+(bar.cls||'')+'"><span style="width:'+bar.pct+'%"></span></div>':'';
  return '<div class="kpi'+flash+'"><div class="label">'+esc(label)+'</div><div class="value">'+value+(sub?' <small>'+sub+'</small>':'')+'</div>'+b+'</div>';
}
function renderKpis(o){
  const el=document.getElementById("kpis");
  if(!o||!o.totals||!o.totals.total){el.innerHTML=kpi("p","Progress","0%","no run yet");document.getElementById("livetext").textContent="no active run";return;}
  const t=o.totals;
  const spend=o.budgetUsd>0
    ? kpi("sp","Spend","$"+o.spendUsd.toFixed(2),"of $"+o.budgetUsd.toFixed(2),{pct:o.budgetPct||0,cls:o.budgetPct>=90?'crit':o.budgetPct>=75?'warn':''})
    : kpi("sp","Spend","$"+o.spendUsd.toFixed(2),(o.tokensOut?Math.round(o.tokensOut/1000)+"k tok":""));
  el.innerHTML=
    kpi("p","Progress",o.progressPct+"%",t.done+"/"+t.total+" done",{pct:o.progressPct})+
    kpi("a","Agents active",o.agentsActive,"of "+o.agentsTotal)+
    kpi("ip","In progress",t.inProgress,t.needsReview+" in review")+
    kpi("bl","Blocked",t.blocked,(o.escalated?o.escalated+" escalated":"")||"")+
    kpi("rt","Retries",o.retries,o.rejections+" rejected")+
    kpi("eta","Est. left",dur(o.estCompletionMs))+
    spend;
  document.getElementById("livetext").textContent=o.lastActivity?("updated "+ago(o.lastActivity)+" ago"):"idle";
}

function renderAttention(att){
  const el=document.getElementById("attention-strip");
  const tasks=(att&&att.tasks)||[],warns=(att&&att.warnings)||[];
  if(!tasks.length&&!warns.length){el.innerHTML="";return;}
  el.innerHTML=
    warns.map(w=>'<div class="att warn"><div class="att-top"><span>⚠ '+esc(w)+'</span></div></div>').join("")+
    tasks.map(t=>'<div class="att '+esc(t.status)+'"><div class="att-top"><span><code>'+esc(t.id)+'</code> '+esc(t.title)+'</span><span class="s-'+esc(t.status)+'">'+esc(t.status)+'</span></div>'+
      (t.lastSummary?'<div class="why">'+esc(t.lastSummary).slice(0,130)+'</div>':'')+
      (t.attempts?'<div class="why">↻ '+t.attempts+' attempt(s)</div>':'')+'</div>').join("");
}

function renderAgents(list){
  const el=document.getElementById("agents");
  document.getElementById("agents-count").textContent=list?(list.filter(a=>a.state!=="idle").length+" active"):"";
  if(!list||!list.length){el.innerHTML='<div class="empty">No agents configured.</div>';return;}
  el.innerHTML=list.map(a=>{
    const task=a.currentTaskId?'<div class="task"><code>'+esc(a.currentTaskId)+'</code> '+esc(a.currentTaskTitle||'')+'</div>':'<div class="muted">idle — no active task</div>';
    const summary=a.lastSummary?'<div class="muted">'+esc(a.lastSummary).slice(0,100)+'</div>':'';
    let idleCls="";if(a.state==="working"&&a.lastActivity){const s=(Date.now()-new Date(a.lastActivity).getTime())/1000;idleCls=s>300?" idle-red":s>120?" idle-amber":"";}
    const sess=a.role;
    return '<div class="agent '+a.state+'">'+
      '<div class="top"><span class="name">'+esc(a.role)+'</span><span class="statepill '+a.state+'">'+a.state.replace("-"," ")+'</span></div>'+
      '<div class="role-meta">'+esc(a.sme||a.title)+' · '+esc(a.provider)+'</div>'+
      task+summary+
      '<div class="stat-row"><span>✅ '+a.done+'</span>'+(a.attempts?'<span>↻ '+a.attempts+'</span>':'')+(a.spendUsd?'<span>$'+a.spendUsd.toFixed(2)+'</span>':'')+(a.lastActivity?'<span class="'+idleCls.trim()+'">'+ago(a.lastActivity)+' ago</span>':'')+'</div>'+
      '<details data-sess="'+esc(sess)+'"><summary>terminal output</summary><pre>click to load…</pre></details>'+
    '</div>';
  }).join("");
  el.querySelectorAll("details").forEach(d=>d.addEventListener("toggle",async()=>{
    if(!d.open)return;const pre=d.querySelector("pre");
    const r=await getJSON("/api/logs?session="+encodeURIComponent(d.dataset.sess));
    pre.textContent=(r&&r.logs)||"no tmux session / output for this agent yet.";
  }));
}

function renderKanban(board){
  const el=document.getElementById("kanban");
  const views=(board&&board.views)||[];
  document.getElementById("board-count").textContent=board?(views.length+" tasks"):"";
  if(!views.length){el.innerHTML='<div class="empty">No tasks yet — the orchestrator is decomposing the goal…</div>';return;}
  const crit=new Set((board&&board.criticalPath)||[]);
  const doneIds=new Set(views.filter(v=>v.status==="done").map(v=>v.id));
  const byStatus={};LANES.forEach(s=>byStatus[s]=[]);
  views.forEach(v=>(byStatus[v.status]=byStatus[v.status]||[]).push(v));
  el.innerHTML=LANES.filter(s=>byStatus[s]&&byStatus[s].length).map(s=>{
    const tickets=byStatus[s].sort((a,b)=>b.priority-a.priority).map(v=>{
      const deps=(v.dependsOn||[]).map(d=>'<span class="chip '+(doneIds.has(d)?'ok':'block')+'">'+esc(d)+'</span>').join("");
      const ready=(s==="open"&&(v.dependsOn||[]).every(d=>doneIds.has(d))&&(v.dependsOn||[]).length>0)?'<span class="badge-ready">ready ▶</span>':'';
      return '<div class="ticket bt-'+s+(crit.has(v.id)?' crit':'')+'">'+
        '<div class="tid"><span>'+esc(v.id)+'</span>'+(crit.has(v.id)?'<span class="badge-crit">★ critical</span>':'')+'</div>'+
        '<div class="ttitle">'+esc(v.title)+'</div>'+
        '<div class="tmeta"><span>'+esc(v.assignee)+'</span><span class="s-'+s+'">'+LANE_LABEL[s]+'</span></div>'+
        (deps?'<div>'+deps+' '+ready+'</div>':(ready?'<div>'+ready+'</div>':''))+
      '</div>';
    }).join("");
    return '<div class="lane"><h3><span>'+LANE_LABEL[s]+'</span><span>'+byStatus[s].length+'</span></h3>'+tickets+'</div>';
  }).join("");
}

function renderTimeline(list){
  const el=document.getElementById("timeline");
  if(!list||!list.length){el.innerHTML='<div class="empty">No activity yet.</div>';return;}
  el.innerHTML=list.map(e=>
    '<div class="tl '+(e.kind==="message"?"msg":"")+'">'+
      '<span class="when">'+clock(e.ts)+'</span>'+
      '<span class="who '+(e.status?"s-"+e.status:"")+'">'+(e.kind==="message"?"✉ ":"")+esc(e.role)+(e.to?'→'+esc(e.to):'')+'</span>'+
      '<span class="what">'+esc(e.text).slice(0,150)+'</span>'+
    '</div>'
  ).join("");
}

async function tick(){
  const [o,agents,board,timeline,att]=await Promise.all([
    getJSON("/api/overview"),getJSON("/api/agents"),getJSON("/api/board"),getJSON("/api/timeline"),getJSON("/api/attention")
  ]);
  renderKpis(o);renderAttention(att);renderAgents(agents);renderKanban(board);renderTimeline(timeline);
}
tick();setInterval(tick,2500);
`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
