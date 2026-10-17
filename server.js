const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, 'config.json');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
// serve static files (frontend)
app.use(express.static(path.join(__dirname)));

function readConfig(){
  try {
    const txt = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(txt);
  } catch(e){
    return {};
  }
}
function writeConfig(obj){
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), {mode:0o600});
}

app.post('/api/save-key', (req, res) => {
  const { key, provider } = req.body;
  if (!key) return res.status(400).json({ error: 'Missing key' });
  const cfg = readConfig();
  cfg.key = key;
  cfg.provider = provider || 'gemini';
  writeConfig(cfg);
  return res.json({ ok: true });
});

app.get('/api/has-key', (req, res) => {
  const cfg = readConfig();
  return res.json({ hasKey: !!cfg.key, provider: cfg.provider || null });
});

app.post('/api/find-subtitles', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const text = await fetchUrlText(url);
    const subs = findSubtitleUrls(text, url);
    return res.json({ subtitles: subs });
  } catch (e) {
    console.error('find-subtitles error', e);
    return res.status(500).json({ error: 'Failed to fetch page' });
  }
});

app.post('/api/fetch-text', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const text = await fetchUrlText(url);
    return res.json({ text });
  } catch (e) {
    console.error('fetch-text error', e);
    return res.status(500).json({ error: 'Failed to fetch resource' });
  }
});

app.post('/api/summarize', async (req, res) => {
  const { convoText, lastSpeaker } = req.body;
  if (!convoText) return res.status(400).json({ error: 'Missing convoText' });
  const cfg = readConfig();
  if (!cfg.key) return res.status(400).json({ error: 'No API key configured on server' });
  try {
    const prompt = `You are given transcript text from subtitles of a TV anime. Only summarise what happened in the conversation BEFORE the provided timestamp. Do not reveal anything after the timestamp. Provide a short one-sentence summary, a short topic label, and confirm who was speaking immediately before the timestamp. Conversation:\n\n"""${convoText}\n"""\nReturn JSON with keys: summary, topic, speakerBefore.`;
    const model = 'text-bison-001';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta2/models/${model}:generateText?key=${cfg.key}`;
    const body = { prompt: { text: prompt }, maxOutputTokens: 250 };

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('LLM error', r.status, txt);
      return res.status(502).json({ error: 'LLM request failed', details: txt });
    }
    const j = await r.json();
    const output = (j?.candidates && j.candidates[0] && j.candidates[0].content) || j?.outputText || JSON.stringify(j);
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return res.json({ summary: parsed.summary||output, topic: parsed.topic||'', speakerBefore: parsed.speakerBefore||lastSpeaker });
    }
    return res.json({ summary: output, topic: '', speakerBefore: lastSpeaker });
  } catch (e) {
    console.error('summarize error', e);
    return res.status(500).json({ error: 'Summarization failed' });
  }
});

async function fetchUrlText(url){
  // Basic server-side fetch. Allow http(s)
  const safeUrl = url;
  const res = await fetch(safeUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  return await res.text();
}

function findSubtitleUrls(html, baseUrl){
  const out = [];
  try{
    const trackRe = /<track[^>]+src=["']([^"']+\.(vtt|srt))["'][^>]*>/ig;
    let m;
    while((m = trackRe.exec(html))){ out.push(resolveUrl(m[1], baseUrl)); }
    const linkRe = /href=["']([^"']+\.(vtt|srt))["']/ig;
    while((m = linkRe.exec(html))){ out.push(resolveUrl(m[1], baseUrl)); }
    const srtRe = /(https?:\\/\\/[^"'\\s]+\.(vtt|srt))/ig;
    while((m = srtRe.exec(html))){ out.push(m[1]); }
  } catch(e){ console.warn(e); }
  return [...new Set(out)];
}
function resolveUrl(u, base){ try { return new URL(u, base).href; } catch(e){ return u; } }

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
