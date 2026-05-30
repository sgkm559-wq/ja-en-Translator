import React, { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "line_stamp_creator_state_v2";

const defaultState = {
  apiKey: "",
  theme: "",
  vibe: [],
  stampCount: 8,
  textModel: "gemini-3.5-flash",
  imageModel: "gemini-3.1-flash-image",
};

const vibeOptions = ["ゆるかわ", "シュール", "ビジネス向け", "感情豊か", "モノクロ", "ポップ", "和風", "ゆるい敬語"];

const checkItems = [
  { title: "スタンプ画像サイズ", desc: "W370px × H320px 以内。生成後は必要に応じて画像編集アプリでリサイズします。" },
  { title: "PNG形式", desc: "LINE Creators Marketへアップロードする画像はPNGで用意します。" },
  { title: "1MB以下", desc: "1枚あたり最大1,024KB。大きい場合は圧縮してください。" },
  { title: "メイン画像", desc: "240×240px のPNGを1枚用意します。" },
  { title: "トークルームタブ画像", desc: "96×74px のPNGを1枚用意します。" },
  { title: "権利確認", desc: "既存キャラクター、有名人、商標、写真の無断利用がないか確認します。" },
  { title: "表現確認", desc: "暴力・成人向け・差別的表現など審査で問題になりやすい内容がないか確認します。" },
  { title: "説明文と価格", desc: "日本語・英語のタイトル、説明文、販売価格を決めておきます。" },
];

const creatorSteps = [
  ["LINE Creators Marketにログイン", "スマホのLINEアカウントで creator.line.me にログインします。"],
  ["新規アイテム作成", "「スタンプ」→「静止画」を選択します。"],
  ["基本情報を入力", "タイトル、説明文、カテゴリ、コピーライトを登録します。"],
  ["画像をアップロード", "スタンプ画像、メイン画像、トークルームタブ画像をアップロードします。"],
  ["販売設定", "販売地域と価格を設定します。"],
  ["審査申請", "審査基準を確認して申請します。審査中は修正できないため最終確認をします。"],
  ["リリース", "承認後にダッシュボードからリリースすると販売開始です。"],
];

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return { ...fallback, ...JSON.parse(value) };
  } catch {
    return fallback;
  }
}

function makePrompt({ theme, vibe, stampCount }) {
  return `あなたはLINEスタンプのクリエイティブディレクターです。\n以下の条件で、日常会話で使いやすいLINEスタンプ案を作ってください。\n\nテーマ: ${theme}\n雰囲気: ${vibe.length ? vibe.join("、") : "指定なし"}\n枚数: ${stampCount}枚\n\n必ず次のJSONだけを返してください。説明文、コードブロック、Markdownは不要です。\n{\n  "series_concept": "シリーズ全体のコンセプト説明（3〜4文）",\n  "stamps": [\n    {\n      "id": 1,\n      "label": "15字以内の短いラベル",\n      "description": "表情・ポーズ・入れる文字の説明",\n      "prompt_en": "Detailed English image prompt for a cute LINE sticker illustration"\n    }\n  ]\n}\n\n条件:\n- stampsは必ず${stampCount}件にしてください。\n- prompt_enには、同じキャラクター性が保てるように外見・画風・構図を含めてください。\n- 既存キャラクターや有名人に似せないでください。`;
}

function extractJson(text) {
  if (!text) throw new Error("Geminiからテキストが返りませんでした。");
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON形式の応答を見つけられませんでした。もう一度生成してください。");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.stamps) || !parsed.series_concept) {
    throw new Error("必要な項目（series_concept / stamps）が不足しています。");
  }
  return parsed;
}

async function callGeminiText({ apiKey, model, prompt }) {
  if (!apiKey.trim()) throw new Error("Gemini APIキーを入力してください。");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey.trim(),
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 6000,
        responseMimeType: "application/json",
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini API error ${res.status}`);
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
}

async function callGeminiImage({ apiKey, model, prompt }) {
  if (!apiKey.trim()) throw new Error("Gemini APIキーを入力してください。");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey.trim(),
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini API error ${res.status}`);
  if (data.error) throw new Error(data.error.message);
  const imgPart = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData || part.inline_data);
  const inlineData = imgPart?.inlineData || imgPart?.inline_data;
  if (!inlineData?.data) throw new Error("画像データが返りませんでした。モデル名やAPIキーの権限を確認してください。");
  return `data:${inlineData.mimeType || inlineData.mime_type || "image/png"};base64,${inlineData.data}`;
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

export default function App() {
  const [settings, setSettings] = useState(() => safeJsonParse(localStorage.getItem(STORAGE_KEY), defaultState));
  const [step, setStep] = useState(0);
  const [concept, setConcept] = useState(null);
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checks, setChecks] = useState({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canContinue = settings.apiKey.trim() && settings.theme.trim();
  const doneChecks = useMemo(() => Object.values(checks).filter(Boolean).length, [checks]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const update = (patch) => setSettings((prev) => ({ ...prev, ...patch }));

  const toggleVibe = (name) => {
    update({
      vibe: settings.vibe.includes(name)
        ? settings.vibe.filter((item) => item !== name)
        : [...settings.vibe, name],
    });
  };

  const goToStep = (nextStep) => {
    setStep(nextStep);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const generateConcept = async () => {
    if (!settings.theme.trim()) {
      setError("テーマを入力してください。");
      return;
    }
    setBusy(true);
    setError("");
    setImages([]);
    try {
      const text = await callGeminiText({
        apiKey: settings.apiKey,
        model: settings.textModel,
        prompt: makePrompt(settings),
      });
      const parsed = extractJson(text);
      const stamps = parsed.stamps.slice(0, Number(settings.stampCount)).map((stamp, index) => ({
        id: stamp.id || index + 1,
        label: String(stamp.label || `スタンプ${index + 1}`).slice(0, 30),
        description: stamp.description || "",
        prompt_en: stamp.prompt_en || `${settings.theme}, cute LINE sticker illustration`,
      }));
      setConcept({ series_concept: parsed.series_concept, stamps });
      goToStep(2);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateStamp = (index, field, value) => {
    setConcept((prev) => ({
      ...prev,
      stamps: prev.stamps.map((stamp, i) => (i === index ? { ...stamp, [field]: value } : stamp)),
    }));
  };

  const generateImages = async () => {
    if (!concept?.stamps?.length) {
      setError("先にコンセプトを生成してください。");
      return;
    }
    setBusy(true);
    setError("");
    setImages(concept.stamps.map(() => ({ status: "waiting", src: "", error: "" })));

    for (let i = 0; i < concept.stamps.length; i += 1) {
      const stamp = concept.stamps[i];
      setImages((prev) => prev.map((item, idx) => (idx === i ? { ...item, status: "generating", error: "" } : item)));
      try {
        const imagePrompt = `${stamp.prompt_en}. ${stamp.description}. LINE sticker, cute expressive original character, clean bold outline, transparent or plain background, centered composition, no copyrighted characters, no celebrity likeness, no extra text unless the label explicitly says text is needed.`;
        const src = await callGeminiImage({ apiKey: settings.apiKey, model: settings.imageModel, prompt: imagePrompt });
        setImages((prev) => prev.map((item, idx) => (idx === i ? { status: "done", src, error: "" } : item)));
      } catch (err) {
        setImages((prev) => prev.map((item, idx) => (idx === i ? { status: "error", src: "", error: err.message || String(err) } : item)));
      }
      if (i < concept.stamps.length - 1) await new Promise((resolve) => setTimeout(resolve, 900));
    }
    setBusy(false);
  };

  const progress = images.length ? Math.round((images.filter((img) => img.status === "done" || img.status === "error").length / images.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-neutral-100">
      <header className="sticky top-0 z-20 border-b border-neutral-800 bg-[#0d0d0d]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#06C755] text-xs font-black text-white">LINE</div>
          <div>
            <h1 className="text-base font-black tracking-wide sm:text-lg">スタンプ クリエイター</h1>
            <p className="text-[11px] text-neutral-500">スマホで案出し → 画像生成 → 申請確認</p>
          </div>
          <a className="ml-auto hidden rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-[#06C755] sm:inline-flex" href="https://creator.line.me/" target="_blank" rel="noreferrer">Creators Market</a>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 pb-3 text-xs">
          {["設定", "コンセプト", "編集", "画像", "チェック", "申請"].map((label, index) => (
            <button key={label} onClick={() => goToStep(index)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 ${step === index ? "border-[#00e5a0] bg-[#00e5a0] text-black" : index < step ? "border-[#06C755] text-[#06C755]" : "border-neutral-800 text-neutral-500"}`}>{index + 1}. {label}</button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 sm:py-8">
        {error && <div className="mb-4 rounded-xl border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">⚠️ {error}</div>}

        {step === 0 && (
          <section className="space-y-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00e5a0]">Step 01</p>
              <h2 className="mt-2 text-2xl font-black">APIキーとテーマを設定</h2>
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <label className="text-sm font-bold">Gemini API Key</label>
              <p className="mt-1 text-xs leading-6 text-neutral-500">キーはこの端末のlocalStorageに保存されます。共有端末では保存しないでください。</p>
              <input type="password" value={settings.apiKey} onChange={(e) => update({ apiKey: e.target.value })} placeholder="AIza..." className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm outline-none focus:border-[#00e5a0]" />
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <label className="text-sm font-bold">キャラクター・テーマ</label>
              <textarea value={settings.theme} onChange={(e) => update({ theme: e.target.value })} rows={4} placeholder="例：ゆるいくまのキャラクター。日常会話で使いやすい、かわいい系のスタンプ" className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-base outline-none focus:border-[#00e5a0]" />
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <label className="text-sm font-bold">雰囲気</label>
              <div className="mt-3 flex flex-wrap gap-2">
                {vibeOptions.map((name) => <button key={name} onClick={() => toggleVibe(name)} className={`rounded-full border px-3 py-2 text-sm ${settings.vibe.includes(name) ? "border-[#00e5a0] bg-[#00e5a0]/10 text-[#00e5a0]" : "border-neutral-700 text-neutral-400"}`}>{name}</button>)}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-sm font-bold">スタンプ枚数
                <select value={settings.stampCount} onChange={(e) => update({ stampCount: Number(e.target.value) })} className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm outline-none focus:border-[#00e5a0]">
                  {[8, 16, 24, 32, 40].map((count) => <option key={count} value={count}>{count}枚</option>)}
                </select>
              </label>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                <button onClick={() => setShowAdvanced((value) => !value)} className="text-sm font-bold text-[#00e5a0]">詳細設定 {showAdvanced ? "−" : "+"}</button>
                {showAdvanced && <div className="mt-3 space-y-3">
                  <input value={settings.textModel} onChange={(e) => update({ textModel: e.target.value })} className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-xs outline-none" aria-label="Text model" />
                  <input value={settings.imageModel} onChange={(e) => update({ imageModel: e.target.value })} className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-xs outline-none" aria-label="Image model" />
                </div>}
              </div>
            </div>
            <button disabled={!canContinue} onClick={() => goToStep(1)} className="w-full rounded-2xl bg-[#00e5a0] px-5 py-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">次へ：コンセプト生成</button>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00e5a0]">Step 02</p>
            <h2 className="text-2xl font-black">スタンプ案を生成</h2>
            <div className="rounded-2xl border border-yellow-900/60 bg-yellow-950/20 p-4 text-sm leading-7 text-yellow-100">Geminiがセリフ、表情、画像プロンプトをJSONで生成します。生成後にスマホで編集できます。</div>
            <button disabled={busy} onClick={generateConcept} className="w-full rounded-2xl bg-[#00e5a0] px-5 py-4 font-black text-black disabled:opacity-40 sm:w-auto">{busy ? "生成中..." : "✨ コンセプトを生成"}</button>
            <button onClick={() => goToStep(0)} className="ml-0 w-full rounded-2xl border border-neutral-700 px-5 py-4 font-bold text-neutral-200 sm:ml-3 sm:w-auto">戻る</button>
          </section>
        )}

        {step === 2 && concept && (
          <section className="space-y-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00e5a0]">Step 03</p>
            <h2 className="text-2xl font-black">内容を確認・編集</h2>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-sm leading-7 text-neutral-300">{concept.series_concept}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {concept.stamps.map((stamp, index) => (
                <div key={stamp.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                  <div className="mb-3 text-xs font-bold text-neutral-500">#{String(index + 1).padStart(2, "0")}</div>
                  <input value={stamp.label} onChange={(e) => updateStamp(index, "label", e.target.value)} className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm font-bold outline-none focus:border-[#00e5a0]" />
                  <textarea value={stamp.description} onChange={(e) => updateStamp(index, "description", e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-[#00e5a0]" />
                </div>
              ))}
            </div>
            <button onClick={() => goToStep(3)} className="w-full rounded-2xl bg-[#00e5a0] px-5 py-4 font-black text-black sm:w-auto">次へ：画像生成</button>
          </section>
        )}

        {step === 3 && concept && (
          <section className="space-y-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00e5a0]">Step 04</p>
            <h2 className="text-2xl font-black">画像を生成</h2>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-[#00e5a0] transition-all" style={{ width: `${progress}%` }} /></div>
              <p className="mt-2 text-xs text-neutral-500">{images.length ? `${progress}% 完了` : "未生成"}</p>
            </div>
            <button disabled={busy} onClick={generateImages} className="w-full rounded-2xl bg-[#00e5a0] px-5 py-4 font-black text-black disabled:opacity-40 sm:w-auto">{busy ? "生成中..." : images.length ? "🎨 再生成する" : "🎨 画像を生成する"}</button>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {concept.stamps.map((stamp, index) => {
                const img = images[index] || { status: "waiting", src: "", error: "" };
                return <div key={stamp.id} className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
                  <div className="flex aspect-[370/320] items-center justify-center bg-neutral-950 p-2">
                    {img.src ? <img src={img.src} alt={stamp.label} className="h-full w-full object-contain" /> : <span className="text-xs text-neutral-500">{img.status === "generating" ? "生成中..." : img.status === "error" ? "失敗" : "待機中"}</span>}
                  </div>
                  <div className="space-y-2 p-3">
                    <p className="truncate text-sm font-bold">{stamp.label}</p>
                    <p className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${img.status === "done" ? "bg-emerald-950 text-[#06C755]" : img.status === "error" ? "bg-red-950 text-red-300" : "bg-neutral-800 text-neutral-400"}`}>{img.status.toUpperCase()}</p>
                    {img.src && <button onClick={() => downloadDataUrl(img.src, `stamp-${String(index + 1).padStart(2, "0")}.png`)} className="block w-full rounded-lg border border-neutral-700 py-2 text-xs text-neutral-200">保存</button>}
                  </div>
                </div>;
              })}
            </div>
            {images.some((img) => img.status === "done") && <button onClick={() => goToStep(4)} className="w-full rounded-2xl bg-[#00e5a0] px-5 py-4 font-black text-black sm:w-auto">次へ：申請チェック</button>}
          </section>
        )}

        {step === 4 && (
          <section className="space-y-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00e5a0]">Step 05</p>
            <h2 className="text-2xl font-black">申請前チェック</h2>
            <p className="text-sm text-neutral-500">{doneChecks} / {checkItems.length} 完了</p>
            <div className="space-y-3">
              {checkItems.map((item, index) => <label key={item.title} className={`flex gap-3 rounded-2xl border p-4 ${checks[index] ? "border-[#06C755] bg-emerald-950/20" : "border-neutral-800 bg-neutral-900"}`}>
                <input type="checkbox" checked={Boolean(checks[index])} onChange={(e) => setChecks((prev) => ({ ...prev, [index]: e.target.checked }))} className="mt-1 h-5 w-5 accent-[#00e5a0]" />
                <span><strong className="block text-sm">{item.title}</strong><span className="text-xs leading-6 text-neutral-500">{item.desc}</span></span>
              </label>)}
            </div>
            <button disabled={doneChecks < checkItems.length} onClick={() => goToStep(5)} className="w-full rounded-2xl bg-[#00e5a0] px-5 py-4 font-black text-black disabled:opacity-40 sm:w-auto">次へ：申請ガイド</button>
          </section>
        )}

        {step === 5 && (
          <section className="space-y-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00e5a0]">Step 06</p>
            <h2 className="text-2xl font-black">LINE Creators Market 申請手順</h2>
            <div className="space-y-4">
              {creatorSteps.map(([title, desc], index) => <div key={title} className="flex gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[#00e5a0] text-sm font-black text-[#00e5a0]">{index + 1}</div>
                <div><h3 className="font-bold">{title}</h3><p className="mt-1 text-sm leading-7 text-neutral-500">{desc}</p></div>
              </div>)}
            </div>
            <a href="https://creator.line.me/" target="_blank" rel="noreferrer" className="inline-flex w-full justify-center rounded-2xl bg-[#06C755] px-5 py-4 font-black text-white sm:w-auto">LINE Creators Marketを開く</a>
          </section>
        )}
      </main>
    </div>
  );
}
