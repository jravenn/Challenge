import { useState, useEffect, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════
   HABIT DATA MODEL
═══════════════════════════════════════════════ */
const ANCHOR_HABITS = [
  { id: "exercise", label: "Exercise",           icon: "🏋️", hints: ["No movement","Light/short session","Full session"] },
  { id: "protein",  label: "130g Protein",       icon: "🥩", hints: ["Under 80g","80–129g","130g+"] },
  { id: "steps",    label: "10k Steps",          icon: "👣", hints: ["Under 5k","5k–9.9k","10k+"] },
  { id: "nojunk",   label: "No Processed Food",  icon: "🥗", hints: ["Multiple slips","One small slip","Clean day"] },
  { id: "bed",      label: "In Bed by 22:45",    icon: "🌙", hints: ["After 23:30","23:00–23:29","By 22:45"] },
  { id: "bible",    label: "Read Bible",         icon: "📖", hints: ["Skipped","Brief / distracted","Full reading"] },
];
const SUPPORT_HABITS = [
  { id: "creatine", label: "Creatine",     icon: "⚗️",  hints: ["Skipped","Late/half dose","Taken"] },
  { id: "omega3",   label: "Omega-3",      icon: "🐟",  hints: ["Skipped","Late/half dose","Taken"] },
  { id: "multi",    label: "Multivitamin", icon: "💊",  hints: ["Skipped","Late/half dose","Taken"] },
  { id: "collagen", label: "Collagen",     icon: "🔬",  hints: ["Skipped","Late/half dose","Taken"] },
  { id: "water",    label: "2L Water",     icon: "💧",  hints: ["Under 1L","1–1.9L","2L+"] },
];
const ALL_HABITS  = [...ANCHOR_HABITS, ...SUPPORT_HABITS];
const ANCHOR_IDS  = new Set(ANCHOR_HABITS.map(h => h.id));
const ANCHOR_W    = 1.5;
const SUPPORT_W   = 1.0;
const MAX_ANCHOR  = ANCHOR_HABITS.length * ANCHOR_W;
const MAX_DAY     = MAX_ANCHOR + SUPPORT_HABITS.length * SUPPORT_W;
const WEEKS = 8;
const DAYS  = 56;

/* ═══════════════════════════════════════════════
   FASTING DATA
═══════════════════════════════════════════════ */
const FAST_OPTS = [
  { hours: 12, label: "12h", color: "#6b9e8a" },
  { hours: 16, label: "16h", color: "#5b8fa8" },
  { hours: 24, label: "24h", color: "#7b6fa8" },
  { hours: 36, label: "36h", color: "#a87b6f" },
];
const ZONES = [
  { from: 0,  to: 12, label: "Baseline",    sub: "Digestion & glycogen",       color: "#6b9e8a" },
  { from: 12, to: 16, label: "Fat Burning", sub: "Ketones rising",             color: "#5b8fa8" },
  { from: 16, to: 24, label: "Deep Burn",   sub: "Insulin drops, oxidation",   color: "#7b6fa8" },
  { from: 24, to: 36, label: "Autophagy",   sub: "Cellular repair",            color: "#a87b6f" },
];

/* ═══════════════════════════════════════════════
   STORAGE HELPERS
═══════════════════════════════════════════════ */
const ls = {
  get: (k, fb) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : fb; } catch { return fb; } },
  set: (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid      = () => Math.random().toString(36).slice(2, 10);
const blankDay = () => ({
  habits: Object.fromEntries(ALL_HABITS.map(h => [h.id, null])),
  submitted: false, unlocked: false, morning: "", night: "", fast: null,
});

/* ═══════════════════════════════════════════════
   TASK ENGINE
═══════════════════════════════════════════════ */
function initTasks() {
  const today    = todayISO();
  let tasks      = ls.get("alv4_tasks", []);
  const archived = ls.get("alv4_archive", {});
  const toArchive = [];

  const updated = tasks.map(t => {
    const created = t.createdDate;
    // completed in a past day → archive
    if (t.completed && t.completedAt && t.completedAt.slice(0, 10) < today) {
      toArchive.push(t);
      return null;
    }
    // incomplete from a past day → carry over
    if (!t.completed && created < today && !t.carryOver) {
      return { ...t, carryOver: true };
    }
    return t;
  }).filter(Boolean);

  if (toArchive.length) {
    toArchive.forEach(t => {
      const d = t.completedAt.slice(0, 10);
      if (!archived[d]) archived[d] = [];
      if (!archived[d].find(x => x.id === t.id)) archived[d].push(t);
    });
    ls.set("alv4_archive", archived);
  }
  ls.set("alv4_tasks", updated);
  return updated;
}

const PRI_ORDER = { high: 0, medium: 1, low: 2 };

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.carryOver !== b.carryOver) return a.carryOver ? -1 : 1;
    if (PRI_ORDER[a.priority] !== PRI_ORDER[b.priority]) return PRI_ORDER[a.priority] - PRI_ORDER[b.priority];
    return a.createdDate.localeCompare(b.createdDate);
  });
}

function getTaskStats(tasks, archived) {
  const today     = todayISO();
  const active    = tasks.filter(t => !t.completed);
  const doneToday = tasks.filter(t => t.completed && t.completedAt?.slice(0, 10) === today);
  const carryOvers = tasks.filter(t => t.carryOver && !t.completed);

  // 7-day completion rate
  let added7 = 0, done7 = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const arch = (archived[key] ?? []);
    done7  += arch.length;
    added7 += arch.length;
  }
  done7  += doneToday.length;
  added7 += doneToday.length + active.filter(t => t.createdDate === today).length;
  const weekRate = added7 > 0 ? Math.round((done7 / added7) * 100) : null;

  // most frequently carried-over
  const carryMap = {};
  [...tasks, ...Object.values(archived).flat()].filter(t => t.carryOver).forEach(t => {
    carryMap[t.title] = (carryMap[t.title] || 0) + 1;
  });
  const topCarry = Object.entries(carryMap).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return { active, doneToday, carryOvers, weekRate, topCarry };
}

/* ═══════════════════════════════════════════════
   HABIT ANALYTICS
═══════════════════════════════════════════════ */
function analyze(history, startDate) {
  const submitted = Object.keys(history).filter(d => history[d].submitted).sort();
  const streaks   = Object.fromEntries(ALL_HABITS.map(h => [h.id, 0]));
  let perfectAnchorStreak = 0, bestPerfect = 0;

  for (const d of submitted) {
    const hab = history[d].habits;
    let allGreen = true;
    ALL_HABITS.forEach(h => {
      const v = hab[h.id] ?? 0;
      if (v === 1) streaks[h.id]++;
      else if (v === 0) { streaks[h.id] = 0; if (ANCHOR_IDS.has(h.id)) allGreen = false; }
    });
    if (allGreen) perfectAnchorStreak++; else perfectAnchorStreak = 0;
    bestPerfect = Math.max(bestPerfect, perfectAnchorStreak);
  }

  const dayScores = submitted.map(d => {
    let pts = 0;
    ALL_HABITS.forEach(h => { pts += (history[d].habits[h.id] ?? 0) * (ANCHOR_IDS.has(h.id) ? ANCHOR_W : SUPPORT_W); });
    return { date: d, pts, pct: Math.round((pts / MAX_DAY) * 100) };
  });
  const totalDays  = submitted.length;
  const overallPct = totalDays ? Math.round(dayScores.reduce((s, d) => s + d.pct, 0) / totalDays) : 0;
  const last7      = dayScores.slice(-7);
  const weekAvg    = last7.length ? (last7.reduce((s, d) => s + d.pts, 0) / last7.length).toFixed(1) : null;
  const successDays = submitted.filter(d => {
    let ap = 0; ANCHOR_HABITS.forEach(h => { ap += (history[d].habits[h.id] ?? 0) * ANCHOR_W; });
    return (ap / MAX_ANCHOR) >= 0.7;
  }).length;
  const breakdown = {};
  ALL_HABITS.forEach(h => {
    let g = 0, o = 0, r = 0;
    submitted.forEach(d => { const v = history[d].habits[h.id] ?? 0; if (v===1) g++; else if (v===0.5) o++; else r++; });
    breakdown[h.id] = { g, o, r };
  });
  const weeklyPcts = Array.from({ length: WEEKS }, (_, wi) => {
    const wDays = submitted.filter(d => {
      const idx = Math.round((new Date(d) - new Date(startDate)) / 86400000);
      return idx >= wi * 7 && idx < (wi + 1) * 7;
    });
    if (!wDays.length) return null;
    return Math.round(wDays.reduce((s, d) => s + (dayScores.find(x => x.date === d)?.pct ?? 0), 0) / wDays.length);
  });
  const fastsCompleted = submitted.filter(d => history[d].fast?.completed).length;
  return { streaks, perfectAnchorStreak, bestPerfect, totalDays, successDays, overallPct, weekAvg, dayScores, weeklyPcts, breakdown, fastsCompleted };
}

/* ═══════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════ */
const C = {
  bg: "#0e0f0f", s1: "#141515", s2: "#1a1b1b", bdr: "#222323",
  text: "#d8d4cf", mute: "#4a4a4a",
  grn: "#50b978", org: "#d28c3c", red: "#dc503c",
  mono: "'IBM Plex Mono', monospace", sans: "'Sora', sans-serif",
};
const card = { background: C.s1, border: `1px solid ${C.bdr}`, borderRadius: 13, padding: "16px 16px", marginBottom: 13 };

/* ═══════════════════════════════════════════════
   PRIORITY META
═══════════════════════════════════════════════ */
const PRI = {
  high:   { label: "HIGH", color: "#dc503c", bg: "rgba(220,80,60,.10)",  border: "rgba(220,80,60,.3)" },
  medium: { label: "MED",  color: "#d28c3c", bg: "rgba(210,140,60,.08)", border: "rgba(210,140,60,.25)" },
  low:    { label: "LOW",  color: "#4a6a8a", bg: "rgba(74,106,138,.08)", border: "rgba(74,106,138,.22)" },
};

/* ═══════════════════════════════════════════════
   HABIT ROW COMPONENT
═══════════════════════════════════════════════ */
const STATE_STYLE = {
  null: { bg:"rgba(255,255,255,.03)", border:"rgba(255,255,255,.07)", dot:"#2a2a2a", text:"#3a3a3a", glyph:"" },
  "0":  { bg:"rgba(220,80,60,.07)",   border:"rgba(220,80,60,.25)",   dot:"#dc503c", text:"#dc503c", glyph:"✕" },
  "0.5":{ bg:"rgba(210,140,60,.07)",  border:"rgba(210,140,60,.25)",  dot:"#d28c3c", text:"#d28c3c", glyph:"◐" },
  "1":  { bg:"rgba(80,185,120,.07)",  border:"rgba(80,185,120,.25)",  dot:"#50b978", text:"#50b978", glyph:"✓" },
};
function HabitRow({ habit, value, locked, isAnchor, onChange }) {
  const sk = value === null ? "null" : String(value);
  const s  = STATE_STYLE[sk];
  const hintIdx = value === null ? -1 : value === 0 ? 0 : value === 0.5 ? 1 : 2;
  const cycle = () => {
    if (locked) return;
    const order = [null, 0, 0.5, 1];
    onChange(habit.id, order[(order.findIndex(x => x === value) + 1) % order.length]);
  };
  return (
    <button onClick={cycle} style={{
      width:"100%", display:"flex", alignItems:"center", gap:11,
      padding: isAnchor ? "14px 14px" : "11px 14px",
      background:s.bg, border:`1px solid ${s.border}`,
      borderLeft: isAnchor
        ? `3px solid ${value===1?"#50b978":value===0.5?"#d28c3c":value===0?"#dc503c":"#2a2a2a"}`
        : `1px solid ${s.border}`,
      borderRadius:10, cursor:locked?"default":"pointer",
      transition:"all .16s ease", marginBottom:7, textAlign:"left",
    }}>
      <span style={{ fontSize:isAnchor?20:17, minWidth:24, textAlign:"center" }}>{habit.icon}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:isAnchor?14:13, fontWeight:isAnchor?600:400,
          color:value!==null?s.text:"#888", fontFamily:C.sans, lineHeight:1.2, transition:"color .16s" }}>
          {habit.label}
          {isAnchor && <span style={{ fontSize:9, color:"#4a4a4a", fontFamily:C.mono, marginLeft:6, verticalAlign:"middle" }}>ANCHOR</span>}
        </div>
        {hintIdx >= 0 && <div style={{ fontSize:11, color:s.text, opacity:.75, marginTop:2, fontFamily:C.mono }}>{habit.hints[hintIdx]}</div>}
      </div>
      <div style={{ display:"flex", gap:4, flexShrink:0 }}>
        {[0, 0.5, 1].map(sv => {
          const active = value === sv, sc = STATE_STYLE[String(sv)];
          return <div key={sv} style={{ width:8, height:8, borderRadius:"50%",
            background:active?sc.dot:"#222", border:`1.5px solid ${active?sc.dot:"#2a2a2a"}`,
            boxShadow:active?`0 0 5px ${sc.dot}99`:"none", transition:"all .15s" }} />;
        })}
      </div>
      <div style={{ width:22, height:22, borderRadius:6, flexShrink:0, border:`1.5px solid ${s.border}`,
        background:value!==null?s.bg:"transparent", display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:12, color:s.text, fontWeight:700, transition:"all .16s" }}>{s.glyph}</div>
    </button>
  );
}

/* ═══════════════════════════════════════════════
   TASK ROW COMPONENT
═══════════════════════════════════════════════ */
function TaskRow({ task, onComplete, onDelete, onEdit, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [open, setOpen] = useState(false);
  const pm = PRI[task.priority];
  return (
    <div style={{
      background: task.completed ? "rgba(80,185,120,.04)" : task.carryOver ? "rgba(210,140,60,.04)" : C.s1,
      border: `1px solid ${task.completed ? "rgba(80,185,120,.18)" : task.carryOver ? "rgba(210,140,60,.2)" : C.bdr}`,
      borderLeft: `3px solid ${task.completed ? "#50b978" : pm.color}`,
      borderRadius: 10, marginBottom: 8, overflow: "hidden",
      opacity: task.completed ? .6 : 1, transition: "all .2s ease",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 12px" }}>
        {/* check button */}
        <button onClick={() => onComplete(task.id)} style={{
          width:22, height:22, borderRadius:6, flexShrink:0,
          border:`1.5px solid ${task.completed ? "#50b978" : pm.border}`,
          background: task.completed ? "rgba(80,185,120,.2)" : "transparent",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", fontSize:12, color:"#50b978", transition:"all .15s",
        }}>{task.completed ? "✓" : ""}</button>

        {/* title + meta */}
        <div style={{ flex:1, minWidth:0, cursor:task.completed?"default":"pointer" }}
          onClick={() => !task.completed && setOpen(o => !o)}>
          <div style={{ fontSize:14, fontFamily:C.sans, fontWeight:500,
            color: task.completed ? "#4a4a4a" : C.text,
            textDecoration: task.completed ? "line-through" : "none",
            lineHeight:1.3, wordBreak:"break-word", transition:"color .2s" }}>
            {task.title}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5, flexWrap:"wrap" }}>
            <span style={{ fontFamily:C.mono, fontSize:9, fontWeight:500, letterSpacing:".08em",
              color:pm.color, background:pm.bg, border:`1px solid ${pm.border}`,
              borderRadius:4, padding:"2px 6px" }}>{pm.label}</span>
            {task.carryOver && !task.completed && (
              <span style={{ fontFamily:C.mono, fontSize:9, color:"#d28c3c",
                background:"rgba(210,140,60,.1)", border:"1px solid rgba(210,140,60,.25)",
                borderRadius:4, padding:"2px 6px" }}>↩ CARRY-OVER</span>
            )}
            <span style={{ fontSize:9, color:"#333", fontFamily:C.mono }}>{task.createdDate}</span>
          </div>
        </div>

        {/* expand trigger */}
        {!task.completed && (
          <button onClick={() => setOpen(o => !o)} style={{
            background:"none", border:"none", color:C.mute,
            cursor:"pointer", fontSize:16, padding:"0 4px", lineHeight:1,
          }}>{open ? "×" : "⋯"}</button>
        )}
      </div>

      {/* inline actions */}
      {open && !task.completed && (
        <div style={{ display:"flex", borderTop:`1px solid ${C.bdr}` }}>
          {[
            { label:"↑", fn:() => onMoveUp(task.id),                    disabled:isFirst },
            { label:"↓", fn:() => onMoveDown(task.id),                  disabled:isLast },
            { label:"Edit", fn:() => { onEdit(task); setOpen(false); } },
            { label:"Delete", fn:() => onDelete(task.id), danger:true },
          ].map((btn, i) => (
            <button key={i} onClick={btn.fn} disabled={btn.disabled} style={{
              flex:1, padding:"10px 0", background:"none",
              border:"none", borderRight:i<3?`1px solid ${C.bdr}`:"none",
              color:btn.danger?"#dc503c":btn.disabled?"#252525":C.mute,
              fontFamily:C.mono, fontSize:11, letterSpacing:".04em",
              cursor:btn.disabled?"default":"pointer", transition:"color .15s",
            }}>{btn.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   TASK MODAL
═══════════════════════════════════════════════ */
function TaskModal({ initial, onSave, onClose }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [pri, setPri]     = useState(initial?.priority ?? "medium");
  const inputRef          = useRef(null);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);
  const save = () => {
    const t = title.trim();
    if (!t) return;
    onSave({ title: t, priority: pri });
    onClose();
  };
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position:"fixed", inset:0, zIndex:100,
        display:"flex", alignItems:"flex-end", justifyContent:"center",
        background:"rgba(0,0,0,.72)", backdropFilter:"blur(6px)" }}>
      <div style={{ width:"100%", maxWidth:430, background:C.s1,
        borderTop:`1px solid ${C.bdr}`, borderRadius:"16px 16px 0 0",
        padding:20, paddingBottom:"calc(20px + env(safe-area-inset-bottom))" }}>
        <div style={{ fontFamily:C.mono, fontSize:11, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>
          {initial ? "EDIT TASK" : "NEW TASK"}
        </div>
        <textarea ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); save(); } }}
          rows={3} placeholder="What needs to get done?"
          style={{ width:"100%", background:C.bg, border:`1px solid ${C.bdr}`,
            borderRadius:10, padding:"12px 13px", color:C.text,
            fontSize:15, lineHeight:1.5, fontFamily:C.sans,
            marginBottom:14, resize:"none", outline:"none" }} />
        <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:10 }}>PRIORITY</div>
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          {["high","medium","low"].map(p => {
            const m = PRI[p], active = pri===p;
            return (
              <button key={p} onClick={() => setPri(p)} style={{
                flex:1, padding:"10px 0", borderRadius:9,
                border:`1.5px solid ${active?m.color:C.bdr}`,
                background:active?m.bg:"transparent",
                color:active?m.color:C.mute,
                fontFamily:C.mono, fontSize:11, cursor:"pointer",
                transition:"all .15s", letterSpacing:".06em",
              }}>{m.label}</button>
            );
          })}
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:14, borderRadius:10,
            background:C.s2, border:`1px solid ${C.bdr}`, color:C.mute,
            fontFamily:C.mono, fontSize:12, cursor:"pointer" }}>Cancel</button>
          <button onClick={save} disabled={!title.trim()} style={{ flex:2, padding:14,
            borderRadius:10, border:"none",
            background:title.trim()?"linear-gradient(135deg,#50b978,#3a9960)":"#1c1c1c",
            color:title.trim()?"#000":C.mute, fontFamily:C.mono, fontSize:13,
            fontWeight:600, cursor:title.trim()?"pointer":"default",
            letterSpacing:".08em", transition:"all .2s" }}>
            {initial ? "SAVE" : "ADD TASK"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   FASTING ZONE BAR
═══════════════════════════════════════════════ */
function ZoneBar({ elapsed }) {
  return (
    <div>
      <div style={{ position:"relative", height:10, borderRadius:5, background:"#1a1a1a", overflow:"hidden", marginBottom:8 }}>
        {ZONES.map((z,i) => <div key={i} style={{
          position:"absolute", left:`${(z.from/36)*100}%`, width:`${((z.to-z.from)/36)*100}%`,
          height:"100%", background:z.color, opacity:elapsed>=z.from?.85:.12, transition:"opacity .4s" }} />)}
        {elapsed>0 && <div style={{ position:"absolute", left:`${Math.min((elapsed/36)*100,100)}%`,
          top:-3, width:2, height:16, background:"#fff", borderRadius:1, transform:"translateX(-50%)",
          boxShadow:"0 0 8px rgba(255,255,255,.7)" }} />}
      </div>
      <div style={{ display:"flex" }}>
        {ZONES.map((z,i) => <div key={i} style={{ flex:z.to-z.from, textAlign:"center",
          fontSize:9, fontFamily:C.mono, color:elapsed>=z.from?z.color:"#333", transition:"color .3s", lineHeight:1.3 }}>
          <div>{z.label}</div><div style={{ color:"#333", fontSize:8 }}>{z.from}–{z.to}h</div>
        </div>)}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   CHART & GRID COMPONENTS
═══════════════════════════════════════════════ */
function BarChart({ weeklyPcts }) {
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:5, height:90, padding:"0 4px" }}>
      {weeklyPcts.map((pct,i) => {
        const has=pct!==null, fill=!has?"#1a1a1a":pct>=80?"#50b978":pct>=55?"#d28c3c":"#dc503c";
        return (
          <div key={i} style={{ flex:1, height:"100%", display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
            <div style={{ flex:1, display:"flex", alignItems:"flex-end", width:"100%" }}>
              <div style={{ width:"100%", height:has?`${Math.max(pct,4)}%`:"5%",
                background:fill, borderRadius:"4px 4px 2px 2px",
                border:!has?"1px dashed #222":"none", transition:"height .5s ease" }} />
            </div>
            <div style={{ fontSize:9, color:"#3a3a3a", fontFamily:C.mono }}>W{i+1}</div>
          </div>
        );
      })}
    </div>
  );
}

function CalGrid({ history, startDate }) {
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:3 }}>
        {["M","T","W","T","F","S","S"].map((d,i) =>
          <div key={i} style={{ textAlign:"center", fontSize:9, color:"#333", fontFamily:C.mono }}>{d}</div>)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
        {Array.from({ length:DAYS },(_,i) => {
          const date = new Date(new Date(startDate).getTime()+i*86400000).toISOString().slice(0,10);
          const day  = history[date];
          if (!day?.submitted) return <div key={i} style={{ aspectRatio:"1", borderRadius:3, background:"#141414", border:"1px dashed #1e1e1e" }} />;
          let pts=0; ALL_HABITS.forEach(h=>{pts+=(day.habits[h.id]??0)*(ANCHOR_IDS.has(h.id)?ANCHOR_W:SUPPORT_W);});
          const pct=Math.round((pts/MAX_DAY)*100);
          const col=pct>=85?"#50b978":pct>=65?"#7dcf9b":pct>=45?"#d28c3c":"#dc503c";
          return <div key={i} style={{ aspectRatio:"1", borderRadius:3, background:col, opacity:.85 }} />;
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════ */
const NAV = [
  { id:"today", icon:"◉", label:"Today" },
  { id:"tasks", icon:"☰", label:"Tasks" },
  { id:"fast",  icon:"⧖", label:"Fast" },
  { id:"dash",  icon:"▦", label:"Stats" },
  { id:"log",   icon:"≡", label:"Log" },
];

export default function App() {
  const [tab, setTab]   = useState("today");
  const [history, setH] = useState(() => ls.get("alv4_hist", {}));
  const startDate       = useRef((() => {
    let d = ls.get("alv4_start", null);
    if (!d) { d = todayISO(); ls.set("alv4_start", d); }
    return d;
  })()).current;

  const [tasks, setTasks]     = useState(() => initTasks());
  const [taskModal, setModal] = useState(null);
  const taskArchive           = useRef(ls.get("alv4_archive", {}));
  const [, setTick]           = useState(0);
  useEffect(() => { const id=setInterval(()=>setTick(t=>t+1),1000); return()=>clearInterval(id); }, []);

  const today  = todayISO();
  const dayRaw = history[today] || blankDay();

  /* ── Day patch ── */
  const patchDay = useCallback((updates) => {
    setH(prev => {
      const next = { ...prev, [today]:{ ...(prev[today]||blankDay()), ...updates } };
      ls.set("alv4_hist", next); return next;
    });
  }, [today]);

  const setHabit = (id, val) => {
    if (dayRaw.submitted && !dayRaw.unlocked) return;
    patchDay({ habits:{ ...dayRaw.habits, [id]:val } });
  };

  /* ── Task operations ── */
  const saveTasks = (next) => { ls.set("alv4_tasks", next); setTasks(next); };
  const addTask   = ({ title, priority }) => {
    const t = { id:uid(), title, completed:false, priority, createdDate:today, carryOver:false, completedAt:null };
    saveTasks(sortTasks([...tasks, t]));
  };
  const editTask   = (id, { title, priority }) => saveTasks(sortTasks(tasks.map(t => t.id===id ? {...t,title,priority} : t)));
  const deleteTask = (id) => saveTasks(tasks.filter(t => t.id!==id));
  const completeTask = (id) => {
    saveTasks(sortTasks(tasks.map(t => {
      if (t.id!==id) return t;
      const completing = !t.completed;
      return { ...t, completed:completing, completedAt:completing?new Date().toISOString():null };
    })));
  };
  const moveTask = (id, dir) => {
    const inc = tasks.filter(t => !t.completed);
    const com = tasks.filter(t => t.completed);
    const idx = inc.findIndex(t => t.id===id);
    if (idx<0) return;
    const ni  = idx+dir;
    if (ni<0||ni>=inc.length) return;
    const re  = [...inc]; [re[idx],re[ni]]=[re[ni],re[idx]];
    saveTasks([...re,...com]);
  };

  /* ── Scoring ── */
  const rawScore = ALL_HABITS.reduce((s,h) => s+(dayRaw.habits[h.id]??0)*(ANCHOR_IDS.has(h.id)?ANCHOR_W:SUPPORT_W), 0);
  const dayPct   = Math.round((rawScore/MAX_DAY)*100);
  const allSet   = ALL_HABITS.every(h => dayRaw.habits[h.id]!==null);
  const stats    = analyze(history, startDate);
  const tStats   = getTaskStats(tasks, taskArchive.current);

  /* ── Fasting ── */
  const fast     = dayRaw.fast;
  const elapsed  = fast?.startTs ? Math.max(0,(Date.now()-fast.startTs)/3600000) : 0;
  const remain   = fast ? Math.max(0,fast.hours-elapsed) : 0;
  const fastDone = fast && elapsed>=fast.hours && !fast.completed;
  const curZone  = [...ZONES].reverse().find(z => elapsed>=z.from) ?? ZONES[0];
  const fmt      = h => { const hh=Math.floor(h),mm=Math.floor((h-hh)*60),ss=Math.floor(((h-hh)*60-mm)*60); return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`; };

  /* ── Context ── */
  const dayIdx  = Math.max(0,Math.round((new Date(today)-new Date(startDate))/86400000));
  const weekNum = Math.min(WEEKS,Math.floor(dayIdx/7)+1);
  const dayColor = dayPct>=80?C.grn:dayPct>=50?C.org:dayPct>0?C.red:C.mute;

  const displayTasks   = sortTasks(tasks.filter(t => !t.completed));
  const completedToday = tasks.filter(t => t.completed && t.completedAt?.slice(0,10)===today);

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", paddingBottom:88, fontFamily:C.sans }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}body{background:#0e0f0f;}
        button{font-family:inherit;}textarea{resize:none;outline:none;font-family:inherit;}
        textarea::placeholder{color:#252525;}::-webkit-scrollbar{width:0;}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ padding:"20px 18px 13px", borderBottom:`1px solid ${C.bdr}`,
        position:"sticky", top:0, zIndex:10, background:C.bg }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".12em", marginBottom:5 }}>
              WK {weekNum} / {WEEKS} · DAY {dayIdx+1} / {DAYS}
            </div>
            <div style={{ fontSize:22, fontWeight:700, letterSpacing:"-.03em", color:"#ccc", lineHeight:1.1 }}>
              Anchor<br /><span style={{ color:"#fff" }}>& Habit</span> Log
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:C.mono, fontSize:9, color:C.mute, marginBottom:3 }}>TODAY</div>
            <div style={{ fontSize:44, fontWeight:700, lineHeight:1, color:dayColor, transition:"color .3s", textShadow:`0 0 30px ${dayColor}44` }}>
              {dayPct}<span style={{ fontSize:20, color:C.mute }}>%</span>
            </div>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute }}>{rawScore.toFixed(1)} / {MAX_DAY.toFixed(0)} pts</div>
          </div>
        </div>
        <div style={{ height:3, background:C.s2, borderRadius:2, marginTop:12 }}>
          <div style={{ height:"100%", borderRadius:2, width:`${dayPct}%`, background:dayColor,
            transition:"width .4s ease, background .3s", boxShadow:`0 0 8px ${dayColor}88` }} />
        </div>
      </div>

      {/* ── NAV ── */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.bdr}`, padding:"0 4px" }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => setTab(n.id)} style={{
            flex:1, padding:"11px 0", background:"none", border:"none",
            borderBottom:`2px solid ${tab===n.id?C.grn:"transparent"}`,
            color:tab===n.id?C.grn:C.mute,
            fontFamily:C.mono, fontSize:10, letterSpacing:".07em",
            cursor:"pointer", transition:"all .15s",
          }}>
            <span style={{ position:"relative", display:"inline-block" }}>
              {n.label}
              {n.id==="tasks" && tStats.carryOvers.length>0 && (
                <span style={{ position:"absolute", top:-4, right:-8, width:6, height:6,
                  borderRadius:"50%", background:C.org, display:"block" }} />
              )}
            </span>
          </button>
        ))}
      </div>

      <div style={{ padding:"14px 16px" }}>

        {/* ══════════ TODAY TAB ══════════ */}
        {tab==="today" && <>
          <div style={{ ...card, padding:"10px 14px", marginBottom:12 }}>
            <div style={{ display:"flex", gap:0 }}>
              {[{col:C.grn,txt:"Green = full · 1pt"},{col:C.org,txt:"Orange = partial · ½pt"},{col:C.red,txt:"Red = none · 0pt"}].map((s,i) => (
                <div key={i} style={{ flex:1, display:"flex", alignItems:"center", gap:6,
                  borderRight:i<2?`1px solid ${C.bdr}`:"none",
                  padding:i===0?"0 8px 0 0":i===1?"0 8px":"0 0 0 8px" }}>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:s.col, flexShrink:0, boxShadow:`0 0 4px ${s.col}` }} />
                  <div style={{ fontSize:9, color:C.mute, fontFamily:C.mono, lineHeight:1.3 }}>{s.txt}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card }}>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:10 }}>☀ MORNING — What would make today a win?</div>
            <textarea value={dayRaw.morning} onChange={e=>patchDay({morning:e.target.value})}
              disabled={dayRaw.submitted&&!dayRaw.unlocked} rows={2}
              style={{ width:"100%", background:C.bg, border:`1px solid ${C.bdr}`, borderRadius:8,
                padding:"9px 12px", color:C.text, fontSize:13.5, lineHeight:1.6 }}
              placeholder="Set your intention for today…" />
          </div>

          <div style={{ marginBottom:6 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <div style={{ flex:1, height:1, background:C.bdr }} />
              <div style={{ fontFamily:C.mono, fontSize:10, color:"#6a6a6a", letterSpacing:".12em" }}>ANCHOR HABITS · 1.5× weight</div>
              <div style={{ flex:1, height:1, background:C.bdr }} />
            </div>
            {ANCHOR_HABITS.map(h => (
              <div key={h.id}>
                <HabitRow habit={h} value={dayRaw.habits[h.id]} locked={dayRaw.submitted&&!dayRaw.unlocked} isAnchor={true} onChange={setHabit} />
                {stats.streaks[h.id]>0 && <div style={{ fontFamily:C.mono, fontSize:10, color:C.grn, marginTop:-4, marginBottom:5, paddingLeft:48 }}>{stats.streaks[h.id]}d streak</div>}
              </div>
            ))}
          </div>

          <div style={{ marginBottom:6 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <div style={{ flex:1, height:1, background:C.bdr }} />
              <div style={{ fontFamily:C.mono, fontSize:10, color:"#6a6a6a", letterSpacing:".12em" }}>SUPPORT HABITS · 1× weight</div>
              <div style={{ flex:1, height:1, background:C.bdr }} />
            </div>
            {SUPPORT_HABITS.map(h => (
              <div key={h.id}>
                <HabitRow habit={h} value={dayRaw.habits[h.id]} locked={dayRaw.submitted&&!dayRaw.unlocked} isAnchor={false} onChange={setHabit} />
                {stats.streaks[h.id]>0 && <div style={{ fontFamily:C.mono, fontSize:10, color:C.grn, marginTop:-4, marginBottom:5, paddingLeft:44 }}>{stats.streaks[h.id]}d streak</div>}
              </div>
            ))}
          </div>

          <div style={{ ...card }}>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:10 }}>🌙 NIGHT — Did you stay aligned? Why or why not?</div>
            <textarea value={dayRaw.night} onChange={e=>patchDay({night:e.target.value})}
              disabled={dayRaw.submitted&&!dayRaw.unlocked} rows={3}
              style={{ width:"100%", background:C.bg, border:`1px solid ${C.bdr}`, borderRadius:8,
                padding:"9px 12px", color:C.text, fontSize:13.5, lineHeight:1.6 }}
              placeholder="Honest reflection only…" />
          </div>

          {(() => {
            const ap=Math.round((ANCHOR_HABITS.reduce((s,h)=>s+(dayRaw.habits[h.id]??0)*ANCHOR_W,0)/MAX_ANCHOR)*100);
            const ok=ap>=70;
            return (
              <div style={{ ...card, border:`1px solid ${ok?C.grn+"33":C.bdr}`, marginBottom:12, padding:"12px 14px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em" }}>ANCHOR SCORE</div>
                    <div style={{ fontSize:11, color:ok?C.grn:C.mute, marginTop:4 }}>{ok?"✓ Successful day threshold met":"Anchors below 70% — push harder"}</div>
                  </div>
                  <div style={{ fontSize:30, fontWeight:700, color:ok?C.grn:C.org }}>{ap}%</div>
                </div>
              </div>
            );
          })()}

          {!dayRaw.submitted ? (
            <button onClick={() => { if (!allSet) return; patchDay({submitted:true,unlocked:false}); }}
              disabled={!allSet} style={{
                width:"100%", padding:17, borderRadius:11, border:"none",
                background:allSet?(dayPct>=80?`linear-gradient(135deg,${C.grn},#3a9960)`:dayPct>=50?`linear-gradient(135deg,${C.org},#a06828)`:`linear-gradient(135deg,${C.red},#a03828)`):C.s2,
                color:allSet?"#000":C.mute, fontFamily:C.mono, fontSize:13, letterSpacing:".1em",
                fontWeight:600, cursor:allSet?"pointer":"default", transition:"all .2s" }}>
              {allSet?`LOCK DAY · ${rawScore.toFixed(1)}pts · ${dayPct}%`:"Rate every habit to submit"}
            </button>
          ) : (
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ ...card, flex:1, marginBottom:0, textAlign:"center", border:`1px solid ${dayPct>=70?C.grn+"44":C.org+"33"}` }}>
                <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute }}>DAY LOCKED</div>
                <div style={{ fontSize:24, fontWeight:700, marginTop:4, color:dayPct>=70?C.grn:C.org }}>{rawScore.toFixed(1)}<span style={{ fontSize:12, color:C.mute }}>/{MAX_DAY.toFixed(0)}</span></div>
              </div>
              <button onClick={() => patchDay({unlocked:true})} style={{ background:C.s1, border:`1px solid ${C.bdr}`, borderRadius:13, color:C.mute, fontFamily:C.mono, fontSize:11, padding:"0 16px", cursor:"pointer" }}>EDIT</button>
            </div>
          )}
        </>}

        {/* ══════════ TASKS TAB ══════════ */}
        {tab==="tasks" && <>
          {/* Header */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div>
              <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".12em" }}>PRIORITY TASKS</div>
              <div style={{ fontSize:12, color:C.mute, marginTop:3 }}>
                {displayTasks.length} active · {tStats.carryOvers.length} carry-over{tStats.carryOvers.length!==1?"s":""} · {completedToday.length} done
              </div>
            </div>
            <button onClick={() => setModal({ mode:"add" })} style={{
              display:"flex", alignItems:"center", gap:6, padding:"10px 16px", borderRadius:9,
              background:"linear-gradient(135deg,#50b978,#3a9960)", border:"none", color:"#000",
              fontFamily:C.mono, fontSize:12, fontWeight:600, cursor:"pointer", letterSpacing:".06em" }}>+ ADD</button>
          </div>

          {/* Carry-over alert */}
          {tStats.carryOvers.length > 0 && (
            <div style={{ ...card, border:`1px solid rgba(210,140,60,.3)`, background:"rgba(210,140,60,.04)", padding:"11px 14px", marginBottom:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:18, flexShrink:0 }}>↩</span>
                <div>
                  <div style={{ fontFamily:C.mono, fontSize:11, color:C.org, letterSpacing:".08em" }}>
                    {tStats.carryOvers.length} TASK{tStats.carryOvers.length>1?"S":""} CARRIED FORWARD
                  </div>
                  <div style={{ fontSize:11, color:C.mute, marginTop:2 }}>These weren't finished. They demand attention today.</div>
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {displayTasks.length===0 && completedToday.length===0 && (
            <div style={{ textAlign:"center", padding:"52px 20px", color:C.mute, fontFamily:C.mono, fontSize:12, lineHeight:2 }}>
              No tasks yet.<br />Add your first priority task above.
            </div>
          )}

          {/* Active tasks */}
          {displayTasks.map((task, idx) => (
            <TaskRow key={task.id} task={task}
              isFirst={idx===0} isLast={idx===displayTasks.length-1}
              onComplete={completeTask} onDelete={deleteTask}
              onEdit={t => setModal({ mode:"edit", task:t })}
              onMoveUp={id => moveTask(id,-1)} onMoveDown={id => moveTask(id,1)} />
          ))}

          {/* Completed today */}
          {completedToday.length > 0 && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:8, margin:"16px 0 12px" }}>
                <div style={{ flex:1, height:1, background:C.bdr }} />
                <div style={{ fontFamily:C.mono, fontSize:10, color:"#3a4a3a", letterSpacing:".12em" }}>COMPLETED TODAY ({completedToday.length})</div>
                <div style={{ flex:1, height:1, background:C.bdr }} />
              </div>
              {completedToday.map((task,idx) => (
                <TaskRow key={task.id} task={task}
                  isFirst={idx===0} isLast={idx===completedToday.length-1}
                  onComplete={completeTask} onDelete={deleteTask}
                  onEdit={t => setModal({ mode:"edit", task:t })}
                  onMoveUp={() => {}} onMoveDown={() => {}} />
              ))}
            </>
          )}
        </>}

        {/* ══════════ FAST TAB ══════════ */}
        {tab==="fast" && <>
          <div style={{ ...card }}>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>FASTING ZONES — EDUCATIONAL</div>
            <ZoneBar elapsed={elapsed} />
            <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:10 }}>
              {ZONES.map((z,i) => (
                <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                  <div style={{ width:10, height:10, borderRadius:"50%", background:z.color, marginTop:2, flexShrink:0, opacity:elapsed>=z.from?1:.25 }} />
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:elapsed>=z.from?C.text:C.mute }}>{z.from}–{z.to}h · {z.label}</div>
                    <div style={{ fontSize:11, color:C.mute, fontFamily:C.mono }}>{z.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {fast?.startTs && !fast.completed && (
            <div style={{ ...card, textAlign:"center", border:`1px solid ${fastDone?C.grn+"55":C.bdr}` }}>
              <div style={{ fontFamily:C.mono, fontSize:10, color:fastDone?C.grn:C.mute, letterSpacing:".12em", marginBottom:10 }}>{fastDone?"FAST COMPLETE":"IN PROGRESS"}</div>
              <div style={{ fontSize:52, fontFamily:C.mono, fontWeight:500, lineHeight:1, color:fastDone?C.grn:C.text, textShadow:fastDone?`0 0 30px ${C.grn}44`:"none" }}>
                {fastDone?"✓":fmt(remain)}
              </div>
              {!fastDone && <>
                <div style={{ fontFamily:C.mono, fontSize:11, color:C.mute, marginTop:6 }}>remaining of {fast.hours}h · {elapsed.toFixed(1)}h elapsed</div>
                <div style={{ display:"inline-block", marginTop:10, padding:"6px 14px", borderRadius:8, background:curZone.color+"18", border:`1px solid ${curZone.color}44` }}>
                  <span style={{ fontSize:12, color:curZone.color, fontFamily:C.mono }}>{curZone.label} zone</span>
                </div>
              </>}
              <div style={{ display:"flex", gap:8, marginTop:14 }}>
                {fastDone && <button onClick={() => patchDay({fast:{...fast,completed:true,completedTs:Date.now()}})}
                  style={{ flex:1, padding:13, borderRadius:10, border:"none", background:`linear-gradient(135deg,${C.grn},#3a9960)`, color:"#000", fontFamily:C.mono, fontSize:13, cursor:"pointer", fontWeight:600 }}>MARK COMPLETE</button>}
                <button onClick={() => patchDay({fast:null})} style={{ flex:fastDone?0:1, padding:"13px 18px", borderRadius:10, background:C.s2, border:`1px solid ${C.bdr}`, color:C.mute, fontFamily:C.mono, fontSize:12, cursor:"pointer" }}>Cancel fast</button>
              </div>
            </div>
          )}

          {fast?.completed && (
            <div style={{ ...card, textAlign:"center", border:`1px solid ${C.grn}33` }}>
              <div style={{ fontSize:36 }}>✅</div>
              <div style={{ fontSize:15, fontWeight:600, color:C.grn, marginTop:8 }}>{fast.hours}h fast completed</div>
              <button onClick={() => patchDay({fast:null})} style={{ marginTop:12, padding:"8px 20px", borderRadius:8, background:C.s2, border:`1px solid ${C.bdr}`, color:C.mute, fontFamily:C.mono, fontSize:11, cursor:"pointer" }}>Start another</button>
            </div>
          )}

          {(!fast?.startTs || fast?.completed) && (
            <div style={{ ...card }}>
              <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>SELECT & START A FAST</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {FAST_OPTS.map(opt => (
                  <button key={opt.hours} onClick={() => patchDay({fast:{hours:opt.hours,startTs:Date.now(),completed:false}})}
                    style={{ padding:"18px 12px", borderRadius:11, border:`1px solid ${opt.color}44`, background:`${opt.color}0e`, cursor:"pointer" }}>
                    <div style={{ fontFamily:C.mono, fontSize:30, fontWeight:600, color:opt.color, lineHeight:1 }}>{opt.label}</div>
                    <div style={{ fontSize:10, color:C.mute, marginTop:5, fontFamily:C.mono }}>{ZONES.filter(z=>z.from<opt.hours).map(z=>z.label).join(" → ")}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ ...card }}>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>FASTING STATS</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[{label:"Completed",value:stats.fastsCompleted,color:C.grn},{label:"Consistency",value:stats.totalDays?`${Math.round((stats.fastsCompleted/stats.totalDays)*100)}%`:"—",color:"#7b6fa8"}].map(s => (
                <div key={s.label} style={{ background:C.bg, borderRadius:10, padding:13, border:`1px solid ${C.bdr}`, textAlign:"center" }}>
                  <div style={{ fontSize:30, fontWeight:700, color:s.color }}>{s.value}</div>
                  <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, marginTop:3 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </>}

        {/* ══════════ DASHBOARD TAB ══════════ */}
        {tab==="dash" && <>
          {/* Habit KPIs */}
          <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".12em", marginBottom:10 }}>HABIT PERFORMANCE</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            {[
              { label:"8-Wk Progress", value:`${stats.overallPct}%`, color:stats.overallPct>=75?C.grn:stats.overallPct>=50?C.org:C.red },
              { label:"Successful Days", value:stats.successDays, color:C.grn },
              { label:"Days Tracked", value:`${stats.totalDays}/${DAYS}`, color:C.text },
              { label:"7-Day Avg pts", value:stats.weekAvg??"—", color:C.org },
            ].map(k => (
              <div key={k.label} style={{ ...card, marginBottom:0, textAlign:"center" }}>
                <div style={{ fontFamily:C.mono, fontSize:9, color:C.mute, letterSpacing:".1em", marginBottom:8 }}>{k.label.toUpperCase()}</div>
                <div style={{ fontSize:30, fontWeight:700, color:k.color, lineHeight:1 }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Task KPIs */}
          <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".12em", marginBottom:10 }}>TASK EXECUTION</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:13 }}>
            {[
              { label:"Done Today",   value:tStats.doneToday.length,  color:C.grn },
              { label:"Carry-Overs",  value:tStats.carryOvers.length, color:tStats.carryOvers.length>0?C.org:C.mute },
              { label:"Active Tasks", value:tStats.active.length,     color:C.text },
              { label:"7-Day Rate",   value:tStats.weekRate!==null?`${tStats.weekRate}%`:"—",
                color:tStats.weekRate===null?C.mute:tStats.weekRate>=80?C.grn:tStats.weekRate>=50?C.org:C.red },
            ].map(k => (
              <div key={k.label} style={{ ...card, marginBottom:0, textAlign:"center" }}>
                <div style={{ fontFamily:C.mono, fontSize:9, color:C.mute, letterSpacing:".1em", marginBottom:8 }}>{k.label.toUpperCase()}</div>
                <div style={{ fontSize:30, fontWeight:700, color:k.color, lineHeight:1 }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Most avoided */}
          {tStats.topCarry.length > 0 && (
            <div style={{ ...card }}>
              <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>MOST AVOIDED TASKS</div>
              {tStats.topCarry.map(([title,count],i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 0", borderBottom:i<tStats.topCarry.length-1?`1px solid ${C.bdr}`:"none" }}>
                  <div style={{ fontSize:13, color:C.text, flex:1, paddingRight:10, lineHeight:1.3 }}>{title}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ height:5, width:56, background:"#1a1a1a", borderRadius:3 }}>
                      <div style={{ height:"100%", borderRadius:3, background:C.org, width:`${Math.min((count/5)*100,100)}%` }} />
                    </div>
                    <span style={{ fontFamily:C.mono, fontSize:11, color:C.org, minWidth:20, textAlign:"right" }}>{count}×</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Perfect streak */}
          <div style={{ ...card, display:"flex", justifyContent:"space-between", alignItems:"center",
            border:`1px solid ${stats.perfectAnchorStreak>0?C.grn+"33":C.bdr}` }}>
            <div>
              <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute }}>ANCHOR PERFECT STREAK</div>
              <div style={{ fontSize:11, color:C.mute, marginTop:4 }}>All anchors 🟢 — best ever: {stats.bestPerfect}d</div>
            </div>
            <div style={{ fontSize:40, fontWeight:700, color:C.grn, textShadow:`0 0 20px ${C.grn}55` }}>{stats.perfectAnchorStreak}</div>
          </div>

          {/* Weekly trend */}
          <div style={{ ...card }}>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>WEEKLY HABIT TREND</div>
            <BarChart weeklyPcts={stats.weeklyPcts} />
          </div>

          {/* Anchor breakdown */}
          <div style={{ ...card }}>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>ANCHOR HABIT CONSISTENCY</div>
            {ANCHOR_HABITS.map(h => {
              const b=stats.breakdown[h.id], n=stats.totalDays;
              if (!n) return <div key={h.id} style={{ fontSize:12, color:C.mute, marginBottom:8 }}>{h.icon} {h.label} — no data</div>;
              const gP=(b.g/n)*100, oP=(b.o/n)*100, rP=(b.r/n)*100;
              return (
                <div key={h.id} style={{ marginBottom:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:13, fontWeight:500 }}>{h.icon} {h.label}</span>
                    <span style={{ fontFamily:C.mono, fontSize:10, color:C.mute }}>{b.g}G · {b.o}O · {b.r}R</span>
                  </div>
                  <div style={{ display:"flex", height:6, borderRadius:3, overflow:"hidden", gap:1 }}>
                    {gP>0&&<div style={{ width:`${gP}%`, background:C.grn, borderRadius:"3px 0 0 3px" }} />}
                    {oP>0&&<div style={{ width:`${oP}%`, background:C.org }} />}
                    {rP>0&&<div style={{ width:`${rP}%`, background:C.red, borderRadius:"0 3px 3px 0" }} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Support breakdown */}
          <div style={{ ...card }}>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>SUPPORT HABIT CONSISTENCY</div>
            {SUPPORT_HABITS.map(h => {
              const b=stats.breakdown[h.id], n=stats.totalDays;
              if (!n) return <div key={h.id} style={{ fontSize:12, color:C.mute, marginBottom:8 }}>{h.icon} {h.label} — no data</div>;
              const gP=(b.g/n)*100, oP=(b.o/n)*100, rP=(b.r/n)*100;
              return (
                <div key={h.id} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:13 }}>{h.icon} {h.label}</span>
                    <span style={{ fontFamily:C.mono, fontSize:10, color:C.mute }}>{b.g}G {b.o}O {b.r}R</span>
                  </div>
                  <div style={{ display:"flex", height:5, borderRadius:3, overflow:"hidden", gap:1 }}>
                    {gP>0&&<div style={{ width:`${gP}%`, background:C.grn }} />}
                    {oP>0&&<div style={{ width:`${oP}%`, background:C.org }} />}
                    {rP>0&&<div style={{ width:`${rP}%`, background:C.red }} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Streaks */}
          <div style={{ ...card }}>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>CURRENT GREEN STREAKS</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {ALL_HABITS.map(h => (
                <div key={h.id} style={{ background:C.bg, borderRadius:9, padding:"10px 11px",
                  border:`1px solid ${stats.streaks[h.id]>0?C.grn+"2a":C.bdr}`,
                  borderLeft:ANCHOR_IDS.has(h.id)?`2px solid ${stats.streaks[h.id]>0?C.grn:"#2a2a2a"}`:`1px solid ${C.bdr}` }}>
                  <div style={{ fontSize:11, color:C.mute }}>{h.icon} {h.label}</div>
                  <div style={{ fontSize:22, fontWeight:700, fontFamily:C.mono, lineHeight:1.2, marginTop:4, color:stats.streaks[h.id]>0?C.grn:"#2a2a2a" }}>
                    {stats.streaks[h.id]}<span style={{ fontSize:10, color:C.mute }}> d</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>}

        {/* ══════════ LOG TAB ══════════ */}
        {tab==="log" && <>
          <div style={{ ...card }}>
            <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:14 }}>8-WEEK OVERVIEW</div>
            <CalGrid history={history} startDate={startDate} />
            <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginTop:14 }}>
              {[{col:"#50b978",label:"≥85%"},{col:"#7dcf9b",label:"65–84%"},{col:"#d28c3c",label:"45–64%"},{col:"#dc503c",label:"<45%"}].map(l => (
                <div key={l.label} style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <div style={{ width:10, height:10, borderRadius:2, background:l.col }} />
                  <span style={{ fontSize:10, color:C.mute, fontFamily:C.mono }}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute, letterSpacing:".1em", marginBottom:12 }}>DAILY LOG</div>
          {Object.keys(history).filter(d=>history[d].submitted).sort((a,b)=>b.localeCompare(a)).map(date => {
            const day=history[date];
            let pts=0; ALL_HABITS.forEach(h=>{pts+=(day.habits[h.id]??0)*(ANCHOR_IDS.has(h.id)?ANCHOR_W:SUPPORT_W);});
            const p=Math.round((pts/MAX_DAY)*100), pc=p>=80?C.grn:p>=50?C.org:C.red;
            const anchPts=ANCHOR_HABITS.reduce((s,h)=>s+(day.habits[h.id]??0)*ANCHOR_W,0);
            const success=(anchPts/MAX_ANCHOR)>=0.7;
            return (
              <div key={date} style={{ ...card, marginBottom:10, border:`1px solid ${success?C.grn+"22":C.bdr}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div>
                    <div style={{ fontFamily:C.mono, fontSize:11, color:C.mute }}>{date}</div>
                    <div style={{ fontSize:11, marginTop:3, color:success?C.grn:C.org }}>{success?"✓ Successful day":"◐ Partial day"}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:26, fontWeight:700, color:pc }}>{p}<span style={{ fontSize:13, color:C.mute }}>%</span></div>
                    <div style={{ fontFamily:C.mono, fontSize:10, color:C.mute }}>{pts.toFixed(1)}pts</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8 }}>
                  {ALL_HABITS.map(h => {
                    const v=day.habits[h.id]??0;
                    return <span key={h.id} style={{ fontSize:16, filter:v===0?"grayscale(1) opacity(.2)":v===0.5?"saturate(.5)":"none" }}>{h.icon}</span>;
                  })}
                </div>
                {day.fast?.completed&&<div style={{ fontSize:11, color:"#7b6fa8", marginBottom:8, fontFamily:C.mono }}>⧖ {day.fast.hours}h fast completed</div>}
                {day.morning&&<div style={{ fontSize:12, color:C.mute, fontStyle:"italic", borderTop:`1px solid ${C.bdr}`, paddingTop:8 }}>☀ {day.morning}</div>}
                {day.night&&<div style={{ fontSize:12, color:C.mute, fontStyle:"italic", marginTop:4 }}>🌙 {day.night}</div>}
              </div>
            );
          })}
          {!Object.keys(history).some(d=>history[d].submitted) && (
            <div style={{ textAlign:"center", padding:"50px 20px", color:C.mute, fontFamily:C.mono, fontSize:12, lineHeight:2 }}>
              No days submitted yet.<br />Complete and lock your first day.
            </div>
          )}
        </>}
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:430, background:C.bg, borderTop:`1px solid ${C.bdr}`,
        display:"flex", padding:"10px 0 calc(10px + env(safe-area-inset-bottom))" }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => setTab(n.id)} style={{
            flex:1, background:"none", border:"none",
            color:tab===n.id?C.grn:C.mute, cursor:"pointer", padding:"4px 0", transition:"color .15s",
          }}>
            <div style={{ lineHeight:1, fontSize:20, position:"relative", display:"inline-block" }}>
              {n.icon}
              {n.id==="tasks" && tStats.carryOvers.length > 0 && (
                <span style={{ position:"absolute", top:-3, right:-5, width:7, height:7,
                  borderRadius:"50%", background:C.org, border:`1.5px solid ${C.bg}`, display:"block" }} />
              )}
            </div>
            <div style={{ fontFamily:C.mono, fontSize:10, letterSpacing:".07em", marginTop:3 }}>{n.label}</div>
          </button>
        ))}
      </div>

      {/* ── TASK MODAL ── */}
      {taskModal && (
        <TaskModal
          initial={taskModal.task}
          onSave={({ title, priority }) => {
            taskModal.mode==="add" ? addTask({ title, priority }) : editTask(taskModal.task.id, { title, priority });
          }}
          onClose={() => setModal(null)} />
      )}
    </div>
  );
}
