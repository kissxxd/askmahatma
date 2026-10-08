// AskMahatma backend (Vercel serverless function)
// Ye file "kitchen" hai: website ka sawal leti hai, Gemini AI ko bhejti hai, jawab wapas deti hai.
// API key yahan code me NAHI likhni. Wo Vercel ke Environment Variables me rahegi.

// Ek model busy ho to agla try hoga (order me)
const MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-lite-latest",
].filter(function (m, i, arr) { return m && arr.indexOf(m) === i; });

// In status codes par agla model try karenge (busy / limit / model nahi mila)
const RETRY_STATUS = [404, 429, 500, 502, 503, 504];

function clip(s, n) {
  return String(s == null ? "" : s).slice(0, n);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "GEMINI_API_KEY set nahi hai" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const message = clip(body.message, 2000).trim();
    if (!message) return res.status(400).json({ error: "Khali message" });

    // Pichli baatein (max 8), Gemini ke format me: role "user" ya "model"
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const contents = history
      .filter((h) => h && typeof h.content === "string" && h.content.trim())
      .map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clip(h.content, 2000) }],
      }));
    contents.push({ role: "user", parts: [{ text: message }] });

    // System prompt + user ki kundli ka data
    const p = body.profile || {};
    const kundli =
      typeof body.kundli === "string" ? body.kundli : body.kundli ? JSON.stringify(body.kundli) : "";
    const systemText =
      clip(body.system, 6000) +
      "\n\nUSER PROFILE: Naam: " + clip(p.name, 80) +
      "; Janm tithi: " + clip(p.dob, 20) +
      "; Janm samay: " + clip(p.tob, 20) +
      "; Janm sthan: " + clip(p.pob, 120) +
      "; Bhasha: " + clip(p.language, 40) +
      "\n\nKUNDLI DATA (asli ganit se): " +
      (kundli ? clip(kundli, 4000) : "UPLABDH NAHI - user ne janm vivaran poora nahi diya.") +
      "\n\nAaj ki date: " + new Date().toISOString().slice(0, 10);

    const reqBody = JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });

    let data = {};
    let lastStatus = 0;
    let lastMsg = "";
    let ok = false;

    for (const model of MODELS.slice(0, 4)) {
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 12000);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: reqBody,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        data = await r.json().catch(function () { return {}; });
        lastStatus = r.status;
        lastMsg = (data.error && data.error.message) || "";
        if (r.ok) { ok = true; break; }
        console.error("Gemini error (" + model + "):", r.status, JSON.stringify(data).slice(0, 300));
        if (RETRY_STATUS.indexOf(r.status) === -1) break; // key galat jaisi dikkat: aage try bekaar
      } catch (err) {
        clearTimeout(timer);
        lastMsg = "timeout/network (" + model + ")";
        console.error("Fetch failed (" + model + "):", err && err.message);
      }
    }

    if (!ok) {
      if (lastStatus === 429) return res.status(429).json({ error: "rate_limited" });
      return res.status(502).json({ error: lastMsg || "AI abhi busy hai, thodi der baad try karo" });
    }

    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map((x) => x.text || "").join("").trim();

    if (!text) {
      console.error("Empty reply:", JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: "Khali jawab aaya" });
    }

    return res.status(200).json({ text });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Server error" });
  }
};
