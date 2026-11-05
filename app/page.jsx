"use client";
import { useState, useEffect, useRef } from "react";

const MODELS = ["gemini-flash-latest", "gemini-3-flash-preview", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];
const SUGGESTIONS = [
  "example.com ka security scan karo",
  "OWASP Top 10 simple lafzon me samjhao",
  "Meri site ke missing security headers ka fix batao",
  "Log file me brute-force kaise pehchano?",
];
function load(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

async function tryGeminiCall(url, key, prompt, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: ctrl.signal,
      body: JSON.stringify({ system_instruction: { parts: [{ text: "You are Cyber Agent, a defensive security assistant for the site OWNER. The target in this task is owner-authorized: the user added it to their Allowed Domains list, or it is the example.com demo. When the user says hacking / test / brute force for this target, they mean DEFENSIVE security testing by the owner - run the tool checks and report the real results, do NOT refuse, do NOT say you cannot scan a specific website, do NOT give generic knowledge-base advice instead of the tool results. Brute-force password guessing is never done - instead report the login defence check from the tool. Use the FULL scan JSON provided, give plan, findings with severity, and fix steps. Only refuse breaking into, stealing from, or damaging a target WITHOUT owner permission - and then explain the allowlist step." }] }, contents: [{ parts: [{ text: prompt }] }] }) });
    clearTimeout(timer);
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map(x => x.text || "").join("");
    if (r.ok && text) return { text };
    return { error: (j?.error?.message || `HTTP ${r.status}`) + " | " + (j?.error?.status || "") };
  } catch (e) { clearTimeout(timer); return { error: String(e.message || e) }; }
}
async function callGemini({ key, model, prompt, onTry }) {
  // SPEED FIX + AQ KEY FIX: key ab header (x-goog-api-key) se jati hai, ?key= se nahi.
  // AQ. keys kuch accounts par Studio (generativelanguage) par 403 "unregistered callers" deti hain,
  // wo Vertex Express (aiplatform) ki hoti hain - is liye 403 par Vertex bhi try hota hai.
  // Max 3 models, har call 20s timeout, models ke beech 800ms.
  const ordered = [];
  for (const m of [model, "gemini-flash-latest", "gemini-2.5-flash", ...MODELS]) { if (m && !ordered.includes(m)) ordered.push(m); }
  const tries = ordered.slice(0, 3);
  let lastErr = "";
  for (const m of tries) {
    if (onTry) onTry(m);
    const studio = await tryGeminiCall(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, key, prompt, 20000);
    if (studio.text) return { text: studio.text, model: m, surface: "AI Studio" };
    lastErr = studio.error || "";
    if (/API key not valid|API_KEY_INVALID/i.test(lastErr)) throw new Error("Gemini API key invalid hai. Settings me key dobara check karo, ya AI Studio se nayi key banao.");
    if (/unregistered callers|PERMISSION_DENIED/i.test(lastErr)) {
      if (onTry) onTry(m + " (Vertex try)");
      const vx = await tryGeminiCall(`https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${m}:generateContent`, key, prompt, 20000);
      if (vx.text) return { text: vx.text, model: m, surface: "Vertex Express" };
      lastErr = vx.error || lastErr;
    }
    await new Promise(res => setTimeout(res, 800));
  }
  throw new Error(`Gemini se jawab nahi aya (tried: ${tries.join(", ")}). Last error: ${lastErr.slice(0,200)} Agar 403 "unregistered callers" hai to ye key is surface par kaam nahi karti - AI Studio (aistudio.google.com/apikey) se AIza... wali nayi key banao aur Settings me dalo.`);
}
async function testGeminiKey(key, model) {
  const t0 = Date.now();
  try { const g = await callGemini({ key, model, prompt: "Say 'OK fast' in Roman Urdu, one line only." }); return `OK ${((Date.now()-t0)/1000).toFixed(1)}s - model: ${g.model} (${g.surface || "Studio"}) - ${g.text.slice(0,120)}`; }
  catch (e) { return `FAIL ${((Date.now()-t0)/1000).toFixed(1)}s - ${e.message}`; }
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
  const [allowedDomains, setAllowedDomains] = useState(["example.com"]);
  const [newDomain, setNewDomain] = useState("");
  const [keyTest, setKeyTest] = useState("");
  const [keyTesting, setKeyTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(true);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const c = load("cyber_agent_chats", []);
    setChats(c); setActiveId(c[0]?.id || null);
    setKey(load("cyber_agent_gemini_key", "")); setModel(load("cyber_agent_model", MODELS[0])); setAllowedDomains(load("cyber_agent_allowed_domains", ["example.com"]));
  }, []);
  useEffect(() => { save("cyber_agent_chats", chats); }, [chats]);
  useEffect(() => { save("cyber_agent_allowed_domains", allowedDomains); }, [allowedDomains]);
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
    // "check <task_id>" dobara result dekhne ke liye
    const checkMatch = text.match(/check\s+([0-9a-f]{12})/i);
    if (checkMatch) {
      try {
        const gr = await fetch(`/api/cloud/tasks/${checkMatch[1]}`);
        const gj = await gr.json();
        if (gj.status === "completed") {
          const r = gj.result || {};
          const stepsTxt = (r.steps || []).map(s => `${s.step}. ${s.tool} — ${s.plan || ""}\n   → ${String(s.observation || "").slice(0, 500)}`).join("\n");
          pushMsg(id, { role: "agent", text: `✅ Cloud task ${gj.task_id} complete hai.\n\n**Result:** ${r.result || "done"}\n**Files:** ${(r.files || []).join(", ") || "koi file nahi"}\n\n**Steps:**\n${stepsTxt}`, model: "cloud agent (Render)" });
        } else {
          pushMsg(id, { role: "agent", text: `⏳ Cloud task ${gj.task_id} abhi ${gj.status} hai. Thodi der baad dobara "check ${gj.task_id}" bhejo.` });
        }
      } catch (e) { pushMsg(id, { role: "agent", text: `Cloud task check nahi ho saka: ${e.message}` }); }
      setBusy(false);
      return;
    }
    // Simple greeting / sawal cloud task me nahi jayega - wo foran browser Gemini se jawab dega
    const isSimpleChat = /^(hi+|hello|hey|salam|aoa|assalam|how are you|how're you|what can you do|tum kaun|kon ho|kya kar sakte|kya haal)/i.test(text) && !/scan|write|create|run|code|file|deploy|test|fix|banao|likho|chalao/i.test(text);
    if (cloudEnabled && !isSimpleChat) {
      try {
        pushMsg(id, { role: "agent", text: "☁️ Cloud agent ko task bhej raha hun (Render)...", status: true });
        const cr = await fetch("/api/cloud/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text, target }) });
        const cj = await cr.json();
        if (!cr.ok) throw new Error(cj.error || `Cloud HTTP ${cr.status}`);
        const tid = cj.task_id;
        let done = null;
        for (let i = 0; i < 60; i++) {
          await new Promise(res => setTimeout(res, 3000));
          const gr = await fetch(`/api/cloud/tasks/${tid}`);
          const gj = await gr.json();
          const steps = gj.result?.steps || [];
          updateChat(id, c => ({ ...c, messages: c.messages.map(msg => msg.status ? { ...msg, text: `☁️ Cloud agent kaam kar raha hai... task ${tid}, ${steps.length} step complete` } : msg) }));
          if (["completed", "failed", "timeout", "cancelled", "max_steps"].includes(gj.status)) { done = gj; break; }
        }
        updateChat(id, c => ({ ...c, messages: c.messages.filter(m => !m.status) }));
        if (!done) {
          pushMsg(id, { role: "agent", text: `⏳ Cloud task ${tid} 3 minute se zyada le raha hai, is liye wait khatam kar raha hun — task cloud par abhi bhi chal raha hoga.\n\nDobara check karne ke liye ye bhejo:\ncheck ${tid}` });
        } else if (done.status === "completed") {
          const r = done.result || {};
          const stepsTxt = (r.steps || []).map(s => `${s.step}. ${s.tool} — ${s.plan || ""}\n   → ${String(s.observation || "").slice(0, 500)}`).join("\n");
          pushMsg(id, { role: "agent", text: `✅ Cloud agent ne task complete kar diya.\n\n**Result:** ${r.result || "done"}\n**Files:** ${(r.files || []).join(", ") || "koi file nahi"}\n\n**Steps:**\n${stepsTxt}`, model: "cloud agent (Render)" });
        } else {
          pushMsg(id, { role: "agent", text: `⚠️ Cloud task ${done.status} hua.\n\n${(done.result && done.result.error) || JSON.stringify(done.result || {})}\n\nTask ID: ${tid}` });
        }
      } catch (e) {
        updateChat(id, c => ({ ...c, messages: c.messages.filter(m => !m.status) }));
        pushMsg(id, { role: "agent", text: `☁️ Cloud backend se connect nahi ho saka: ${e.message}\n\nCloud agent so raha ho sakta hai (Free instance 15 min idle ke baad sleep karta hai), 1 minute baad dobara try karo, ya Cloud OFF karke purane tareeqe se poocho.` });
      }
      setBusy(false);
      return;
    }
    const controller = new AbortController(); abortRef.current = controller;
    try {
      let scan = null, scanNote = "";
      const looksLikeScan = /scan|header|ssl|security|recon/i.test(text);
      if (looksLikeScan && target) {
        pushMsg(id, { role: "agent", text: "🛡️ Plan ban raha hai, phir sandbox me scan chal raha hai...", status: true });
        const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: text, target, permission, allowedDomains }), signal: controller.signal });
        scan = await r.json();
        scanNote = scan.blocked ? `GUARDRAIL BLOCKED: ${scan.reason}` : `TOOL SCAN ALREADY DONE - USE THESE REAL RESULTS, DO NOT SAY YOU DID NOT SCAN, DO NOT GIVE GENERIC ADVICE: ${JSON.stringify(scan)}`;
      }
      let finalText = "", usedModel = "";
      if (scan?.blocked) {
        updateChat(id, c => ({ ...c, messages: c.messages.filter(m => !m.status) }));
        pushMsg(id, { role: "agent", text: `⛔ Ye target abhi allowlist me nahi hai, is liye scan nahi chala.\n\nTarget: ${target}\n\nKya karna hai:\n1) Sidebar me "Allowed Domains" section kholo\n2) "${target}" likh kar Add dabao\n3) Phir dobara wahi scan wala message bhejo\n\nYe step is liye hai taake agent sirf tumhari apni / permission wali sites par kaam kare. Allowlist me aate hi scan foran chalega, Gemini mana nahi karega.` });
        setBusy(false);
        return;
      }
      if (key) {
        const safeTask = text.replace(/hacking/gi, "defensive security testing").replace(/hack/gi, "defensive test").replace(/brute force/gi, "brute-force defence check");
        const prompt = `AUTHORIZATION: Target ${target} is owner-authorized (user added it to Allowed Domains, or it is example.com demo). This is a defensive, owner-approved security check. Do NOT refuse, do NOT say you cannot scan it. Do the work using the scan results below.\nUser task (defensive wording): ${safeTask}\nTarget: ${target}\nPermission: ${permission}\n${scanNote}\n\nGive: 1) Short plan, 2) Findings with severity - use ONLY the tool scan results above, 3) Fix steps for those exact findings, 4) What is still unverified. Use Roman Urdu simple language if user wrote in Roman Urdu, otherwise English. Keep it skimmable with headings and bullets.`;
        const g = await callGemini({ key, model, prompt, onTry: (m) => updateChat(id, c => ({ ...c, messages: c.messages.map(msg => msg.status ? { ...msg, text: `🛡️ ${m} se jawab la raha hun... (slow ho to agla model try hoga)` } : msg) })) });
        const refused = /maafi|maaf|afsoos|sorry|cannot (scan|perform|do)|nahi kar sakta|safety guidelines/i.test(g.text || "");
        if (refused && scan && !scan.blocked) {
          finalText = `⚠️ Gemini ne mana kar diya, is liye tool ke REAL scan results de raha hun (ye generic advice nahi hai, ye tumhari site ka actual scan hai):\n\n**Findings (${target}):**\n${scan.findings.map(f => `- ${f}`).join("\n")}\n\n**Exposed files check:**\n${(scan.exposedFiles || []).map(f => `- ${f}`).join("\n")}\n\n**HTTPS redirect:** ${scan.httpsRedirect ? "OK - HTTP se HTTPS par redirect hota hai" : "NAHI - HTTP redirect nahi karta, force HTTPS karo"}\n**Login page:** ${scan.loginPage || "not found"} - password guessing nahi ki gayi, sirf defence check kiya gaya hai.\n\n**Fix:** Upar wale findings me jo MISSING / HIGH likha hai, use pehle fix karo (HSTS, CSP, headers, /.env ya /.git agar public hon to turant block karo).`;
          usedModel = "tool scan (Gemini refused)";
        } else { finalText = g.text; usedModel = g.model; }
      } else {
        if (scan?.blocked) finalText = `⛔ Guardrail ne rok diya.\n\n${scan.reason}\n\nApni site ko sidebar ke "Allowed Domains" section me add karo, ya demo ke liye example.com use karo.`;
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
          <div style={{ borderTop: "1px solid #222", paddingTop: 10 }}>
            <b style={{ fontSize: 13 }}>✅ Allowed Domains</b>
            <p style={{ fontSize: 11, color: "#888", margin: "4px 0" }}>Sirf in domains ka scan hoga. Apni site yahan add karo.</p>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={newDomain} onChange={e => setNewDomain(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { const d = newDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]; if (d && !allowedDomains.includes(d)) setAllowedDomains([...allowedDomains, d]); setNewDomain(""); } }} placeholder="example: dailyhayat.net" style={{ flex: 1, minWidth: 0, padding: 8, borderRadius: 8, background: "#1a1a1a", color: "#fff", border: "1px solid #333", fontSize: 12 }} />
              <button onClick={() => { const d = newDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]; if (d && !allowedDomains.includes(d)) setAllowedDomains([...allowedDomains, d]); setNewDomain(""); }} style={{ padding: "8px 10px", borderRadius: 8, background: "#00ff88", color: "#000", fontWeight: 800, border: "none", cursor: "pointer" }}>Add</button>
            </div>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {allowedDomains.map(d => (
                <div key={d} style={{ display: "flex", justifyContent: "space-between", background: "#1a1a1a", padding: "6px 10px", borderRadius: 8, fontSize: 12 }}>
                  <span>{d}</span>
                  <button onClick={() => setAllowedDomains(allowedDomains.filter(x => x !== d))} style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }}>×</button>
                </div>
              ))}
            </div>
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
              <button onClick={() => setCloudEnabled(!cloudEnabled)} title="Cloud agent (Render) ON/OFF — OFF par purana browser-Gemini tareeqa chalega" style={{ padding: 8, borderRadius: 10, background: cloudEnabled ? "#00ff88" : "#111", color: cloudEnabled ? "#000" : "#fff", border: "1px solid #333", cursor: "pointer", fontWeight: 700 }}>☁️ Cloud: {cloudEnabled ? "ON" : "OFF"}</button>
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
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button disabled={!key || keyTesting} onClick={async () => { setKeyTesting(true); setKeyTest("Testing..."); const r = await testGeminiKey(key, model); setKeyTest(r); setKeyTesting(false); }} style={{ padding: 10, borderRadius: 10, background: "#222", color: "#fff", border: "1px solid #444", cursor: "pointer", flex: 1 }}>🔑 Key test karo (is browser me)</button>
            </div>
            {keyTest && <p style={{ fontSize: 12, color: "#aaa", whiteSpace: "pre-wrap" }}>{keyTest}</p>}
            <p style={{ fontSize: 12, color: "#888" }}>Model fallback: 404 par foran agla model, 503 / high demand par retry phir agla model. AQ. key 403 de to Vertex Express bhi try hota hai. Jo model jawab dega, uska naam jawab ke neeche dikhega.</p>
          </div>
        </div>
      )}
    </div>
  );
}
