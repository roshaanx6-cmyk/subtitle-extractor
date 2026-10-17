Updated README: server and deployment instructions

Server added to proxy page/subtitle fetches and make Gemini (Generative Language) calls from the server to avoid CORS and keep your API key off the browser.

How to run locally (prototype)
1. Clone the repo.
2. Install dependencies: npm install
3. Start the server: npm start
4. Open http://localhost:3000/index.html in your browser.

What changed
- server.js: Express server that exposes:
  - POST /api/save-key  -> save Gemini API key on the server (prototype, saved to config.json)
  - GET /api/has-key    -> check whether the server has a key saved
  - POST /api/find-subtitles -> server fetches the page HTML and returns subtitle URLs detected
  - POST /api/fetch-text -> server fetches arbitrary URL text (used to fetch .vtt/.srt)
  - POST /api/summarize -> server calls Google's Generative Language API (text-bison-001) using the stored key and returns JSON summarization
- Front-end (index.html + app.js): now calls the server endpoints instead of trying to fetch remote pages or calling Gemini directly from the browser.

Security & notes
- config.json is listed in .gitignore — the server saves the API key there for convenience in this prototype. This is NOT production-secure. For production, store secrets in environment variables or a secrets manager.
- The server uses the public Generative Language API endpoint with the API key; depending on your Google Cloud setup you may need to enable the API and ensure the API key has permissions.
- If you prefer the key to never be uploaded to a server, you can still use the app by pasting the subtitle text and using the local summarizer.

Next steps I can implement for you
- Persist keys securely with an authentication layer so multiple users can safely store their keys.
- Deploy the app + server to Vercel/Render/Heroku and wire environment secrets so the key is never stored in a file.
- Improve the Gemini prompt and response parsing for more reliable JSON output.

