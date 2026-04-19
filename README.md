# AI Brand Position Tracker

Track where your brand appears in ChatGPT's responses to any prompt, and log every run in a local database.

## What it does

1. You log in with a password (`Brandtracker2026` by default).
2. You enter a **Brand name** and a **Prompt** (e.g. `"What are the best 10 platforms for creating AI videos?"`).
3. Click **Track Position**. The app sends the prompt to the OpenAI Chat Completions API.
4. Click **See Results** to see ChatGPT's full response with your brand highlighted, plus the detected position (1st mention, 2nd, etc. — or the number in ChatGPT's own ranked list when it returns one).
5. Every run is saved to a local SQLite database and shown in the **Tracking Log** below the form.

---

## Running it locally (fastest way to see it live)

You need Node.js 18 or newer installed. Get it from https://nodejs.org if you don't have it.

```bash
# 1. Unzip the project and open a terminal inside the folder
cd brand-tracker

# 2. Install dependencies
npm install

# 3. Set up your API key
cp .env.example .env
# Then open .env in any text editor and paste your OpenAI API key after OPENAI_API_KEY=

# 4. Start the server
npm start
```

Then open your browser to:

```
http://localhost:3000
```

You'll see the login page. Enter `Brandtracker2026` and you're in.

---

## How the "position" is detected

- If ChatGPT returns a **numbered list** (`1. ... 2. ... 3. ...`), the position is the item number that contains your brand.
- If not, the app falls back to the **order of first mention** in the response text.
- If the brand isn't mentioned at all, it's logged as `Not found`.

The system prompt asks the model to return a numbered list whenever a ranking is requested, so numbered detection works in the vast majority of cases.

---

## Deploying it online so others can access it

This is a standard Node.js + Express app. Any of these work:

### Option A — Render.com (easiest, free tier available)
1. Push the project folder to a GitHub repo.
2. Go to https://render.com, create a new **Web Service**, and connect the repo.
3. Build command: `npm install` — Start command: `npm start`
4. Add your environment variables in the Render dashboard:
   - `OPENAI_API_KEY` = your key
   - `ACCESS_PASSWORD` = `Brandtracker2026` (or something stronger)
   - `SESSION_SECRET` = any long random string
5. Deploy. You'll get a public URL like `https://brand-tracker.onrender.com`.

> Note: Render's free tier has an ephemeral filesystem, so the SQLite database will reset when the service restarts. For persistent history, add a Render Disk or switch to Postgres.

### Option B — Railway.app
Same idea as Render. Push to GitHub, connect repo, set env vars, deploy.

### Option C — Your own VPS (DigitalOcean, Hetzner, etc.)
SSH in, clone the repo, `npm install`, set env vars, run behind PM2 or systemd + Nginx.

---

## Files

```
brand-tracker/
├── server.js           ← Express backend, OpenAI call, SQLite, position logic
├── package.json        ← Dependencies
├── .env.example        ← Copy to .env and fill in your API key
├── public/
│   ├── login.html      ← Password-gated login page
│   └── app.html        ← The main tracker UI
└── tracker.db          ← Created automatically on first run
```

## Changing the model

By default the app uses `gpt-4o-mini` (cheap, fast). Change it in `.env`:

```
OPENAI_MODEL=gpt-4o
```

## Security note

The password and API key live in `.env`. Never commit that file. The `.gitignore` already excludes it. If you deploy publicly, also change `SESSION_SECRET` to a long random string and consider using a stronger password than the default.
