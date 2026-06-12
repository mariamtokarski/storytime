# Story Time — collaborative story estimation (Firebase edition)

A real-time, multiplayer planning-poker game. Players log in with an email,
get a username from their email prefix, then join or create a game and vote on
Fibonacci points (1, 3, 5, 8, 13, 21) for each "level." Votes stay hidden until
the creator reveals them into swimlanes; the fullest lane wins. Game data is
stored live and erased when the creator presses **Game over**.

This version runs entirely on **Firebase** — Firebase Hosting serves the site,
and Realtime Database powers the live multiplayer. One project, no other
services needed.

---

## What's in here

```
firebase.json          → hosting + database rules config
.firebaserc            → your project name goes here
database.rules.json    → security rules (already written for this app)
public/                → the site itself (this is what gets deployed)
  index.html
  styles.css
  app.js
  config.js            → paste your Firebase keys here
```

---

## Deploy — two ways

### Option A: Firebase Console only (no command line) — easiest

1. **Create a project**
   Go to https://console.firebase.google.com → **Add project** → name it
   (e.g. "story-time"). You can skip Google Analytics.

2. **Turn on the database**
   Left menu: **Build → Realtime Database → Create Database** → pick a location
   → **Start in test mode** → Enable.
   (You'll lock it down with the included rules in step 6.)

3. **Turn on anonymous sign-in**
   **Build → Authentication → Get started → Sign-in method** tab →
   click **Anonymous** → toggle **Enable** → Save.

4. **Get your web config**
   Gear icon (top-left) → **Project settings** → scroll to **Your apps** →
   click the web icon **`</>`** → register an app (any nickname) → it shows a
   `firebaseConfig` object.

   In this repo, copy the template first, then fill it in:
   ```bash
   cp public/config.example.js public/config.js
   ```
   Open **`public/config.js`** and replace each `PASTE_...` placeholder with
   your values. (`config.js` is gitignored so your keys never get committed —
   `config.example.js` is the safe, checked-in template.)

5. **Deploy the site**
   Still in **Hosting** (Build → Hosting → Get started), the console will walk
   you through it — but the no-CLI path is to use Option B below, OR simply host
   the `public/` folder anywhere static. For a true Firebase Hosting deploy you
   do need the CLI once (Option B). It takes two commands.

6. **Apply the database rules**
   **Build → Realtime Database → Rules** tab → paste the contents of
   `database.rules.json` → **Publish**. This replaces test-mode with rules that
   require sign-in and protect each player's own votes.

### Option B: Firebase CLI — the real one-command deploy (recommended)

You need Node.js installed (https://nodejs.org). Then, from inside this folder:

```bash
# 1. Install the CLI (once)
npm install -g firebase-tools

# 2. Sign in (opens a browser)
firebase login

# 3. Put your project name in .firebaserc
#    (replace PASTE_PROJECT_ID with the Project ID from the Firebase console —
#     Project settings shows it; it's the lowercase one, e.g. "story-time-4f2a")

# 4. Deploy hosting + database rules together
firebase deploy
```

That prints your live URL, e.g. `https://story-time-4f2a.web.app`.

You still need steps 1–4 and the database/auth toggles from Option A done in the
console first (create project, enable Realtime Database, enable Anonymous auth,
and paste your keys into `public/config.js`).

---

## How it plays (matches the spec)

- **Login** with email → username is the part before the `@`.
- **Lobby**: anyone can join a listed game or create one (name max 20 chars).
- **Creator** opens each level by naming it, which opens voting on
  1 / 3 / 5 / 8 / 13 / 21.
- When you vote, your icon gets a **checkmark** but your number stays hidden.
- Creator hits **Reveal** → every voter's icon swims into a **lane** grouped by
  the number they chose. The lane with the most votes is **crowned** and saved
  as that level's winning number.
- Votes can still change until the creator hits **Next level** or **End game**.
- **End game** shows a 3-column table (level #, title, winning points) and lets
  the creator **email it to their login address**.
- **Game over** erases all data for that game.

## Notes

- The Fibonacci deck makes this exactly **planning poker** — the estimation
  game agile teams use to size work — so it doubles as a real sprint tool.
- Free tier (Spark plan) is plenty for this. No billing required.
- To change the email export from "open my mail app" to "send automatically,"
  that needs a small Cloud Function — ask and I'll add it.
