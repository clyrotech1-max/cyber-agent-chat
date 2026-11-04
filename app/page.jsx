"use client";
import { useState, useEffect, useRef } from "react";

const MODELS = ["gemini-3-flash-preview", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro"];
const SUGGESTIONS = [
  "example.com ka security scan karo",
  "OWASP Top 10 simple lafzon me samjhao",
  "Meri site ke missing security headers ka fix batao",
  "Log file me brute-force kaise pehchano?",
];
function load(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

async function callGemini({ key, model, prompt }) {
  // Fix for screenshot error: 503 "high demand" pehle break kar deta tha, ab retry + next model.
  // Rule (12 Oct wali Brain fix jaisi): 404 = instant next model, 503/429 = backoff retry phir next model, 400/403 invalid key = foran ruk jao.
  const tries = [model, ...MODELS.filter(m => m !== model)];
  const tried = [];
  for (const m of tries) {
    tried.push(m);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system_instruction: { parts: [{ text: "You are Cyber Agent, an expert defensive security assistant. Only help with authorized targets (user's own sites, lab IPs, or targets they have written permission for). If asked to hack someone else without permission, refuse that part and explain the authorized alternative. Give clear plans, severity, and fixes. Never invent scan results - use only the scan JSON provided, and say when something is unverified." }] }, contents: [{ parts: [{ text: prompt }] }] })
        });
        const j = await r.json();
        const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("");
        if (r.ok && text) return { text, model: m };
        const errMsg = j?.error?.message || `HTTP ${r.status}`;
        const status = j?.error?.status || "";
        if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(errMsg + status)) {
          throw new Error("Gemini API key invalid ya permission nahi hai. Settings me key dobara check karo, aur agar key chat me share hui thi to Google AI Studio se rotate karke nayi key dalo.");
        }
        if (/404|not found|not supported/i.test(errMsg + status)) break; // next model, no retry
        if (/503|429|overload|high demand|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(errMsg + status)) {
          if (attempt === 0) { await new Promise(res => setTimeout(res, 2000)); continue; }
          break; // next model
        }
        throw new Error(errMsg);
      } catch (e) {
        if (/API key invalid/i.test(e.message)) throw e;
        if (attempt === 0 && /Failed to fetch|NetworkError/i.test(String(e))) { await new Promise(res => setTimeout(res, 1500)); continue; }
        if (e.message && !/Gemini call fail/i.test(e.message)) throw e;
        break;
      }
    }
  }
  throw new Error(`Sab models abhi overloaded / high demand de rahe hain (tried: ${tried.join(", ")}). Ye Google ki taraf se temporary hai, key ka masla nahi hai. 1-2 minute ruk kar dobara try karo, ya model dropdown se gemini-2.5-flash select karke dobara bhejo.`);
}

export default function Home() {
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState("example.com");
  const [permission, setPermission] = useState("approve");
  const [model, setModel] = useState(MODELS[0]);
  const [key, setKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const c = load("cyber_agent_chats", []);
    setChats(c); setActiveId(c[0]?.id || null);
    setKey(load("cyber_agent_gemini_key", "")); setModel(load("cyber_agent_model", MODELS[0]));
  }, []);
  useEffect(() => { save("cyber_agent_chats", chats); }, [chats]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chats, busy]);

  const active = chats.find(c => c.id === activeId) || null;
  function newChat() {
    const chat = { id: Date.now().toString(), title: "New chat", messages: [], created: new Date().toLocaleString() };
    setChats(prev => [chat, ...prev]); setActiveId(chat.id);
  }
  function updateChat(id, fn) { setChats(prev => prev.map(c => c.id === id ? fn(c) : c)); }
  function pushMsg(id, msg) {
    updateChat(id, c => {
      const messages = [...c.messages, msg];
      const title = c.title === "New chat" && msg.role === "user" ? msg.text.slice(0, 50) : c.title;
      return { ...c, messages, title };
    });
  }
  async function send(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    let id = activeId;
    if (!id) { const chat = { id: Date.now().toString(), title: "New chat", messages: [], created: new Date().toLocaleString() }; setChats(prev => [chat, ...prev]); id = chat.id; setActiveId(id); }
    pushMsg(id, { role: "user", text, time: new Date().toLocaleTimeString() });
    setInput(""); setBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      let scan = null, scanNote = "";
      const looksLikeScan = /scan|header|ssl|security|recon/i.test(text);
      if (looksLikeScan && target) {
        pushMsg(id, { role: "agent", text: "🛡️ Plan ban raha hai, phir sandbox me scan chal raha hai...", status: true });
        const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: text, target, permission }), signal: controller.signal });
        scan = await r.json();
        scanNote = scan.blocked ? `GUARDRAIL BLOCKED: ${scan.reason}` : `SCAN RESULT (raw, verified by tool): ${JSON.stringify(scan)}`;
      }
      let finalText = "", usedModel = "";
      if (key) {
        const prompt = `User task: ${text}\nTarget: ${target}\nPermission: ${permission}\n${scanNote}\n\nGive: 1) Short plan, 2) Findings with severity, 3) Fix steps, 4) What is still unverified. Use Roman Urdu simple language if user wrote in Roman Urdu, otherwise English. Keep it skimmable with headings and bullets.`;
        const g = await callGemini({ key, model, prompt });
        finalText = g.text; usedModel = g.model;
      } else {
        if (scan?.blocked) finalText = `⛔ Guardrail ne rok diya.\n\n${scan.reason}\n\nApni site ko allowlist me add karo (app/api/scan/route.js me ALLOWED_DOMAINS), ya demo ke liye example.com use karo.`;
        else if (scan) finalText = `✅ Scan complete (Gemini key ke baghair, rule-based report).\n\n**Findings:**\n${scan.findings.map(f => `- ${f}`).join("\n")}\n\n**Raw evidence:**\n\`\`\`json\n${JSON.stringify(scan, null, 2)}\n\`\`\`\n\n**Fix:** Missing headers ko server / hosting settings me add karo, phir dobara scan karo.\n\n💡 Next level AI report ke liye Settings me apni Gemini key apne browser me enter karo. Key chat me kabhi mat bhejo, wo sirf tumhare browser me save hogi.`;
        else finalText = `Main Cyber Agent hun, defensive security assistant.\n\nTum mujhse pooch sakte ho: OWASP Top 10, security headers ka fix, log analysis, ya kisi authorized site ka scan.\n\nScan ke liye upar Target me apni site likho aur message me "scan karo" likho. Gemini key ke baghair main rule-based report dunga, key lagane par Gemini plan + detailed report dega (Settings me).`;
      }
      // Remove status message, add final with typing effect
      updateChat(id, c => ({ ...c, messages: c.messages.filter(m => !m.status) }));
      pushMsg(id, { role: "agent", text: finalText, model: usedModel || (key ? model : "rule-based (no key)"), scan: scan && !scan.blocked ? scan : null });
    } catch (e) {
      if (e.name !== "AbortError") {
        updateChat(id, c => ({ ...c, messages: c.messages.filter(m => !m.status) }));
        pushMsg(id, { role: "agent", text: `Error: ${e.message}\n\nAgar ye high demand / overloaded error hai to ye temporary hai, 1-2 minute baad dobara try karo ya model badal kar gemini-2.5-flash try karo. Agar key invalid likha hai to Settings me key check karo. Scan tool alag se abhi bhi kaam karta hai.` });
      }
    }
    setBusy(false);
  }

  const filtered = chats.filter(c => (c.title + " " + c.messages.map(m => m.text).join(" ")).toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: "flex", height: "100vh", background: "#000", color: "#ececec", fontFamily: "system-ui, Arial" }}>
      {showSidebar && (
        <aside style={{ width: 280, background: "#0d0d0d", borderRight: "1px solid #222", display: "flex", flexDirection: "column", padding: 12, gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b>🛡️ Cyber Agent</b><button onClick={() => setShowSidebar(false)} style={{ background: "#222", color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>‹</button>
          </div>
          <button onClick={newChat} style={{ padding: 12, borderRadius: 12, background: "#00ff88", color: "#000", fontWeight: 800, border: "none", cursor: "pointer" }}>＋ New chat</button>
          <input placeholder="Search chats…" value={search} onChange={e => setSearch(e.target.value)} style={{ padding: 10, borderRadius: 10, background: "#1a1a1a", color: "#fff", border: "1px solid #333" }} />
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map(c => (
              <div key={c.id} onClick={() => setActiveId(c.id)} style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer", background: c.id === activeId ? "#222" : "transparent", display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                <button onClick={e => { e.stopPropagation(); setChats(prev => prev.filter(x => x.id !== c.id)); if (activeId === c.id) setActiveId(null); }} style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }}>×</button>
              </div>
            ))}
            {!filtered.length && <p style={{ color: "#888", fontSize: 13 }}>Koi chat nahi. New chat se shuru karo.</p>}
          </div>
          <button onClick={() => setShowSettings(true)} style={{ padding: 10, borderRadius: 10, background: "#1a1a1a", color: "#fff", border: "1px solid #333", cursor: "pointer" }}>⚙️ Settings — Gemini key & model</button>
          <p style={{ fontSize: 11, color: "#777" }}>Authorized targets only. Bina permission wale target par agent ruk jayega.</p>
        </aside>
      )}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "12px 20px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {!showSidebar && <button onClick={() => setShowSidebar(true)} style={{ background: "#222", color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>☰</button>}
          <b>Cyber Agent</b><span style={{ fontSize: 12, color: "#00ff88", border: "1px solid #00ff88", borderRadius: 20, padding: "2px 8px" }}>{model}</span>
          <span style={{ fontSize: 12, color: key ? "#00ff88" : "#ffaa00" }}>{key ? "Gemini connected (browser only)" : "Gemini key nahi lagi — rule-based mode"}</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px 20px" }}>
          <div style={{ maxWidth: 768, margin: "0 auto" }}>
            {!active || !active.messages.length ? (
              <div style={{ textAlign: "center", paddingTop: 60 }}>
                <h1 style={{ fontSize: 36 }}>Cyber Agent ko kya karna hai?</h1>
                <p style={{ color: "#aaa" }}>Task likho, agent apne sandbox me plan banaye ga, scan chalaye ga, aur evidence ke saath report dega.</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 20 }}>
                  {SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)} style={{ padding: "10px 14px", borderRadius: 20, background: "#1a1a1a", color: "#fff", border: "1px solid #333", cursor: "pointer" }}>{s}</button>)}
                </div>
              </div>
            ) : active.messages.map((m, i) => (
              <div key={i} style={{ margin: "24px 0", textAlign: m.role === "user" ? "right" : "left" }}>
                {m.role === "user" ? (
                  <span style={{ display: "inline-block", background: "#2a2a2a", padding: "10px 16px", borderRadius: 20, maxWidth: "85%", textAlign: "left", whiteSpace: "pre-wrap" }}>{m.text}</span>
                ) : (
                  <div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{m.text}</div>
                    {m.model && <p style={{ fontSize: 11, color: "#888" }}>Model: {m.model} • {m.time || ""}</p>}
                    {m.scan && <details style={{ marginTop: 8, background: "#111", padding: 10, borderRadius: 10 }}><summary style={{ cursor: "pointer" }}>Raw evidence (scan JSON)</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(m.scan, null, 2)}</pre></details>}
                  </div>
                )}
              </div>
            ))}
            {busy && <p>● Agent soch raha hai… <button onClick={() => abortRef.current?.abort()} style={{ background: "#222", color: "#fff", border: "1px solid #444", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>Stop</button></p>}
            <div ref={bottomRef} />
          </div>
        </div>
        <div style={{ padding: "0 20px 20px" }}>
          <div style={{ maxWidth: 768, margin: "0 auto", background: "#212121", borderRadius: 28, padding: "8px 12px", border: "1px solid #333" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Target: example.com" style={{ flex: 1, minWidth: 160, padding: 8, borderRadius: 10, background: "#111", color: "#fff", border: "1px solid #333" }} />
              <select value={permission} onChange={e => setPermission(e.target.value)} style={{ padding: 8, borderRadius: 10, background: "#111", color: "#fff", border: "1px solid #333" }}><option value="approve">Approve every action</option><option value="auto">Auto (safe only)</option><option value="full">Full (lab only)</option></select>
              <select value={model} onChange={e => { setModel(e.target.value); save("cyber_agent_model", e.target.value); }} style={{ padding: 8, borderRadius: 10, background: "#111", color: "#fff", border: "1px solid #333" }}>{MODELS.map(m => <option key={m}>{m}</option>)}</select>
            </div>
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={2} placeholder="Cyber Agent se poocho ya task do… (Enter = send, Shift+Enter = new line)" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} style={{ width: "100%", background: "transparent", color: "#fff", border: "none", outline: "none", resize: "none", fontSize: 16 }} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}><button onClick={() => send()} disabled={!input.trim() || busy} style={{ width: 40, height: 40, borderRadius: "50%", background: input.trim() ? "#00ff88" : "#444", color: "#000", fontWeight: 900, border: "none", cursor: "pointer", fontSize: 18 }}>↑</button></div>
          </div>
          <p style={{ textAlign: "center", fontSize: 11, color: "#777", maxWidth: 768, margin: "8px auto 0" }}>Cyber Agent galti kar sakta hai. Report ko verify karo. Bina permission wale target par kaam nahi karega.</p>
        </div>
      </main>
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 }} onClick={() => setShowSettings(false)}>
          <div style={{ background: "#111", border: "1px solid #333", borderRadius: 16, padding: 24, maxWidth: 500, width: "100%" }} onClick={e => e.stopPropagation()}>
            <h2>Settings — Gemini</h2>
            <p style={{ fontSize: 13, color: "#aaa" }}>Key sirf tumhare browser me save hogi (localStorage). Ye repo, server ya chat me nahi jayegi. Agar key kabhi chat me share ho gayi ho to pehle Google AI Studio se rotate karo, phir yahan nayi key dalo.</p>
            <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="Gemini API key (apne browser me enter karo)" style={{ width: "100%", padding: 12, borderRadius: 10, background: "#000", color: "#fff", border: "1px solid #333", margin: "10px 0" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { save("cyber_agent_gemini_key", key); setShowSettings(false); }} style={{ padding: 12, borderRadius: 10, background: "#00ff88", color: "#000", fontWeight: 800, border: "none", cursor: "pointer", flex: 1 }}>Save in this browser</button>
              <button onClick={() => { setKey(""); save("cyber_agent_gemini_key", ""); }} style={{ padding: 12, borderRadius: 10, background: "#222", color: "#fff", border: "1px solid #444", cursor: "pointer" }}>Clear</button>
            </div>
            <p style={{ fontSize: 12, color: "#888" }}>Model fallback: 404 par foran agla model, 503 / high demand par 2 second ruk kar retry phir agla model. Jo model jawab dega, uska naam jawab ke neeche dikhega.</p>
          </div>
        </div>
      )}
    </div>
  );
}
