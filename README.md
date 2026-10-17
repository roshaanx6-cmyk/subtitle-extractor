# subtitle-extractor

Prototype single-page web app that attempts to extract subtitles from a given page or uploaded file, finds a conversation window before a user-specified timestamp, detects speakers heuristically, and summarizes the conversation. It stores a provided Gemini API key in localStorage for optional LLM summarization.

Features
- Prompt once for a Gemini API key and provider (stored locally)
- Accept a page URL and attempt to detect .vtt/.srt subtitle URLs (best-effort)
- Upload or paste subtitle text (.vtt/.srt) when CORS prevents fetching
- Heuristically detect speakers (looks for `<v Name>`, `Name:`, `- Name:` patterns)
- Find a conversation start point before the given timestamp and summarize only the part before the timestamp
- Show a 3-second loading overlay and then display detected characters and a computed "CONVERSATION IMPORTANCE" label

Limitations
- Fetching remote pages or subtitle files may be blocked by CORS; use the paste/upload option if that happens
- The Gemini API call in the app is a best-effort example and may require server-side proxying or different auth (Google often requires API keys or OAuth in specific formats)
- Speaker detection and summarization are heuristic; for more accurate results provide properly formatted subtitle files or integrate server-side processing.

Usage
1. Open index.html in a browser (serve it using a static server for best results).
2. Paste your Gemini API key once (optional). If you skip, the local summarizer will be used.
3. Provide a watch page URL or upload/paste subtitle file.
4. Enter a single timestamp (mm:ss or seconds) and click "Load episode".
5. The app will show characters, an importance label, and a short summary of the conversation before the timestamp.

If you'd like, I can:
- add server-side code to fetch pages and proxy the Gemini request (to avoid CORS issues),
- integrate with a specific Gemini endpoint you have access to, or
- improve speaker detection for your subtitle style (share a sample subtitle file).
