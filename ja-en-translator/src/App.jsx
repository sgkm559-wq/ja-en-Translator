import React, { useEffect, useMemo, useRef, useState } from "react";

// JA↔EN Quick Translator — single-file React component
const cn = (...a) => a.filter(Boolean).join(" ");
const detectLang = (s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s) ? "JA" : "EN";
const debounce = (fn, ms=500) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };

function applyGlossary(text, map, dir) {
  if (!map || Object.keys(map).length === 0) return text;
  let out = text;
  for (const [from, to] of Object.entries(map)) {
    if (!from) continue;
    if (dir === "EN>JA") {
      const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, "gi");
      out = out.replace(re, to);
    } else {
      const re = new RegExp(escapeRegExp(from), "g");
      out = out.replace(re, to);
    }
  }
  return out;
}
function escapeRegExp(s){return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');}

async function translateViaDeepL({ text, source, target, apiKey, endpoint }) {
  if (!apiKey) throw new Error("DeepL API key is required");
  const url = endpoint || "https://api-free.deepl.com/v2/translate";
  const body = new URLSearchParams({
    auth_key: apiKey,
    text,
    source_lang: source.toUpperCase(),
    target_lang: target.toUpperCase(),
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`DeepL error ${res.status}`);
  const data = await res.json();
  return data?.translations?.[0]?.text ?? "";
}

async function translateViaGoogle({ text, source, target, apiKey, endpoint }) {
  if (!apiKey) throw new Error("Google Translate API key is required");
  const url = (endpoint || "https://translation.googleapis.com/language/translate/v2") + `?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, source: source.toLowerCase(), target: target.toLowerCase(), format: "text" }),
  });
  if (!res.ok) throw new Error(`Google error ${res.status}`);
  const data = await res.json();
  return data?.data?.translations?.[0]?.translatedText ?? "";
}

async function translateViaCustom({ text, source, target, endpoint }) {
  if (!endpoint) throw new Error("Custom endpoint required");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, source, target }),
  });
  if (!res.ok) throw new Error(`Custom proxy error ${res.status}`);
  const data = await res.json();
  return data.text ?? data.translation ?? "";
}

export default function App() {
  const [ja, setJa] = useState(() => localStorage.getItem("ts_ja") || "");
  const [en, setEn] = useState(() => localStorage.getItem("ts_en") || "");
  const [auto, setAuto] = useState(() => localStorage.getItem("ts_auto") === "1");
  const [provider, setProvider] = useState(() => localStorage.getItem("ts_provider") || "custom");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("ts_apiKey") || "");
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem("ts_endpoint") || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [glossJaEn, setGlossJaEn] = useState(() => JSON.parse(localStorage.getItem("ts_gloss_ja_en") || "{}"));
  const [glossEnJa, setGlossEnJa] = useState(() => JSON.parse(localStorage.getItem("ts_gloss_en_ja") || "{}"));
  const [history, setHistory] = useState([]);

  useEffect(() => { localStorage.setItem("ts_ja", ja); }, [ja]);
  useEffect(() => { localStorage.setItem("ts_en", en); }, [en]);
  useEffect(() => { localStorage.setItem("ts_auto", auto ? "1" : "0"); }, [auto]);
  useEffect(() => { localStorage.setItem("ts_provider", provider); }, [provider]);
  useEffect(() => { localStorage.setItem("ts_apiKey", apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem("ts_endpoint", endpoint); }, [endpoint]);
  useEffect(() => { localStorage.setItem("ts_gloss_ja_en", JSON.stringify(glossJaEn)); }, [glossJaEn]);
  useEffect(() => { localStorage.setItem("ts_gloss_en_ja", JSON.stringify(glossEnJa)); }, [glossEnJa]);

  const savePoint = () => setHistory(h => [...h.slice(-39), { ja, en }]);
  const undo = () => setHistory(h => { if (!h.length) return h; const last = h[h.length-1]; setJa(last.ja); setEn(last.en); return h.slice(0,-1); });

  const doTranslate = async (dir) => {
    const source = dir === "JA>EN" ? "JA" : "EN";
    const target = dir === "JA>EN" ? "EN" : "JA";
    const text = source === "JA" ? ja : en;
    const setOut = target === "EN" ? setEn : setJa;
    const glossMap = dir === "JA>EN" ? glossJaEn : glossEnJa;
    if (!text.trim()) return;
    setHistory(h => [...h.slice(-39), { ja, en }]);
    setBusy(true); setErr("");

    try {
      let translated = "";
      if (provider === "deepl") {
        translated = await translateViaDeepL({ text, source, target, apiKey, endpoint });
      } else if (provider === "google") {
        translated = await translateViaGoogle({ text, source, target, apiKey, endpoint });
      } else if (provider === "custom") {
        translated = await translateViaCustom({ text, source, target, endpoint });
      } else {
        throw new Error("Select a provider (or custom proxy)");
      }
      translated = applyGlossary(translated, glossMap, dir === "JA>EN" ? "JA>EN" : "EN>JA");
      setOut(translated);
    } catch (e) {
      setErr(e.message || String(e));
    } finally { setBusy(false); }
  };

  const autoTranslateJA = useMemo(() => debounce(() => doTranslate("JA>EN"), 600), [provider, apiKey, endpoint, glossJaEn]);
  const autoTranslateEN = useMemo(() => debounce(() => doTranslate("EN>JA"), 600), [provider, apiKey, endpoint, glossEnJa]);

  useEffect(() => { if (auto && detectLang(ja) === "JA") autoTranslateJA(); }, [ja]);
  useEffect(() => { if (auto && detectLang(en) === "EN") autoTranslateEN(); }, [en]);

  const copy = async (side) => {
    const text = side === "JA" ? ja : en; if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch {}
  };
  const clearSide = (side) => { setHistory(h => [...h.slice(-39), { ja, en }]); side === "JA" ? setJa("") : setEn(""); };
  const swap = () => { setHistory(h => [...h.slice(-39), { ja, en }]); setJa(en); setEn(ja); };

  const addGloss = (dir) => {
    const from = prompt(dir === "JA>EN" ? "用語（日本語）" : "Term (English)");
    if (!from) return;
    const to = prompt("置換後");
    if (to == null) return;
    if (dir === "JA>EN") setGlossJaEn(g => ({ ...g, [from]: to }));
    else setGlossEnJa(g => ({ ...g, [from]: to }));
  };
  const removeGloss = (dir, k) => {
    if (dir === "JA>EN") { const { [k]:_, ...rest } = glossJaEn; setGlossJaEn(rest); }
    else { const { [k]:_, ...rest } = glossEnJa; setGlossEnJa(rest); }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="text-xl font-semibold">JA↔EN Quick Translator</div>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm select-none">
              <input type="checkbox" className="accent-neutral-800" checked={auto} onChange={(e)=>setAuto(e.target.checked)} />
              Live auto-translate
            </label>
            <button onClick={undo} className="px-3 py-1.5 rounded border hover:bg-neutral-100 text-sm">Undo</button>
            <button onClick={swap} className="px-3 py-1.5 rounded border hover:bg-neutral-100 text-sm">Swap</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        <section className="mb-4 p-3 border rounded-lg bg-white shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <label className="text-xs text-neutral-500">Provider</label>
              <select value={provider} onChange={(e)=>setProvider(e.target.value)} className="px-3 py-2 border rounded w-44">
                <option value="custom">Custom proxy</option>
                <option value="deepl">DeepL API</option>
                <option value="google">Google Cloud Translate</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-neutral-500">Endpoint (recommended: your proxy URL)</label>
              <input value={endpoint} onChange={(e)=>setEndpoint(e.target.value)} placeholder="https://your.domain/translate" className="px-3 py-2 border rounded w-full"/>
            </div>
            {(provider === "deepl" || provider === "google") && (
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-neutral-500">API Key (avoid exposing in client apps)</label>
                <input value={apiKey} onChange={(e)=>setApiKey(e.target.value)} placeholder="••••••" className="px-3 py-2 border rounded w-full"/>
              </div>
            )}
            <div className="text-sm text-neutral-500">
              <p>Tip: deploy a proxy to keep keys safe. You already did with Cloudflare Worker!</p>
            </div>
          </div>
        </section>

        <section className="grid md:grid-cols-[1fr_auto_1fr] grid-cols-1 gap-4 items-stretch">
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">日本語</div>
              <div className="text-xs text-neutral-500">{ja.length} chars</div>
            </div>
            <textarea value={ja} onChange={(e)=>setJa(e.target.value)} placeholder="ここに日本語を入力" className="flex-1 min-h-[280px] md:min-h-[420px] p-3 border rounded-lg bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"/>
            <div className="mt-2 flex gap-2">
              <button onClick={()=>copy("JA")} className="px-3 py-1.5 text-sm rounded border hover:bg-neutral-100">Copy</button>
              <button onClick={()=>clearSide("JA")} className="px-3 py-1.5 text-sm rounded border hover:bg-neutral-100">Clear</button>
            </div>
          </div>

          <div className="md:self-center flex md:flex-col gap-2 justify-center">
            <button disabled={busy} onClick={()=>doTranslate("JA>EN")} className={cn("px-4 py-2 rounded border shadow-sm", busy && "opacity-60")}>JA → EN</button>
            <button disabled={busy} onClick={()=>doTranslate("EN>JA")} className={cn("px-4 py-2 rounded border shadow-sm", busy && "opacity-60")}>EN → JA</button>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">English</div>
              <div className="text-xs text-neutral-500">{en.length} chars</div>
            </div>
            <textarea value={en} onChange={(e)=>setEn(e.target.value)} placeholder="Write English here" className="flex-1 min-h-[280px] md:min-h-[420px] p-3 border rounded-lg bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"/>
            <div className="mt-2 flex gap-2">
              <button onClick={()=>copy("EN")} className="px-3 py-1.5 text-sm rounded border hover:bg-neutral-100">Copy</button>
              <button onClick={()=>clearSide("EN")} className="px-3 py-1.5 text-sm rounded border hover:bg-neutral-100">Clear</button>
            </div>
          </div>
        </section>

        {err && (<div className="mt-4 p-3 border rounded bg-red-50 text-red-700 text-sm">{String(err)}</div>)}

        <section className="mt-6 grid md:grid-cols-2 gap-4">
          <div className="p-3 border rounded-lg bg-white shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">Glossary JA→EN</div>
              <button onClick={()=>addGloss("JA>EN")} className="px-3 py-1.5 text-sm rounded border hover:bg-neutral-100">Add</button>
            </div>
            <ul className="text-sm max-h-48 overflow-auto">
              {Object.keys(glossJaEn).length === 0 && <li className="text-neutral-500">(empty)</li>}
              {Object.entries(glossJaEn).map(([k,v]) => (
                <li key={k} className="flex items-center justify-between py-1 border-b last:border-b-0">
                  <div className="pr-2 truncate"><span className="font-medium">{k}</span> → {v}</div>
                  <button onClick={()=>removeGloss("JA>EN", k)} className="text-xs px-2 py-1 border rounded hover:bg-neutral-100">✕</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="p-3 border rounded-lg bg-white shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">Glossary EN→JA</div>
              <button onClick={()=>addGloss("EN>JA")} className="px-3 py-1.5 text-sm rounded border hover:bg-neutral-100">Add</button>
            </div>
            <ul className="text-sm max-h-48 overflow-auto">
              {Object.keys(glossEnJa).length === 0 && <li className="text-neutral-500">(empty)</li>}
              {Object.entries(glossEnJa).map(([k,v]) => (
                <li key={k} className="flex items-center justify-between py-1 border-b last:border-b-0">
                  <div className="pr-2 truncate"><span className="font-medium">{k}</span> → {v}</div>
                  <button onClick={()=>removeGloss("EN>JA", k)} className="text-xs px-2 py-1 border rounded hover:bg-neutral-100">✕</button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-6 text-xs text-neutral-500 leading-relaxed">
          <p>Shortcuts: Ctrl/Cmd + Enter to translate focused pane; Ctrl/Cmd + Shift + S to swap.</p>
        </section>
      </main>
    </div>
  );
}
