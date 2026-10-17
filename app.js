// app.js — subtitle extractor + conversation finder prototype
// Behavior:
// - Ask once for an API key (Gemini) and store in localStorage
// - Accept URL or subtitle file; try to fetch subtitles
// - Given a timestamp, find conversation start before that timestamp using heuristics
// - Detect speakers via patterns and summarise locally or via LLM (if API key present)

const $ = id => document.getElementById(id);

const STATE = {
  apiKey: localStorage.getItem('gemini_api_key') || '',
  provider: localStorage.getItem('provider') || 'gemini'
}

// UI elements
const apiKeyInput = $('api-key');
const providerSelect = $('provider-select');
const saveKeyBtn = $('save-key');
const clearKeyBtn = $('clear-key');
const urlInput = $('url-input');
const timestampInput = $('timestamp-input');
const loadBtn = $('load-episode');
const fileInput = $('file-input');
const pasteBtn = $('paste-subtitles');
const resultsCard = $('results');
const overlay = $('overlay-screen');
const bigInfo = $('big-info');
const charactersList = $('characters-list');
const importanceLabel = $('importance-label');
const convSummary = $('conversation-summary');
const convMeta = $('conversation-meta');
const downloadJsonBtn = $('download-json');

// Init
apiKeyInput.value = STATE.apiKey;
providerSelect.value = STATE.provider;

saveKeyBtn.onclick = () => {
  const key = apiKeyInput.value.trim();
  const provider = providerSelect.value;
  STATE.apiKey = key;
  STATE.provider = provider;
  localStorage.setItem('gemini_api_key', key);
  localStorage.setItem('provider', provider);
  alert('Saved API key and provider (stored locally)');
}
clearKeyBtn.onclick = () => {
  localStorage.removeItem('gemini_api_key');
  STATE.apiKey = '';
  apiKeyInput.value = '';
  alert('Cleared saved API key');
}

pasteBtn.onclick = async () => {
  const pasted = prompt('Paste the full subtitle text (.vtt or .srt):');
  if (pasted) {
    processSubtitlesText(pasted);
  }
}

fileInput.onchange = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const text = await file.text();
  processSubtitlesText(text);
}

loadBtn.onclick = async () => {
  const url = urlInput.value.trim();
  const ts = timestampInput.value.trim();
  if (!ts) return alert('Please enter a timestamp (one only)');
  // parse timestamp
  const seconds = parseTimestampToSeconds(ts);
  if (isNaN(seconds)) return alert('Could not parse timestamp. Use mm:ss, hh:mm:ss or seconds.');

  if (fileInput.files.length > 0) {
    const text = await fileInput.files[0].text();
    return processSubtitlesText(text, seconds);
  }

  if (!url) return alert('Please paste a URL or upload/paste subtitle file.');

  // try to fetch the page and look for subtitle links
  try {
    showLoadingOverlay('Fetching page and searching for subtitles...');
    const html = await tryFetchPage(url);
    const subs = findSubtitleUrls(html, url);
    if (subs.length) {
      // pick first
      const subUrl = subs[0];
      hideLoadingOverlay();
      showLoadingOverlay('Fetching subtitle file...');
      const subText = await fetchText(subUrl);
      hideLoadingOverlay();
      return processSubtitlesText(subText, seconds);
    } else {
      hideLoadingOverlay();
      const ok = confirm('No subtitle file URL detected on the page or CORS blocked. Would you like to paste subtitle text manually?');
      if (ok) return pasteBtn.onclick();
    }
  } catch (err) {
    hideLoadingOverlay();
    console.error(err);
    alert('Could not fetch the page due to CORS or network error. Please upload or paste the subtitle file instead.');
  }
}

// Helpers
function parseTimestampToSeconds(ts) {
  // accepts seconds or mm:ss or hh:mm:ss
  if (/^\d+$/.test(ts)) return parseInt(ts,10);
  const parts = ts.split(':').map(p=>p.trim()).filter(Boolean).map(Number);
  if (parts.some(isNaN)) return NaN;
  if (parts.length===2) return parts[0]*60+parts[1];
  if (parts.length===3) return parts[0]*3600+parts[1]*60+parts[2];
  return NaN;
}

async function tryFetchPage(url){
  // Try direct fetch first
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network response not ok');
    return await res.text();
  } catch (err) {
    // try Jina r.jina.ai proxy (best-effort) to bypass CORS
    try {
      const proxy = 'https://r.jina.ai/http://' + url.replace(/^https?:\/\//,'');
      const res = await fetch(proxy);
      if (!res.ok) throw new Error('Proxy fetch failed');
      return await res.text();
    } catch (e) {
      throw e;
    }
  }
}

function findSubtitleUrls(html, baseUrl) {
  const out = [];
  try{
    // find <track src="...vtt">
    const trackRe = /<track[^>]+src=["']([^"']+\.(vtt|srt))["'][^>]*>/ig;
    let m;
    while((m = trackRe.exec(html))){
      out.push(resolveUrl(m[1], baseUrl));
    }
    // find direct links to .vtt/.srt
    const linkRe = /href=["']([^"']+\.(vtt|srt))["']/ig;
    while((m = linkRe.exec(html))){
      out.push(resolveUrl(m[1], baseUrl));
    }
    // look for json with subtitle urls (simple heuristics)
    const srtRe = /(https?:\\/\\/[^"'\\s]+\.(vtt|srt))/ig;
    while((m = srtRe.exec(html))){
      out.push(m[1]);
    }
  } catch(e){console.warn(e)}
  // dedupe
  return [...new Set(out)];
}

function resolveUrl(u, base){
  try { return new URL(u, base).href; } catch(e){ return u; }
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch subtitle file');
  return await res.text();
}

function showLoadingOverlay(message){
  resultsCard.classList.remove('hidden');
  overlay.classList.remove('hidden');
  bigInfo.textContent = message;
}
function hideLoadingOverlay(){
  overlay.classList.add('hidden');
}

// Subtitle parsing (basic .vtt and .srt)
function parseVTT(text){
  // naive parser: split by blank lines and parse timestamps
  const cues = [];
  const lines = text.replace(/\r/g,'').split('\n');
  let i=0;
  while(i<lines.length){
    let line = lines[i].trim();
    if (!line){ i++; continue; }
    // skip optional cue id
    let id=null;
    if (!line.match(/-->|^WEBVTT/)){
      id=line; i++; line=lines[i].trim();
    }
    if (!line.includes('-->')){ i++; continue; }
    const times = line.split('-->').map(s=>s.trim());
    const start = parseVttTime(times[0]);
    const end = parseVttTime(times[1]);
    i++;
    const textLines=[];
    while(i<lines.length && lines[i].trim()!==''){
      textLines.push(lines[i]); i++;
    }
    cues.push({id,start,end,text:textLines.join('\n')});
  }
  return cues;
}
function parseSRT(text){
  const cues=[];
  const blocks = text.replace(/\r/g,'').split('\n\n');
  for(const b of blocks){
    const lines = b.trim().split('\n').filter(Boolean);
    if (lines.length<2) continue;
    // first line may be index
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx=1;
    const timeLine = lines[idx];
    if (!timeLine.includes('-->')) continue;
    const [startt, endt] = timeLine.split('-->').map(s=>s.trim());
    const start = parseVttTime(startt);
    const end = parseVttTime(endt);
    const textLines = lines.slice(idx+1);
    cues.push({start,end,text:textLines.join('\n')});
  }
  return cues;
}
function parseVttTime(t){
  // formats: hh:mm:ss.mmm or mm:ss.mmm or mm:ss
  const parts = t.split(':').map(x=>x.trim());
  if (parts.length===3){
    const h=Number(parts[0]);
    const m=Number(parts[1]);
    const s=parseFloat(parts[2].replace(',', '.'));
    return h*3600+m*60+s;
  }
  if (parts.length===2){
    const m=Number(parts[0]);
    const s=parseFloat(parts[1].replace(',', '.'));
    return m*60+s;
  }
  return parseFloat(t);
}

async function processSubtitlesText(text, timestampSeconds=null){
  // detect format
  let cues = [];
  if (/^WEBVTT/m.test(text)) cues = parseVTT(text);
  else if (/-->/.test(text)) cues = parseVTT(text); // try vtt
  else cues = parseSRT(text);

  if (!cues.length) return alert('No cues parsed from the subtitle text');
  resultsCard.classList.remove('hidden');

  // if timestamp not provided, ask
  if (timestampSeconds==null){
    const ts = prompt('Enter the timestamp (mm:ss or seconds) — only one');
    timestampSeconds = parseTimestampToSeconds(ts);
    if (isNaN(timestampSeconds)) return alert('Could not parse timestamp');
  }

  // find the cue index at or before timestamp
  let idx = cues.findIndex(c => c.start <= timestampSeconds && c.end >= timestampSeconds);
  if (idx===-1){
    idx = cues.findIndex(c => c.end >= timestampSeconds);
    if (idx===-1) idx = cues.length-1;
  }

  // find conversation start: go backwards up to N cues until we detect a speaker change or a 30s window
  const windowSeconds = 30;
  let startIdx = idx;
  const names = new Set();
  function detectSpeaker(text){
    // patterns: <v Name>..., Name: ..., - Name: ...
    const vmatch = text.match(/<v(\s+([^>]+))?>\s*([^<]+)/i);
    if (vmatch) return vmatch[2] ? vmatch[2].trim() : vmatch[3].trim();
    const colon = text.match(/^\s*([A-Z][a-zA-Z0-9_\- ]{1,30}):\s*/m);
    if (colon) return colon[1].trim();
    const dash = text.match(/^\s*-\s*([A-Z][A-Za-z0-9_\- ]+):/);
    if (dash) return dash[1].trim();
    return null;
  }

  // collect names and step back
  let cutoffTime = cues[idx].start - windowSeconds;
  for(let i=idx;i>=0;i--){
    if (cues[i].start < cutoffTime) { startIdx = i+1; break; }
    const s = detectSpeaker(cues[i].text);
    if (s) names.add(s);
    startIdx = i;
  }

  // if we couldn't detect speakers, do a simpler segmentation: look back up to 10 cues
  if (!names.size){
    startIdx = Math.max(0, idx-9);
    for(let i=startIdx;i<=idx;i++){
      const w = cues[i].text.split('\n').map(l=>l.trim()).filter(Boolean);
      for(const line of w){
        const colon = line.match(/^([A-Z][A-Za-z0-9_\- ]{1,30}):\s*/);
        if (colon) names.add(colon[1]);
      }
    }
  }

  // build conversation block text from startIdx..idx (inclusive)
  const convoCues = cues.slice(startIdx, idx+1);
  const convoText = convoCues.map(c=>c.text).join('\n');

  // detect who was talking right before the timestamp: last speaker in convoCues
  let lastSpeaker = null;
  for(let i=convoCues.length-1;i>=0;i--){
    const s = detectSpeaker(convoCues[i].text);
    if (s){ lastSpeaker = s; break; }
  }

  // build character pills
  charactersList.innerHTML = '';
  const namesArr = [...names];
  if (namesArr.length===0) namesArr.push('Unknown');
  namesArr.forEach(n=>{
    const d = document.createElement('div'); d.className='char-pill'; d.textContent=n; charactersList.appendChild(d);
  });

  // compute importance heuristic
  const importanceScore = computeImportance(convoText);
  const importanceLabelText = mapImportanceScoreToLabel(importanceScore);
  importanceLabel.textContent = importanceLabelText;

  // show loading big screen for 3 seconds then show info
  overlay.classList.remove('hidden');
  bigInfo.innerHTML = `Loading...`;
  resultsCard.scrollIntoView({behavior:'smooth'});
  await sleep(3000);

  // show which characters were talking about and then produce summary
  bigInfo.innerHTML = `Characters: ${namesArr.join(', ')}`;

  await sleep(900); // small pause
  // now summarise (try remote LLM if available)
  let summaryRes = null;
  try{
    if (STATE.apiKey && STATE.provider==='gemini'){
      summaryRes = await callGeminiSummarize(STATE.apiKey, convoText, lastSpeaker, importanceScore);
    }
  } catch(e){
    console.warn('LLM call failed, falling back to local summarizer', e);
  }
  if (!summaryRes){
    summaryRes = localSummarize(convoText, lastSpeaker);
  }

  // populate UI
  convMeta.innerHTML = `<strong>Starting point:</strong> ${formatTime(cues[startIdx].start)} — <strong>Ending (timestamp):</strong> ${formatTime(timestampSeconds)}<br><strong>Who was speaking before timestamp:</strong> ${lastSpeaker||'Unknown'}`;
  convSummary.innerHTML = `<p><strong>Summary:</strong> ${escapeHtml(summaryRes.summary)}</p><p><strong>What they were talking about (short):</strong> ${escapeHtml(summaryRes.topic)}</p>`;
  hideLoadingOverlay();

  // prepare JSON download
  const out = {characters:namesArr, importance:importanceLabelText, start: cues[startIdx].start, timestamp:timestampSeconds, summary:summaryRes};
  downloadJsonBtn.onclick = ()=>{
    const blob = new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='conversation.json'; a.click();
    URL.revokeObjectURL(url);
  }
}

function computeImportance(text){
  // heuristic: count unique capitalized words, length, and presence of "strong" words
  const strong = ['kill','death','confess','love','marry','die','secret','reveal','attack','suicide','betray'];
  const txt = text.toLowerCase();
  let score = 0;
  const words = txt.split(/[^a-zA-Z]+/).filter(Boolean);
  score += Math.min(10, Math.floor(words.length/20));
  for(const w of strong) if (txt.includes(w)) score+=3;
  // named entities approx
  const caps = (text.match(/\b[A-Z][a-z]{1,}\b/g)||[]);
  score += Math.min(8, new Set(caps).size);
  return score; // higher is more important
}
function mapImportanceScoreToLabel(s){
  if (s<=2) return 'LOW';
  if (s<=5) return 'NORMAL';
  if (s<=10) return 'HIGH';
  return 'INSANELY HIGH';
}

function formatTime(sec){
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  const m = Math.floor((sec/60)%60).toString().padStart(2,'0');
  const h = Math.floor(sec/3600).toString();
  if (h==='0') return `${m}:${s}`;
  return `${h}:${m}:${s}`;
}
function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Local summarizer (very simple): extract top three sentences by word frequency
function localSummarize(text, lastSpeaker){
  const clean = text.replace(/<[^>]+>/g,'').replace(/\n/g,'. ');
  const sentences = clean.split(/(?<=[\.\!\?])\s+/).filter(Boolean);
  const freq = {};
  const words = clean.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for(const w of words){ if (w.length<3) continue; freq[w]=(freq[w]||0)+1; }
  const sentScore = sentences.map(s=>({s,score: s.toLowerCase().split(/[^a-z]+/).reduce((a,w)=>a+(freq[w]||0),0)}));
  sentScore.sort((a,b)=>b.score-a.score);
  const top = sentScore.slice(0,3).map(x=>x.s).join(' ');
  // topic: top frequent words
  const topicWords = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
  return {summary: top || sentences.slice(0,2).join(' '), topic: topicWords.join(', '), speakerBefore: lastSpeaker};
}

// LLM call (best-effort to Google Generative API). This will likely need CORS server or proper API setup.
async function callGeminiSummarize(apiKey, convoText, lastSpeaker, importanceScore){
  try{
    // Build a prompt instructing summarization and to produce: summary, topic, speakerBefore, importance
    const prompt = `You are given transcript text from subtitles of a TV anime. Only summarise what happened in the conversation BEFORE the provided timestamp. Do not reveal anything after the timestamp. Provide a short one-sentence summary, a short topic label, and confirm who was speaking immediately before the timestamp. Conversation:\n\n"""${convoText}\n"""\nReturn JSON with keys: summary, topic, speakerBefore.`;

    // NOTE: This is a best-effort call to Google's Generative API. It may require different endpoints or OAuth.
    const model = 'text-bison-001';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta2/models/${model}:generateText?key=${apiKey}`;
    const body = {"prompt":{"text":prompt},"maxOutputTokens":250};

    const res = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if (!res.ok) throw new Error('LLM request failed: '+res.status);
    const j = await res.json();
    const output = (j?.candidates && j.candidates[0] && j.candidates[0].content) || j?.outputText || JSON.stringify(j);
    // try to parse JSON out of output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {summary: parsed.summary||output, topic: parsed.topic||'', speakerBefore: parsed.speakerBefore||lastSpeaker};
    }
    // fallback: return textual answer as summary
    return {summary: output, topic:'', speakerBefore:lastSpeaker};
  } catch(e){
    console.warn('Gemini call failed', e);
    return null;
  }
}

// Simple HTML text extractor if needed: not used here but kept for reference
function extractTextFromHtml(html){
  const div = document.createElement('div'); div.innerHTML = html; return div.innerText;
}
