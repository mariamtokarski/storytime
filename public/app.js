/* =========================================================================
   STORY TIME — application logic
   Real-time collaborative story estimation (planning poker).
   ========================================================================= */

const FIB = [1, 3, 5, 8, 13, 21];
const NAME_MAX = 20;

/* ---- color helper: stable color per username ---------------------------- */
const PALETTE = ["#ef6d3b","#f4b740","#4cb8a6","#8a6fb0","#e0698a","#5fb87f","#6d9bd1","#d98b4a"];
function colorFor(str){
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function initialsOf(name){
  const parts = name.replace(/[^a-zA-Z0-9]/g, " ").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---- backend state ------------------------------------------------------ */
let db = null, auth = null, configured = false;
let me = { uid: null, username: null, email: null };
let view = "loading";            // loading | login | lobby | room
let currentGameId = null;
let lobbyRef = null, gameRef = null, presenceRef = null;
let lobbyData = {}, gameData = null;

const app = document.getElementById("app");

/* ---- flame icon (reused) ------------------------------------------------ */
const FLAME = `<svg class="flame" viewBox="0 0 48 48" fill="none"><path d="M24 4c2 7-3 9-6 14-2.6 4.3-4 8-4 12a14 14 0 0 0 28 0c0-5-2.5-8.6-5-12 .5 3-1 5-3 5 1.5-6-2-12-5-12 1 4-2 6-4 9-1.2 1.8-2 3.6-2 5 0-4 2-8 6-11 .8-.6 4-3.4 4-7z" fill="url(#fg)"/><defs><linearGradient id="fg" x1="24" y1="4" x2="24" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#f4b740"/><stop offset="1" stop-color="#ef6d3b"/></linearGradient></defs></svg>`;
const BRAND_FLAME = `<svg viewBox="0 0 48 48" fill="none"><path d="M24 4c2 7-3 9-6 14-2.6 4.3-4 8-4 12a14 14 0 0 0 28 0c0-5-2.5-8.6-5-12 .5 3-1 5-3 5 1.5-6-2-12-5-12 1 4-2 6-4 9-1.2 1.8-2 3.6-2 5 0-4 2-8 6-11 .8-.6 4-3.4 4-7z" fill="url(#bg)"/><defs><linearGradient id="bg" x1="24" y1="4" x2="24" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#f4b740"/><stop offset="1" stop-color="#ef6d3b"/></linearGradient></defs></svg>`;
const CHECK = `<svg viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2 5 8.5 9.5 3.5" stroke="#0c2415" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROWN = `<svg viewBox="0 0 16 16" fill="none"><path d="M2 12h12l1-7-3.5 2.5L8 3 4.5 7.5 1 5z" fill="#3a2400"/></svg>`;

/* =========================================================================
   BOOT
   ========================================================================= */
function boot(){
  const cfg = window.FIREBASE_CONFIG || {};
  configured = cfg.apiKey && !String(cfg.apiKey).startsWith("PASTE_");

  if (!configured){
    view = "login";
    render();
    return;
  }
  try{
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.database();
  }catch(e){
    console.error(e);
    configured = false;
    view = "login";
    render();
    return;
  }

  // Restore a prior session label if present
  const saved = sessionStorage.getItem("storytime_user");
  auth.onAuthStateChanged(user => {
    if (user && saved){
      const s = JSON.parse(saved);
      me = { uid: user.uid, username: s.username, email: s.email };
      enterLobby();
    } else if (!user){
      if (view === "loading"){ view = "login"; render(); }
    }
  });
}

/* =========================================================================
   AUTH / LOGIN
   ========================================================================= */
function usernameFromEmail(email){
  const prefix = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return prefix || "player";
}

async function doLogin(email){
  email = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
    toast("Enter a valid email address");
    return;
  }
  if (!configured){
    toast("Backend not set up yet — see the note above");
    return;
  }
  const btn = document.getElementById("login-btn");
  if (btn){ btn.disabled = true; btn.textContent = "Lighting the fire…"; }

  try{
    const cred = await auth.signInAnonymously();
    const username = usernameFromEmail(email);
    me = { uid: cred.user.uid, username, email };
    sessionStorage.setItem("storytime_user", JSON.stringify({ username, email }));
    enterLobby();
  }catch(e){
    console.error(e);
    toast("Could not sign in: " + (e.code || e.message));
    if (btn){ btn.disabled = false; btn.textContent = "Enter the story room"; }
  }
}

function logout(){
  if (presenceRef) presenceRef.remove().catch(()=>{});
  detachGame();
  if (lobbyRef){ lobbyRef.off(); lobbyRef = null; }
  sessionStorage.removeItem("storytime_user");
  if (auth) auth.signOut().catch(()=>{});
  me = { uid: null, username: null, email: null };
  view = "login";
  render();
}

/* =========================================================================
   LOBBY
   ========================================================================= */
function enterLobby(){
  view = "lobby";
  currentGameId = null;
  detachGame();

  lobbyRef = db.ref("games");
  lobbyRef.on("value", snap => {
    lobbyData = snap.val() || {};
    if (view === "lobby") render();
  });
  render();
}

async function createGame(name){
  name = name.trim().slice(0, NAME_MAX);
  if (!name){ toast("Give your story a name"); return; }

  const ref = db.ref("games").push();
  const id = ref.key;
  const now = Date.now();
  await ref.set({
    name,
    creatorUid: me.uid,
    creatorName: me.username,
    creatorEmail: me.email,
    createdAt: now,
    status: "active",
    levels: {},               // ordered level records
    currentLevel: null,       // { title, revealed }
    levelSeq: 0,
    players: {
      [me.uid]: { username: me.username, color: colorFor(me.username), joinedAt: now }
    },
    votes: {}                 // votes for the *current* level only
  });
  openGame(id);
}

function joinAndOpen(id){
  const g = lobbyData[id];
  if (!g){ toast("That story just ended"); return; }
  openGame(id);
}

/* =========================================================================
   GAME ROOM — attach / detach
   ========================================================================= */
function openGame(id){
  currentGameId = id;
  view = "room";

  // register presence as a player, and auto-remove on disconnect (non-creators)
  const pRef = db.ref(`games/${id}/players/${me.uid}`);
  pRef.update({ username: me.username, color: colorFor(me.username), joinedAt: Date.now() });
  presenceRef = pRef;

  gameRef = db.ref(`games/${id}`);
  gameRef.on("value", snap => {
    gameData = snap.val();
    if (!gameData){
      // game was deleted (creator hit Game Over) → bounce to lobby
      toast("This story has ended");
      enterLobby();
      return;
    }
    // creators keep the room alive; players are removed if they drop off
    if (gameData.creatorUid !== me.uid){
      pRef.onDisconnect().remove();
    } else {
      pRef.onDisconnect().cancel();
    }
    if (view === "room") render();
  });
  render();
}

function detachGame(){
  if (gameRef){ gameRef.off(); gameRef = null; }
  presenceRef = null;
  gameData = null;
}

function leaveToLobby(){
  // a non-creator leaving just removes their presence
  if (currentGameId && gameData && gameData.creatorUid !== me.uid){
    db.ref(`games/${currentGameId}/players/${me.uid}`).remove().catch(()=>{});
  }
  detachGame();
  enterLobby();
}

/* ---- creator actions ---------------------------------------------------- */
function isCreator(){ return gameData && gameData.creatorUid === me.uid; }

async function startLevel(title){
  title = title.trim();
  if (!title){ toast("Name this level first"); return; }
  const seq = (gameData.levelSeq || 0) + 1;
  await gameRef.update({
    levelSeq: seq,
    currentLevel: { number: seq, title, revealed: false },
    votes: {}
  });
}

function castVote(value){
  if (!gameData.currentLevel) return;
  // votes may change freely until the level is closed
  db.ref(`games/${currentGameId}/votes/${me.uid}`).set({ value, username: me.username });
}

function reveal(){
  gameRef.child("currentLevel/revealed").set(true);
}

/* winning number = the value with the most votes.
   Ties break toward the smaller Fibonacci number (conservative estimate). */
function computeWinner(votes){
  const tally = {};
  Object.values(votes || {}).forEach(v => { tally[v.value] = (tally[v.value] || 0) + 1; });
  let best = null, bestCount = 0;
  FIB.forEach(n => {                 // iterate ascending so first max wins the tie
    const c = tally[n] || 0;
    if (c > bestCount){ bestCount = c; best = n; }
  });
  return best;                       // null if no votes
}

async function commitCurrentLevel(){
  const cur = gameData.currentLevel;
  if (!cur) return null;
  const winner = computeWinner(gameData.votes);
  const rec = {
    number: cur.number,
    title: cur.title,
    points: winner,
    order: cur.number
  };
  await db.ref(`games/${currentGameId}/levels/${cur.number}`).set(rec);
  return rec;
}

async function nextLevel(){
  await commitCurrentLevel();
  await gameRef.update({ currentLevel: null, votes: {} });
}

async function endGame(){
  // commit the level in progress (if any) then mark finished + snapshot
  if (gameData.currentLevel) await commitCurrentLevel();
  await gameRef.update({ status: "finished", currentLevel: null });
  // gameData will refresh via listener; final overlay renders from status
}

async function gameOver(){
  // erase all data for this game, return everyone to the lobby
  const id = currentGameId;
  detachGame();
  await db.ref(`games/${id}`).remove();
  enterLobby();
  toast("Story closed and data cleared");
}

/* =========================================================================
   EMAIL EXPORT (creator only)
   ========================================================================= */
function buildEmail(){
  const levels = orderedLevels();
  const lines = levels.map(l =>
    `${String(l.number).padStart(2," ")}.  ${l.title}  —  ${l.points ?? "—"} pts`
  ).join("\n");
  const total = levels.reduce((s, l) => s + (l.points || 0), 0);
  const subject = `Story Time results — ${gameData.name}`;
  const body =
`Story: ${gameData.name}
Led by: ${gameData.creatorName}
Levels estimated: ${levels.length}
Total points: ${total}

#   Level                          Points
${"-".repeat(46)}
${lines}

Generated by Story Time`;
  return { subject, body, to: gameData.creatorEmail };
}

function emailResults(){
  const { subject, body, to } = buildEmail();
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = href;
  const box = document.getElementById("email-confirm");
  if (box){
    box.innerHTML = `${CHECK_GREEN} Opening your mail app to send the results to <b>${esc(to)}</b>`;
    box.style.display = "flex";
  }
}
const CHECK_GREEN = `<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5 6.5 12 13 4.5" stroke="#5fb87f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* =========================================================================
   RENDER ROUTER
   ========================================================================= */
function render(){
  if (view === "loading"){ app.innerHTML = `<div class="spin-wrap"><div class="spinner"></div></div>`; return; }
  if (view === "login"){ app.innerHTML = renderLogin(); wireLogin(); return; }

  let body = "";
  if (view === "lobby") body = renderLobby();
  else if (view === "room") body = renderRoom();

  app.innerHTML = renderTopbar() + `<main><div class="wrap">${body}</div></main>`
    + (view === "room" && gameData && gameData.status === "finished" ? renderFinal() : "");

  if (view === "lobby") wireLobby();
  if (view === "room") wireRoom();
}

/* ---- topbar ------------------------------------------------------------- */
function renderTopbar(){
  return `
  <div class="topbar"><div class="wrap topbar-inner">
    <div class="brand">${BRAND_FLAME} Story<em>Time</em></div>
    <div class="spacer"></div>
    <div class="whoami">
      <div class="avatar" style="background:${colorFor(me.username)}">${initialsOf(me.username)}</div>
      <span>signed in as <b>${esc(me.username)}</b></span>
    </div>
    <button class="link-btn" id="logout-btn">Sign out</button>
  </div></div>`;
}

/* =========================================================================
   LOGIN VIEW
   ========================================================================= */
function renderLogin(){
  const setupBanner = configured ? "" : `
    <div class="setup-note">
      <b>One quick step before you can play.</b><br>
      Story Time needs a free real-time database so every player sees the same game.
      Open <code>config.js</code> and follow the 4 short steps at the top (about 3 minutes).
      Until then, login is disabled.
    </div>`;

  return `
  <div class="login"><div class="login-card card">
    ${FLAME}
    <div class="eyebrow">Collaborative story estimation</div>
    <h1>Story <em>Time</em></h1>
    <p class="sub">Gather your team, size each level together, and watch the votes swim into place.</p>
    ${setupBanner}
    <div class="field">
      <label for="email">Your email</label>
      <input id="email" type="email" inputmode="email" autocomplete="email"
             placeholder="you@studio.com" ${configured ? "" : "disabled"} />
    </div>
    <div class="login-foot" style="text-align:left;margin:-6px 0 18px">
      You'll join as <span class="preview-name" id="name-preview">your-name</span>
    </div>
    <button class="btn lg" id="login-btn" ${configured ? "" : "disabled"}>Enter the story room</button>
    <div class="login-foot">No passwords. Your username is just the part of your email before the @.</div>
  </div></div>`;
}

function wireLogin(){
  const email = document.getElementById("email");
  const preview = document.getElementById("name-preview");
  const btn = document.getElementById("login-btn");
  if (email){
    email.addEventListener("input", () => {
      const v = email.value.trim();
      preview.textContent = v.includes("@") ? usernameFromEmail(v) : (v ? usernameFromEmail(v + "@x.com") : "your-name");
    });
    email.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(email.value); });
  }
  if (btn) btn.addEventListener("click", () => doLogin(email.value));
}

/* =========================================================================
   LOBBY VIEW
   ========================================================================= */
function renderLobby(){
  const ids = Object.keys(lobbyData).filter(id => lobbyData[id] && lobbyData[id].status !== "finished");
  ids.sort((a,b) => (lobbyData[b].createdAt||0) - (lobbyData[a].createdAt||0));

  const tiles = ids.map(id => {
    const g = lobbyData[id];
    const players = Object.values(g.players || {});
    const avatars = players.slice(0,5).map(p =>
      `<div class="mini-av" style="background:${p.color||colorFor(p.username)}">${initialsOf(p.username)}</div>`
    ).join("");
    const more = players.length > 5 ? `<span class="mini-more">+${players.length-5}</span>` : "";
    const levelCount = Object.keys(g.levels || {}).length;
    return `
    <button class="game-tile" data-join="${id}">
      <h3>${esc(g.name)}</h3>
      <div class="tile-meta">
        <span class="dot"></span> Live
        <span>·</span>
        <span>${levelCount} level${levelCount===1?"":"s"}</span>
      </div>
      <div class="tile-players">${avatars||'<span class="mini-more">No one yet</span>'}${more}</div>
      <div class="muted" style="font-size:12.5px">Led by ${esc(g.creatorName)} · tap to join</div>
    </button>`;
  }).join("");

  const list = ids.length ? `<div class="game-grid">${tiles}</div>` : `
    <div class="empty-state">
      <div class="big">No stories around the fire yet</div>
      <p>Be the first to start one. Name your story, then lead your team through sizing each level together.</p>
    </div>`;

  return `
  <div class="lobby-head">
    <div>
      <div class="eyebrow">The lobby</div>
      <h2>Join a story, or start your own</h2>
      <p>Anyone can create a game. Pick a live one below to jump in.</p>
    </div>
  </div>

  ${list}

  <div class="card" style="margin-top:26px;padding:22px 24px">
    <div class="eyebrow" style="margin-bottom:10px">Start a new story</div>
    <div class="create-row">
      <input id="new-game" maxlength="${NAME_MAX}" placeholder="Name your story (max ${NAME_MAX} chars)" />
      <span class="char-count" id="game-count">0/${NAME_MAX}</span>
      <button class="btn" id="create-btn">Create story</button>
    </div>
  </div>`;
}

function wireLobby(){
  document.getElementById("logout-btn")?.addEventListener("click", logout);
  document.querySelectorAll("[data-join]").forEach(el =>
    el.addEventListener("click", () => joinAndOpen(el.dataset.join))
  );
  const input = document.getElementById("new-game");
  const count = document.getElementById("game-count");
  const btn = document.getElementById("create-btn");
  if (input){
    input.addEventListener("input", () => {
      count.textContent = `${input.value.length}/${NAME_MAX}`;
      count.classList.toggle("warn", input.value.length >= NAME_MAX);
    });
    input.addEventListener("keydown", e => { if (e.key === "Enter") createGame(input.value); });
  }
  btn?.addEventListener("click", () => createGame(input.value));
}

/* =========================================================================
   GAME ROOM VIEW
   ========================================================================= */
function orderedLevels(){
  const lv = gameData.levels || {};
  return Object.values(lv).sort((a,b) => (a.order||a.number) - (b.order||b.number));
}

function renderRoom(){
  const creator = isCreator();
  const playerEntries = Object.entries(gameData.players || {});
  const players = playerEntries.map(e => e[1]);
  const cur = gameData.currentLevel;
  const votes = gameData.votes || {};

  return `
  <div class="room-head">
    <h2>${esc(gameData.name)}</h2>
    <span class="badge ${creator?'creator':'player'}">${creator?'You lead':'Player'}</span>
    <div class="spacer"></div>
    <button class="btn ghost sm" id="back-lobby">${creator?'Back to lobby':'Leave'}</button>
  </div>
  <p class="room-sub">Led by ${esc(gameData.creatorName)} · ${players.length} player${players.length===1?"":"s"} in the room</p>

  <div class="room-grid">
    <div>
      ${renderLevelPanel(creator, cur, votes, playerEntries)}
      ${renderHistory()}
    </div>
    ${renderSide(playerEntries, creator)}
  </div>`;
}

/* ---- the active-level panel -------------------------------------------- */
function renderLevelPanel(creator, cur, votes, playerEntries){
  const players = playerEntries.map(e => e[1]);
  // No active level
  if (!cur){
    if (creator){
      return `
      <div class="level-panel card">
        <div class="level-num">Next up</div>
        <h3 class="level-title placeholder">Name a level to open voting</h3>
        <div class="create-row">
          <input id="level-title" maxlength="80" placeholder="e.g. The dragon's bargain" />
          <button class="btn" id="open-level">Open level</button>
        </div>
        <p class="deck-hint" style="margin-top:14px">Each level you open lets every player vote with the deck. Reveal when ready.</p>
      </div>`;
    }
    return `
      <div class="level-panel card center">
        <div class="level-num">Standby</div>
        <h3 class="level-title placeholder">Waiting for ${esc(gameData.creatorName)} to open the next level…</h3>
        <p class="deck-hint">When a level opens, the deck appears here for you to vote.</p>
      </div>`;
  }

  // Active level
  const myVote = votes[me.uid]?.value;
  const deck = FIB.map(n =>
    `<div class="vote-card ${myVote===n?'selected':''}" data-vote="${n}">${n}</div>`
  ).join("");

  const votingArea = cur.revealed
    ? renderSwimlanes(votes, playerEntries)
    : renderPaddock(votes, playerEntries);

  let controls = "";
  if (creator){
    if (!cur.revealed){
      const anyVotes = Object.keys(votes).length > 0;
      controls = `
        <button class="btn amber" id="reveal-btn" ${anyVotes?'':'disabled'}>Reveal votes</button>
        <span class="deck-hint" style="align-self:center">${anyVotes?'Reveal to see the swimlanes.':'Waiting for the first vote…'}</span>`;
    } else {
      controls = `
        <button class="btn teal" id="next-level">Next level</button>
        <button class="btn danger" id="end-game">End game</button>
        <span class="deck-hint" style="align-self:center">Players can still change votes until you continue.</span>`;
    }
  } else {
    controls = `<span class="deck-hint">${cur.revealed
      ? 'Votes are revealed. You can still change yours until the leader continues.'
      : 'Pick a card. Your choice stays hidden until the leader reveals.'}</span>`;
  }

  return `
  <div class="level-panel card">
    <div class="level-label">
      <span class="level-num">Level ${cur.number}</span>
    </div>
    <h3 class="level-title">${esc(cur.title)}</h3>
    <div class="deck">${deck}</div>
    <p class="deck-hint">${myVote!==undefined ? `Your vote: <b style="color:var(--amber)">${myVote}</b> — tap another card to change it.` : 'Tap a card to cast your vote.'}</p>

    <div style="margin-top:24px">${votingArea}</div>

    <div class="controls">${controls}</div>
  </div>`;
}

/* ---- pre-reveal paddock (icons + checkmarks, votes concealed) ----------- */
function renderPaddock(votes, playerEntries){
  const tokens = playerEntries.map(([uid, p]) => {
    const voted = votes[uid];
    return `
    <div class="token ${voted?'voted':''}">
      <div class="tav" style="background:${p.color||colorFor(p.username)}">${initialsOf(p.username)}</div>
      ${esc(p.username)}
      ${voted ? `<span class="check">${CHECK}</span>` : `<span class="waiting">thinking…</span>`}
    </div>`;
  }).join("");
  const votedCount = Object.keys(votes).length;
  return `
  <div class="paddock">
    <p class="paddock-title">🔒 Votes are hidden — ${votedCount} of ${playerEntries.length} ready</p>
    <div class="tokens">${tokens}</div>
  </div>`;
}

/* ---- swimlanes (the signature reveal) ----------------------------------- */
function renderSwimlanes(votes, playerEntries){
  const byUid = Object.fromEntries(playerEntries);

  const groups = {}; // value -> [players]
  Object.entries(votes).forEach(([uid, v]) => {
    const p = byUid[uid] || { username: v.username, color: colorFor(v.username) };
    (groups[v.value] = groups[v.value] || []).push(p);
  });

  const winner = computeWinner(votes);
  const lanesFor = FIB.filter(n => groups[n] && groups[n].length); // only lanes with votes

  const lanes = lanesFor.map(n => {
    const grp = groups[n];
    const swimmers = grp.map(p =>
      `<span class="swimmer"><span class="sav" style="background:${p.color||colorFor(p.username)}">${initialsOf(p.username)}</span>${esc(p.username)}</span>`
    ).join("");
    const win = n === winner;
    return `
    <div class="lane ${win?'winning':''}">
      <div class="lane-num">${n}${win?`<span class="lane-crown">${CROWN}</span>`:""}</div>
      <div class="lane-body">
        ${swimmers}
        <span class="lane-count">${grp.length} vote${grp.length===1?"":"s"}${win?" · winner":""}</span>
      </div>
    </div>`;
  }).join("");

  return `
  <div class="lanes-head">
    <h3>Swimlanes</h3>
    <span class="status">Winning number: <b style="color:var(--amber)">${winner ?? "—"}</b></span>
  </div>
  <div class="lanes">${lanes}</div>`;
}

/* ---- live + final history table ---------------------------------------- */
function renderHistory(){
  const levels = orderedLevels();
  if (!levels.length) return "";
  const rows = levels.map(l => `
    <tr>
      <td class="c-num">${String(l.number).padStart(2,"0")}</td>
      <td class="c-title">${esc(l.title)}</td>
      <td class="c-pts">${l.points!=null
        ? `<span class="pts-chip">${l.points}</span>`
        : `<span class="pts-chip pending">—</span>`}</td>
    </tr>`).join("");
  return `
  <div class="history card">
    <h3>Levels so far</h3>
    <p class="hsub">Each completed level and its winning estimate.</p>
    <table class="levels">
      <thead><tr><th>#</th><th>Level</th><th class="c-pts">Points</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* ---- sidebar ------------------------------------------------------------ */
function renderSide(playerEntries, creator){
  const rows = playerEntries
    .sort((a,b) => (a[1].joinedAt||0)-(b[1].joinedAt||0))
    .map(([uid, p]) => {
      const isCreatorRow = uid === gameData.creatorUid;
      const isMe = uid === me.uid;
      return `
      <div class="player-row ${isMe?'is-me':''}">
        <div class="pav" style="background:${p.color||colorFor(p.username)}">${initialsOf(p.username)}</div>
        <span class="pname">${esc(p.username)}${isMe?' (you)':''}</span>
        ${isCreatorRow?'<span class="ptag">Leader</span>':''}
      </div>`;
    }).join("");

  const hint = creator
    ? `<div class="side-card card">
         <h4>You're leading</h4>
         <p class="tip">Name a level to open voting for everyone.</p>
         <p class="tip">Hit <b>Reveal</b> to drop the votes into swimlanes. The fullest lane wins.</p>
         <p class="tip"><b>Next level</b> saves the result and moves on. <b>End game</b> shows the full table.</p>
       </div>`
    : `<div class="side-card card">
         <h4>How to play</h4>
         <p class="tip">When a level opens, tap a card to vote.</p>
         <p class="tip">A checkmark shows you've voted — your number stays secret until the reveal.</p>
         <p class="tip">You can change your vote until the leader continues.</p>
       </div>`;

  return `
  <div class="side">
    <div class="side-card card">
      <h4>In the room · ${playerEntries.length}</h4>
      <div class="player-list">${rows}</div>
    </div>
    ${hint}
  </div>`;
}

function wireRoom(){
  document.getElementById("logout-btn")?.addEventListener("click", logout);
  document.getElementById("back-lobby")?.addEventListener("click", leaveToLobby);

  // creator: open a level
  const lt = document.getElementById("level-title");
  if (lt){
    lt.addEventListener("keydown", e => { if (e.key === "Enter") startLevel(lt.value); });
    document.getElementById("open-level")?.addEventListener("click", () => startLevel(lt.value));
  }

  // voting
  document.querySelectorAll("[data-vote]").forEach(el =>
    el.addEventListener("click", () => castVote(Number(el.dataset.vote)))
  );

  // creator controls
  document.getElementById("reveal-btn")?.addEventListener("click", reveal);
  document.getElementById("next-level")?.addEventListener("click", nextLevel);
  document.getElementById("end-game")?.addEventListener("click", endGame);
}

/* =========================================================================
   FINAL OVERLAY (game finished)
   ========================================================================= */
function renderFinal(){
  const creator = isCreator();
  const levels = orderedLevels();
  const total = levels.reduce((s,l)=>s+(l.points||0),0);
  const rows = levels.map(l => `
    <tr>
      <td class="c-num">${String(l.number).padStart(2,"0")}</td>
      <td class="c-title">${esc(l.title)}</td>
      <td class="c-pts">${l.points!=null?`<span class="pts-chip">${l.points}</span>`:`<span class="pts-chip pending">—</span>`}</td>
    </tr>`).join("");

  const creatorActions = creator ? `
    <button class="btn amber" id="email-btn">Email me this table</button>
    <button class="btn danger" id="gameover-btn">Game over · clear data</button>
  ` : `<p class="deck-hint" style="align-self:center">Waiting for ${esc(gameData.creatorName)} to close the story…</p>`;

  return `
  <div class="overlay">
    <div class="final-card card">
      <div class="eyebrow">The story is told</div>
      <h2>${esc(gameData.name)} — <em>final tally</em></h2>
      <p class="fsub">${levels.length} level${levels.length===1?"":"s"} estimated · ${total} points total</p>

      <table class="levels">
        <thead><tr><th>#</th><th>Level</th><th class="c-pts">Points</th></tr></thead>
        <tbody>${rows||`<tr><td colspan="3" class="muted center" style="padding:24px">No levels were completed.</td></tr>`}</tbody>
      </table>

      <div id="email-confirm" class="email-sent" style="display:none"></div>

      <div class="final-actions">
        ${creatorActions}
      </div>
    </div>
  </div>`;
}

/* wire final overlay after each render (it lives outside main) */
const _origRender = render;
function wireFinal(){
  document.getElementById("email-btn")?.addEventListener("click", emailResults);
  document.getElementById("gameover-btn")?.addEventListener("click", gameOver);
}
// patch: call wireFinal whenever final is shown
const observer = new MutationObserver(() => {
  if (document.querySelector(".overlay") && !document.querySelector(".overlay").dataset.wired){
    document.querySelector(".overlay").dataset.wired = "1";
    wireFinal();
  }
});
observer.observe(app, { childList: true, subtree: true });

/* =========================================================================
   TOAST
   ========================================================================= */
let toastTimer = null;
function toast(msg){
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

/* GO */
boot();
