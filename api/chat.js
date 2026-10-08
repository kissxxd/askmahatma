// AskMahatma backend (Vercel serverless function)
// Ye file "kitchen" hai: website ka sawal leti hai, Gemini AI ko bhejti hai, jawab wapas deti hai.
// API key yahan code me NAHI likhni. Wo Vercel ke Environment Variables me rahegi.

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

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

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent";

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (r.status === 429) {
      return res.status(429).json({ error: "rate_limited" });
    }
    if (!r.ok) {
      console.error("Gemini error:", r.status, JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: (data.error && data.error.message) || "AI error" });
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
