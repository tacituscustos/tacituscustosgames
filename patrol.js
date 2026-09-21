/* Patrol — ported from the React original to plain JS. No build step.
   Mounts into #patrol.
   Copyright © 2026 Tacitus Custos Games. All rights reserved.
   Free to play; not licensed for copying or redistribution. See /LICENSE. */
(function () {
  "use strict";

  /* ---------------- seeded randomness ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(s) {
    let h = 2166136261;
    for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---------------- tiers ---------------- */
  const TIERS = {
    open: { label: "Open", n: 10, guards: 26, total: true, reveal: "all", guess: "none", blurb: "Every count is visible. No risk; pure deduction. Generated so a provably safe route exists." },
    blind: { label: "Blind", n: 10, guards: 20, total: true, reveal: "step", guess: "none", blurb: "You learn a count only by standing on it. Walking back over visited ground is free. Generated so a careful explorer never has to guess." },
    hell: { label: "Hell", n: 14, guards: 46, total: true, reveal: "step", guess: "forced", blurb: "Blind and larger, and the guard total is given. Generated so a guess is forced and so that guess has one cell strictly safest. Whether the obvious reading finds it is left to the board." },
  };

  /* ---------------- naming ----------------
     Columns are letters, rows are numbers, so a cell name cannot be read in the
     wrong order the way a pair of numbers can. Rows are 1-based to match the
     spreadsheet/chess convention a reader will already have.

     On a 14-wide board the columns reach N, so "N" and "E" are both direction
     letters and column letters. A bare letter is a direction; a letter with a
     number after it is a cell. */
  const COL = (c) => String.fromCharCode(65 + c);
  const cellName = (n, i) => COL(i % n) + (Math.floor(i / n) + 1);
  function parseCell(n, tok) {
    const m = /^([A-Z])(\d+)$/.exec(tok);
    if (!m) return null;
    const c = m[1].charCodeAt(0) - 65, r = Number(m[2]) - 1;
    if (c < 0 || c >= n || r < 0 || r >= n) return null;
    return r * n + c;
  }

  /* ---------------- geometry ---------------- */
  const idx = (n, r, c) => r * n + c;
  const neigh = (n, i) => {
    const r = Math.floor(i / n), c = i % n, out = [];
    if (r > 0) out.push(i - n); if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1); if (c < n - 1) out.push(i + 1);
    return out;
  };
  function bfs(n, from, passable) {
    const seen = new Set([from]), q = [from];
    while (q.length) { const x = q.shift(); for (const y of neigh(n, x)) if (!seen.has(y) && passable(y)) { seen.add(y); q.push(y); } }
    return seen;
  }

  /* ---------------- deduction ----------------
     known: Map cell -> count (the cell's own count; the cell itself is safe only if
     it is in `safe`). Returns cells provably safe / provably guards under the
     constraints, using single-cell and subset rules plus the global total. */
  function deduce(n, known, safe0, guardTotal) {
    const safe = new Set(safe0), guards = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      const cons = [];
      for (const [cell, count] of known) {
        const U = [], g = [];
        for (const y of neigh(n, cell)) { if (guards.has(y)) g.push(y); else if (!safe.has(y)) U.push(y); }
        if (U.length) cons.push({ U: U.sort((a, b) => a - b), rem: count - g.length });
      }
      if (guardTotal != null) {
        const unknown = [];
        for (let i = 0; i < n * n; i++) if (!safe.has(i) && !guards.has(i)) unknown.push(i);
        if (unknown.length) cons.push({ U: unknown, rem: guardTotal - guards.size });
      }
      const mark = (cells, asGuard) => { for (const y of cells) { if (asGuard ? !guards.has(y) : !safe.has(y)) { (asGuard ? guards : safe).add(y); changed = true; } } };
      for (const c of cons) {
        if (c.rem <= 0) mark(c.U, false);
        else if (c.rem >= c.U.length) mark(c.U, true);
      }
      if (changed) continue;
      for (const a of cons) for (const b of cons) {
        if (a === b || a.U.length >= b.U.length) continue;
        const bs = new Set(b.U);
        if (!a.U.every((x) => bs.has(x))) continue;
        const diff = b.U.filter((x) => !a.U.includes(x));
        const rem = b.rem - a.rem;
        if (rem <= 0) mark(diff, false);
        else if (rem >= diff.length) mark(diff, true);
        if (changed) break;
      }
    }
    return { safe, guards };
  }

  /* ---------------- exact frontier posterior ----------------
     Contributed by Marco (marcologs.com), an autonomous agent who ported this
     generator independently in order to audit it. Enumerates every assignment
     of the constrained cells consistent with every revealed number and weights
     each by how many ways the rest of the board can be filled, so the result is
     the true P(guard) rather than a heuristic.

     guardTotal is what the PLAYER knows. Passing a number when the player has
     not been told it would grade them against information they do not have.
     Measured on this generator's Hell boards: median 0.1 ms, max 0.7 ms, and
     the budget has never been hit. */
  const LFACT = [0, 0];
  function lfact(k) { for (let i = LFACT.length; i <= k; i++) LFACT[i] = LFACT[i - 1] + Math.log(i); return LFACT[k]; }
  function lchoose(a, b) { return b < 0 || b > a ? -Infinity : lfact(a) - lfact(b) - lfact(a - b); }
  function exactPosterior({ n, known, safe, guards, candidates, guardTotal, budgetMs = 2000 }) {
    const N = n * n, t0 = Date.now();
    const constrained = [], seen = new Set();
    for (const [cell] of known) for (const y of neigh(n, cell)) {
      if (safe.has(y) || guards.has(y) || seen.has(y)) continue;
      seen.add(y); constrained.push(y);
    }
    constrained.sort((a, b) => a - b);
    const pos = new Map(constrained.map((c, k) => [c, k]));
    const V = constrained.length;
    let sea = 0;
    for (let i = 0; i < N; i++) if (!safe.has(i) && !guards.has(i) && !pos.has(i)) sea++;
    const cons = [];
    for (const [cell, count] of known) {
      const vars = []; let already = 0;
      for (const y of neigh(n, cell)) { if (pos.has(y)) vars.push(pos.get(y)); else if (guards.has(y)) already++; }
      const target = count - already;
      if (!vars.length) { if (target !== 0) return { ok: false }; continue; }
      if (target < 0 || target > vars.length) return { ok: false };
      cons.push({ vars, target });
    }
    const consOf = constrained.map(() => []);
    cons.forEach((c, ci) => c.vars.forEach((v) => consOf[v].push(ci)));
    const assign = new Int8Array(V).fill(-1);
    const maxUsed = Math.min(V, guardTotal == null ? V : Math.max(0, guardTotal - guards.size));
    const totalBy = new Float64Array(maxUsed + 2);
    const guardBy = []; for (let i = 0; i < V; i++) guardBy.push(new Float64Array(maxUsed + 2));
    let solutions = 0, blown = false;
    const feasible = (v) => {
      for (const ci of consOf[v]) {
        const c = cons[ci];
        let sum = 0, undef = 0;
        for (const x of c.vars) { if (assign[x] === -1) undef++; else sum += assign[x]; }
        if (sum > c.target || sum + undef < c.target) return false;
      }
      return true;
    };
    function dfs(k, used) {
      if (blown || used > maxUsed) return;
      if ((solutions & 1023) === 0 && Date.now() - t0 > budgetMs) { blown = true; return; }
      if (k === V) {
        if (guardTotal != null) { const rest = guardTotal - guards.size - used; if (rest < 0 || rest > sea) return; }
        solutions++; totalBy[used] += 1;
        for (let i = 0; i < V; i++) if (assign[i] === 1) guardBy[i][used] += 1;
        return;
      }
      for (const val of [0, 1]) { assign[k] = val; if (feasible(k)) dfs(k + 1, used + val); assign[k] = -1; }
    }
    dfs(0, 0);
    if (blown || solutions === 0) return { ok: false };
    const logW = new Float64Array(maxUsed + 2).fill(-Infinity);
    let top = -Infinity;
    for (let u = 0; u <= maxUsed; u++) {
      if (totalBy[u] === 0) continue;
      logW[u] = guardTotal == null ? 0 : lchoose(sea, guardTotal - guards.size - u);
      if (logW[u] > top) top = logW[u];
    }
    let denom = 0;
    const w = new Float64Array(maxUsed + 2);
    for (let u = 0; u <= maxUsed; u++) {
      if (totalBy[u] === 0 || logW[u] === -Infinity) continue;
      w[u] = Math.exp(logW[u] - top);
      denom += w[u] * totalBy[u];
    }
    if (!(denom > 0)) return { ok: false };
    const risk = new Map();
    for (const cell of candidates) {
      const i = pos.get(cell);
      if (i === undefined) continue;
      let num = 0;
      for (let u = 0; u <= maxUsed; u++) if (w[u]) num += w[u] * guardBy[i][u];
      risk.set(cell, num / denom);
    }
    return { ok: true, risk };
  }

  /* ---------------- solvability ---------------- */
  function analyse(n, guardSet, counts, tier) {
    const start = 0, goal = n * n - 1;
    const total = tier.total ? guardSet.size : null;
    if (tier.reveal === "all") {
      const known = new Map(); for (let i = 0; i < n * n; i++) known.set(i, counts[i]);
      const d = deduce(n, known, new Set([start, goal]), total);
      const reach = bfs(n, start, (y) => d.safe.has(y));
      return { solvable: reach.has(goal), guesses: reach.has(goal) ? 0 : 1 };
    }
    /* blind: a careful explorer reveals every provably safe reachable cell before deciding */
    const visited = new Set([start]);
    const known = new Map([[start, counts[start]]]);
    let guesses = 0;
    for (let step = 0; step < n * n * 4; step++) {
      const d = deduce(n, known, new Set([...visited, goal]), total);
      const reach = bfs(n, start, (y) => d.safe.has(y));
      if (reach.has(goal)) return { solvable: true, guesses };
      const fresh = [...reach].filter((y) => !visited.has(y));
      if (fresh.length) { for (const y of fresh) { visited.add(y); known.set(y, counts[y]); } continue; }
      /* forced guess: pick the unknown frontier cell with the lowest naive risk */
      if (tier.guess === "none") return { solvable: false, guesses: guesses + 1 };
      const frontier = new Set();
      for (const v of reach) for (const y of neigh(n, v)) if (!d.safe.has(y) && !d.guards.has(y)) frontier.add(y);
      if (!frontier.size) return { solvable: false, guesses: guesses + 1 };
      let best = null, bestRisk = 2;
      for (const f of frontier) {
        let risk = 0, k = 0;
        for (const v of neigh(n, f)) if (known.has(v)) { const U = neigh(n, v).filter((z) => !d.safe.has(z) && !d.guards.has(z)); const g = neigh(n, v).filter((z) => d.guards.has(z)).length; if (U.length) { risk += (known.get(v) - g) / U.length; k++; } }
        risk = k ? risk / k : 0.5;
        if (risk < bestRisk) { bestRisk = risk; best = f; }
      }
      guesses++;
      if (guardSet.has(best)) return { solvable: false, guesses };
      visited.add(best); known.set(best, counts[best]);
    }
    return { solvable: false, guesses };
  }

  /* ---------------- the Hell gate ----------------
     The old rule was `a.guesses >= 1 && a.solvable`, and in a step-reveal tier
     a.solvable is false whenever the generator's own naive guess hits a guard.
     So a board was accepted only if that heuristic survived it: 56 of 58
     discards were the heuristic dying, and on every shipped board the naive
     pick was safe by construction. The tier advertised a risk it did not charge
     to one particular strategy.

     This replaces it. A board ships when a guess is genuinely forced and the
     exact posterior names one cell strictly safest. Nothing conditions on the
     outcome, and nothing conditions on whether the obvious reading finds that
     cell — measured, it does about 45% of the time, and letting that fall where
     it falls is deliberate. An earlier version required the naive rule to be
     wrong, which made the obvious move wrong on every board: not a guess, just
     a rule with a minus sign. Leaving the split alone is what makes the guess
     real, and it punishes the shortcut instead of merely wasting it — a player
     who always avoids the obvious cell dies 0.519 of the time, worse than
     guessing blind at 0.482, because half the time they are avoiding the right
     answer. Computing still pays: 0.150 against the naive rule's 0.229.

     Only the first forced guess is scored. A board may force a second, and a
     player who survives the first may meet an uncomputable one after it. */
  function hellGate(n, guardSet, counts, tier) {
    const total = tier.total ? guardSet.size : null;
    const visited = new Set([0]);
    const known = new Map([[0, counts[0]]]);
    for (let step = 0; step < n * n * 4; step++) {
      const d = deduce(n, known, new Set([...visited, n * n - 1]), total);
      const reach = bfs(n, 0, (y) => d.safe.has(y));
      if (reach.has(n * n - 1)) return { ok: false };           /* no guess forced */
      const fresh = [...reach].filter((y) => !visited.has(y));
      if (fresh.length) { for (const y of fresh) { visited.add(y); known.set(y, counts[y]); } continue; }
      const frontier = new Set();
      for (const v of reach) for (const y of neigh(n, v)) if (!d.safe.has(y) && !d.guards.has(y)) frontier.add(y);
      if (frontier.size < 2) return { ok: false };
      let naive = null, naiveRisk = 2;
      for (const f of frontier) {
        let risk = 0, k = 0;
        for (const v of neigh(n, f)) if (known.has(v)) {
          const U = neigh(n, v).filter((z) => !d.safe.has(z) && !d.guards.has(z));
          const g = neigh(n, v).filter((z) => d.guards.has(z)).length;
          if (U.length) { risk += (known.get(v) - g) / U.length; k++; }
        }
        risk = k ? risk / k : 0.5;
        if (risk < naiveRisk) { naiveRisk = risk; naive = f; }
      }
      const r = exactPosterior({ n, known, safe: d.safe, guards: d.guards, candidates: [...frontier], guardTotal: total });
      if (!r.ok || r.risk.size < 2) return { ok: false };
      const sorted = [...r.risk.entries()].sort((a, b) => a[1] - b[1]);
      if (!(sorted[1][1] - sorted[0][1] > 1e-9)) return { ok: false };  /* the minimum is tied */
      return { ok: true, best: sorted[0][0], bestRisk: sorted[0][1], naive, naiveRisk: r.risk.get(naive) };
    }
    return { ok: false };
  }

  function generate(seed, tierKey) {
    const tier = TIERS[tierKey], n = tier.n;
    const f = mulberry32(hashSeed(seed + "|" + tierKey));
    const start = 0, goal = n * n - 1;
    let tries = 0, best = null;
    while (tries++ < 400) {
      const banned = new Set([start, goal, ...neigh(n, start), ...neigh(n, goal)]);
      const pool = []; for (let i = 0; i < n * n; i++) if (!banned.has(i)) pool.push(i);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const guardSet = new Set(pool.slice(0, tier.guards));
      if (!bfs(n, start, (y) => !guardSet.has(y)).has(goal)) continue;
      const counts = []; for (let i = 0; i < n * n; i++) counts.push(neigh(n, i).filter((y) => guardSet.has(y)).length);
      const a = analyse(n, guardSet, counts, tier);
      const gate = tier.guess === "forced" ? hellGate(n, guardSet, counts, tier) : null;
      const ok = tier.guess === "forced" ? gate.ok : a.solvable;
      best = { n, guardSet, counts, tier, analysis: a, gate, tries };
      if (ok) return best;
    }
    return best;
  }

  /* ---------------- text protocol ---------------- */
  function stateText(G, visited, flags, pos, status) {
    const { n, tier, counts, guardSet } = G;
    const lines = [];
    lines.push(`Patrol — ${tier.label}. ${n}×${n} intersections. Columns are lettered A–${COL(n - 1)} from the left; rows are numbered 1–${n} from the top. A cell is its column letter followed by its row number, so ${cellName(n, 0)} is the top-left corner and ${cellName(n, n - 1)} is the top-right. Start at ${cellName(n, 0)}, reach ${cellName(n, n * n - 1)}.`);
    lines.push(`Guards stand on some intersections; stepping onto one ends the run. Every intersection's number is the count of guards on its 4 neighbouring intersections (up, down, left, right). Guards' own intersections have numbers too.`);
    lines.push(`The start, the goal, and the four intersections next to each of them never hold a guard, so the first move is always safe.`);
    if (tier.total) lines.push(`Total guards: ${guardSet.size}.`); else lines.push("Total guards: not given.");
    /* the tier's guarantee decides whether gambling is ever correct play, so a
       reader who only has the text needs it as much as one looking at the page */
    if (tier.guess === "forced") lines.push("This board is built so that at least one guess is forced, and so that the forced guess has one cell strictly safest under the numbers you have been shown. Whether a simple risk-per-neighbour reading happens to find that cell is not arranged either way — sometimes it does. Deduction alone will not get you across, and the guess is not a coin toss either.");
    else lines.push("This board is built so that a careful solver never has to guess. Every step across can be deduced from the numbers; if you cannot see a safe move, there is one you have not deduced yet.");
    const conforms = tier.guess === "forced" ? !!(G.gate && G.gate.ok) : G.analysis.solvable;
    if (!conforms) lines.push("Caveat: the generator could not find a board meeting that guarantee for this seed within its attempt limit, so this particular board may not meet it.");
    if (tier.reveal === "all") lines.push(`All numbers are visible. Submit the whole route as a list of cell names, each next to the one before, for example ${cellName(n, 0)} ${cellName(n, n)} ${cellName(n, n + 1)}.`);
    else lines.push("You see a number only on intersections you have stood on. Moving back over visited ground is safe. Reply with one or more moves, in either notation: directions, as in NNEE, or cell names, as in B2 C2 C3, each next to the one before. A bare letter is a direction; a letter with a number after it is a cell, which matters on wide boards where N and E are also column letters. Moves are applied in order and stop at the first guard, flag or edge, so a batch is never more dangerous than the same moves made one at a time.");
    lines.push("", "Legend: number = count; ? = unknown; S = start; G = goal; @ = you; ! = your flag." + (status === "caught" ? " X = guard (revealed)." : ""));
    /* the corner field keeps the header the same shape as a data row, so a parser
       can split every line on "|" and get the same field count */
    lines.push("  " + " | " + [...Array(n)].map((_, c) => COL(c).padStart(2)).join(" | "));
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) {
        const i = idx(n, r, c);
        let s;
        if (status === "caught" && guardSet.has(i)) s = "X";
        else if (i === pos && status === "playing") s = "@";
        else if (flags.has(i)) s = "!";
        else if (tier.reveal === "all" || visited.has(i)) s = String(counts[i]);
        else if (i === 0) s = "S";
        else if (i === n * n - 1) s = "G";
        else s = "?";
        row.push(s.padStart(2));
      }
      lines.push(String(r + 1).padStart(2) + " | " + row.join(" | "));
    }
    if (tier.reveal !== "all") lines.push("", `You are at ${cellName(n, pos)}. Count here: ${counts[pos]}.`);
    return lines.join("\n");
  }

  /* ---------------- markup ---------------- */
  const TEMPLATE = `
    <div class="ctl">
      <input type="text" id="pt-seed" aria-label="Seed">
      <button type="button" id="pt-use">Use seed</button>
      <button type="button" id="pt-roll">New board</button>
    </div>
    <h2>Patrol</h2>
    <p class="note" style="margin-top:6px">Cross the grid from the top-left corner to the bottom-right without stepping on a guard. Each intersection's number is how many guards stand on the four intersections next to it.</p>
    <div class="ctl" style="margin-top:8px" id="pt-tiers" role="group" aria-label="Tier"></div>
    <p class="note" style="margin-top:8px" id="pt-blurb"></p>
    <div class="status" id="pt-status" role="status" aria-live="polite"></div>
    <div class="ctl">
      <button type="button" id="pt-flag"></button>
      <button type="button" id="pt-reset">Restart</button>
    </div>
    <div class="grid" id="pt-grid" role="grid" aria-label="Patrol board"></div>
    <p class="note">Tap a highlighted neighbour to move, or use the arrow keys. Standing on an intersection shows its count. Flagged intersections can't be stepped on by accident.</p>
    <div class="ctl" style="margin-top:6px">
      <input type="text" id="pt-moves" aria-label="Moves, as directions or cell names" placeholder="NNEE or B2 C2 C3…" autocomplete="off">
      <button type="button" id="pt-go">Move</button>
    </div>
    <p class="note" id="pt-preview"></p>
    <h3>The board as text</h3>
    <p class="note">The board in its current state. In Open it can be solved in one reply; in Blind and Hell it gives up one move at a time. Carry it to a model and back if you are playing courier, or work the grid above directly. Seed <em id="pt-seedecho"></em> with tier <span id="pt-tierecho"></span> regenerates this exact board, and the address bar already holds a link to it.</p>
    <div class="ctl" style="margin-bottom:8px"><button type="button" id="pt-copy">Copy</button><span class="note" id="pt-copied"></span></div>
    <textarea id="pt-text" readonly></textarea>
  `;

  /* ---------------- UI ---------------- */
  const root = document.getElementById("patrol");
  if (!root) return;
  root.className = "pt";
  root.innerHTML = TEMPLATE;

  const el = (id) => root.querySelector("#" + id);
  const seedInput = el("pt-seed"), tiersBox = el("pt-tiers"), blurbEl = el("pt-blurb"),
    statusEl = el("pt-status"), flagBtn = el("pt-flag"), gridEl = el("pt-grid"),
    textEl = el("pt-text"), copiedEl = el("pt-copied"),
    seedEcho = el("pt-seedecho"), tierEcho = el("pt-tierecho");

  /* ---------------- addressable boards ----------------
     ?mode=blind&seed=77777 — a board is a link, so it can be handed to someone
     (or something) else and come back the same board. A malformed value falls
     back to the default rather than throwing.

     Both machines once shared arcade.html, where the parameters needed a
     machine prefix to tell them apart. Those older names are still read, so a
     link minted before the split still resolves to the board it names; only
     the short names are ever written back. arcade.html forwards them here. */
  const URL_MODE = "mode", URL_SEED = "seed";
  const OLD_MODE = "patrol_mode", OLD_SEED = "patrol_seed";
  function fromUrl() {
    let p;
    try { p = new URLSearchParams(location.search); } catch { return {}; }
    const mode = (p.get(URL_MODE) || p.get(OLD_MODE) || "").toLowerCase();
    const seed = p.get(URL_SEED) || p.get(OLD_SEED);
    return { tierKey: TIERS[mode] ? mode : null, seed: seed || null };
  }
  function toUrl() {
    try {
      const p = new URLSearchParams(location.search);
      p.delete(OLD_MODE); p.delete(OLD_SEED);
      p.set(URL_MODE, state.tierKey);
      p.set(URL_SEED, state.seed);
      history.replaceState(null, "", location.pathname + "?" + p + location.hash);
    } catch { /* file:// and the like — playing still works, linking doesn't */ }
  }

  const fromLink = fromUrl();
  const state = {
    seed: fromLink.seed || String(Math.floor(Math.random() * 1e6)),
    tierKey: fromLink.tierKey || "blind",
    flagMode: false,
    G: null,
    run: null,
  };

  const tierBtns = {};
  for (const [k, t] of Object.entries(TIERS)) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = t.label;
    b.addEventListener("click", () => { if (state.tierKey !== k) { state.tierKey = k; regenerate(); } });
    tiersBox.appendChild(b);
    tierBtns[k] = b;
  }

  let cells = [];
  function buildGrid() {
    const n = state.G.n;
    const cellPx = Math.min(32, Math.floor(340 / n));
    /* 1fr tracks so the board shrinks to fit narrow screens instead of overflowing */
    gridEl.style.gridTemplateColumns = `auto repeat(${n}, 1fr)`;
    gridEl.style.width = `min(100%, ${n * cellPx + (n - 1) * 2 + 22}px)`;
    gridEl.textContent = "";
    cells = [];
    const hdr = (text, cls) => {
      const d = document.createElement("div");
      d.className = "hdr" + (cls ? " " + cls : "");
      d.textContent = text;
      d.setAttribute("aria-hidden", "true");
      gridEl.appendChild(d);
      return d;
    };
    hdr("", "corner");
    for (let c = 0; c < n; c++) hdr(COL(c));
    for (let r = 0; r < n; r++) {
      hdr(String(r + 1), "rowhdr");
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cell";
        b.style.fontSize = (cellPx < 26 ? 11 : 14) + "px";
        b.dataset.i = String(i);
        b.dataset.cell = cellName(n, i);
        b.setAttribute("aria-label", cellName(n, i));
        gridEl.appendChild(b);
        cells.push(b);
      }
    }
  }

  const freshRun = () => ({ pos: 0, visited: new Set([0]), flags: new Set(), status: "playing", moves: 0, path: [0] });

  function regenerate() {
    statusEl.textContent = "Generating…";
    toUrl();
    for (const [k, b] of Object.entries(tierBtns)) b.classList.toggle("on", k === state.tierKey);
    /* let the browser paint "Generating…" before the synchronous search */
    setTimeout(() => {
      state.G = generate(state.seed, state.tierKey);
      state.run = freshRun();
      buildGrid();
      render();
    }, 0);
  }

  function reset() { state.run = freshRun(); render(); }

  function tap(i) {
    const cur = state.run, G = state.G, n = G.n, goal = n * n - 1;
    if (cur.status !== "playing") return;
    if (state.flagMode) {
      cur.flags.has(i) ? cur.flags.delete(i) : cur.flags.add(i);
      render();
      return;
    }
    if (!neigh(n, cur.pos).includes(i)) return;
    if (cur.flags.has(i)) return;
    cur.visited.add(i);
    cur.path.push(i);
    cur.pos = i;
    cur.moves += 1;
    if (G.guardSet.has(i)) cur.status = "caught";
    else if (i === goal) cur.status = "through";
    render();
  }

  function render() {
    const G = state.G, cur = state.run, n = G.n, goal = n * n - 1;

    blurbEl.textContent = G.tier.blurb + " " +
      (G.tier.total ? `${G.guardSet.size} guards on this board.` : "Guard total withheld.") +
      ((G.tier.guess === "forced" ? (G.gate && G.gate.ok) : G.analysis.solvable) ? "" : " (Generator could not find a conforming board for this seed; this one may not meet the tier's guarantee.)");

    statusEl.textContent = cur.status === "caught" ? "Caught."
      : cur.status === "through" ? `Through in ${cur.moves} moves.`
      : `${cur.moves} moves`;

    flagBtn.textContent = state.flagMode ? "Flagging: tap to mark" : "Flag guards";
    flagBtn.classList.toggle("on", state.flagMode);
    flagBtn.setAttribute("aria-pressed", String(state.flagMode));

    const adj = new Set(neigh(n, cur.pos));
    for (let i = 0; i < n * n; i++) {
      const b = cells[i], cnt = G.counts[i];
      const isMe = i === cur.pos && cur.status === "playing";
      const shown = G.tier.reveal === "all" || cur.visited.has(i);
      let cls = "cell";
      if (cur.status === "caught" && G.guardSet.has(i)) cls += " guard";
      else if (isMe) cls += " me";
      else if (cur.flags.has(i)) cls += " flag";
      else if (shown) cls += " vis"; else cls += " unk";
      if (cur.visited.has(i) && !isMe && cur.status !== "caught") cls += " path";
      if (i === goal && cur.status === "playing") cls += " goal";
      if (adj.has(i) && cur.status === "playing" && !state.flagMode) cls += " adj";
      b.className = cls;
      b.textContent = cur.status === "caught" && G.guardSet.has(i) ? "✕"
        : isMe ? String(cnt)
        : cur.flags.has(i) ? "!"
        : shown ? String(cnt)
        : i === goal ? "G" : "";
    }

    seedEcho.textContent = state.seed;
    tierEcho.textContent = G.tier.label;
    textEl.value = stateText(G, cur.visited, cur.flags, cur.pos, cur.status);
  }

  /* ---------------- events ---------------- */
  gridEl.addEventListener("click", (e) => {
    const b = e.target.closest(".cell");
    if (b) tap(Number(b.dataset.i));
  });

  flagBtn.addEventListener("click", () => { state.flagMode = !state.flagMode; render(); });
  el("pt-reset").addEventListener("click", reset);
  el("pt-use").addEventListener("click", () => { state.seed = seedInput.value; regenerate(); });
  el("pt-roll").addEventListener("click", () => {
    state.seed = String(Math.floor(Math.random() * 1e6));
    seedInput.value = state.seed;
    regenerate();
  });
  seedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); state.seed = seedInput.value; regenerate(); }
  });

  el("pt-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(textEl.value); copiedEl.textContent = "Copied"; }
    catch { copiedEl.textContent = "Select the text and copy it"; }
    setTimeout(() => { copiedEl.textContent = ""; }, 2500);
  });
  textEl.addEventListener("focus", () => textEl.select());

  /* ---------------- move strings ----------------
     A batch is compiled by hand, which is where a courier-mode player makes
     mistakes: miscounting the letters, or misjudging where one lands. So the
     reading is echoed back with its landing square before anything is
     committed, and the batch halts at the first surprise rather than running on.

     The preview is computed without consulting guardSet — it may only use what
     the player already knows (edges and their own flags), never where a guard
     is. */
  const rc = (i) => cellName(state.G.n, i);
  function stepTarget(pos, d) {
    const n = state.G.n, r = Math.floor(pos / n), c = pos % n;
    if (d === "N") return r > 0 ? pos - n : null;
    if (d === "S") return r < n - 1 ? pos + n : null;
    if (d === "W") return c > 0 ? pos - 1 : null;
    if (d === "E") return c < n - 1 ? pos + 1 : null;
    return null;
  }
  /* a token is either a direction (bare letter) or a cell (letter + number) */
  function parseMoves(s) {
    const moves = [], bad = [];
    const toks = String(s).toUpperCase().match(/[A-Z]\d+|[A-Z]|[^\sA-Z0-9,;.>\u2192-]+|\d+/g) || [];
    for (const t of toks) {
      if (/^[A-Z]\d+$/.test(t)) moves.push({ kind: "cell", tok: t });
      else if (/^[NSEW]$/.test(t)) moves.push({ kind: "dir", tok: t });
      else bad.push(t);
    }
    /* The protocol text asks for "the whole route as a list of cell names, each
       next to the one before", and its worked example starts at the cell you
       are standing on — which is the natural way to write a path, and the way a
       courier-mode player will write one. The mover takes destinations, so that
       leading token used to fail as "not next to" itself, rejecting the very
       example the board prints. Drop it when it names where you already are.
       Only the first token, and only on an exact match: a later cell equal to
       the current one is a real move back, and from any other position the
       token is a real move too. */
    if (moves.length && moves[0].kind === "cell" &&
        parseCell(state.G.n, moves[0].tok) === state.run.pos) moves.shift();
    return { moves, bad };
  }
  /* where a move lands, using only what the player already knows */
  function resolveMove(pos, m) {
    const n = state.G.n;
    if (m.kind === "dir") {
      const t = stepTarget(pos, m.tok);
      return t === null ? { err: "runs off the edge" } : { to: t };
    }
    const t = parseCell(n, m.tok);
    if (t === null) return { err: `is not a cell on this board` };
    if (!neigh(n, pos).includes(t)) return { err: `is not next to ${cellName(n, pos)}` };
    return { to: t };
  }
  function previewMoves() {
    const el2 = el("pt-preview"), raw = el("pt-moves").value.trim();
    if (!raw) { el2.textContent = ""; return; }
    const { moves, bad } = parseMoves(raw);
    if (bad.length) { el2.textContent = `Not a move: ${[...new Set(bad)].join(" ")}. Use directions N, S, E, W or cell names like B2.`; return; }
    if (!moves.length) { el2.textContent = ""; return; }
    let pos = state.run.pos, blocked = null;
    for (let k = 0; k < moves.length; k++) {
      const r = resolveMove(pos, moves[k]);
      if (r.err) { blocked = `${k + 1} (${moves[k].tok}) ${r.err}`; break; }
      if (state.run.flags.has(r.to)) { blocked = `${k + 1} (${moves[k].tok}) hits your own flag at ${rc(r.to)}`; break; }
      pos = r.to;
    }
    el2.textContent = `Reads as ${moves.map((m) => m.tok).join(",")} — ${moves.length} move${moves.length > 1 ? "s" : ""}` +
      (blocked ? `, but move ${blocked}. It would stop at ${rc(pos)}.` : `, landing at ${rc(pos)}.`);
  }
  function runMoves() {
    const raw = el("pt-moves").value.trim();
    if (!raw || state.run.status !== "playing") return;
    const { moves, bad } = parseMoves(raw);
    if (bad.length || !moves.length) { previewMoves(); return; }
    const wasFlagging = state.flagMode;
    state.flagMode = false;
    let done = 0, stopped = null;
    for (const m of moves) {
      const r = resolveMove(state.run.pos, m);
      if (r.err) { stopped = `move ${done + 1} (${m.tok}) ${r.err}`; break; }
      if (state.run.flags.has(r.to)) { stopped = `move ${done + 1} (${m.tok}) is blocked by your flag at ${rc(r.to)}`; break; }
      tap(r.to);
      done++;
      if (state.run.status !== "playing") break;
    }
    state.flagMode = wasFlagging;
    const where = rc(state.run.pos);
    el("pt-preview").textContent =
      state.run.status === "caught" ? `Applied ${done} of ${moves.length}. Caught on move ${done} at ${where}.`
      : state.run.status === "through" ? `Applied ${done} of ${moves.length}. Through at ${where}.`
      : stopped ? `Applied ${done} of ${moves.length}, then stopped: ${stopped}. You are at ${where}.`
      : `Applied ${moves.map((m) => m.tok).join(",")}. You are at ${where}.`;
    if (!stopped) el("pt-moves").value = "";
    render();
  }
  el("pt-go").addEventListener("click", runMoves);
  el("pt-moves").addEventListener("input", previewMoves);
  el("pt-moves").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runMoves(); } });

  /* arrow keys: one move, matching the N/S/E/W protocol */
  const ARROWS = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -2, ArrowRight: 2 };
  document.addEventListener("keydown", (e) => {
    if (!(e.key in ARROWS)) return;
    const t = e.target;
    /* the page holds more than this machine — a header, links, whatever comes
       later — so only steer when focus is loose or inside this one, and never
       when it is in a text field. Arrow keys aimed at something else on the
       page must not move the pawn. */
    if (t && t !== document.body && !root.contains(t)) return;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const cur = state.run, n = state.G.n;
    if (cur.status !== "playing") return;
    const d = ARROWS[e.key];
    const r = Math.floor(cur.pos / n), c = cur.pos % n;
    let target = null;
    if (d === -1 && r > 0) target = cur.pos - n;
    else if (d === 1 && r < n - 1) target = cur.pos + n;
    else if (d === -2 && c > 0) target = cur.pos - 1;
    else if (d === 2 && c < n - 1) target = cur.pos + 1;
    if (target === null) return;
    e.preventDefault();
    const wasFlagging = state.flagMode;
    state.flagMode = false;
    tap(target);
    state.flagMode = wasFlagging;
    render();
  });

  seedInput.value = state.seed;
  regenerate();
})();
