/* Witness — four accounts of the same morning. No build step.
   Mounts into #witness.

   Everything above the UI banner touches no DOM, so those lines are a module on
   their own; llms.txt documents that boundary for a reader with no browser.
   Copyright © 2026 Tacitus Custos Games. All rights reserved.
   Free to play; not licensed for copying or redistribution. See /LICENSE. */
(function () {
  "use strict";

  /* Open is the only tier built. Every statement is true and the work is
     reconciling four partial accounts, so there is no false statement to hunt.
     The tiers that have one are designed and measured in
     docs/witness-design.md and are deliberately not wired up here.

     The numbers are measured rather than chosen. perWitness is 3 because at 5
     the same tier builds 0 boards in 60: twenty true statements leave nothing
     undetermined, so no board can carry both settled and open questions.
     MIX.narrow is 0, which keeps every statement first person — an account of
     one's own morning rather than a fact about other people stated from
     nowhere. GATE.minSettled is the floor on how much a record must pin down. */
  const TIERS = {
    open: { label: "Open", people: 4, ticks: 4, perWitness: 3, liar: false, questions: 6, blurb: "" },
  };
  const GATE = { on: true, minSettled: 0.5 };
  const MIX = { narrow: 0 };
  const ATTEMPTS = { n: 300 };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  function makeRng(seed) {
    const f = mulberry32(hashSeed(seed));
    return { next: f, int: (n) => Math.floor(f() * n), pick: (a) => a[Math.floor(f() * a.length)], chance: (p) => f() < p,
      shuffle: (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; } };
  }

  const NAMES = ["Ada", "Bram", "Cleo", "Dov", "Esme", "Fen", "Greta", "Hal"];

  const PLACES = ["kitchen", "study", "garden"];

  const STUDY = 1;

  const TICKS = ["9:00", "9:10", "9:20", "9:30", "9:40"];

  function mkStatement(type, w, a, P, T) {
    const s = { type, w, ...a };
    const who = (p) => P[p];
    const at = (t) => TICKS[t];
    switch (type) {
      case "selfAt": s.text = `At ${at(s.t)} I was in the ${PLACES[s.x]}.`; break;
      case "sawWith": s.text = `At ${at(s.t)} ${who(s.p)} was in the ${PLACES[s.x]} with me.`; break;
      case "notThere": s.text = `${who(s.p)} was not in the ${PLACES[s.x]} at ${at(s.t)}; I was there and would have seen them.`; break;
      case "alone": s.text = `At ${at(s.t)} I was alone in the ${PLACES[s.x]}.`; break;
      case "coinSeen": s.text = `At ${at(s.t)} the coin was still on the study desk.`; break;
      case "coinGone": s.text = `At ${at(s.t)} the study desk was empty; the coin was gone.`; break;
      case "stayed": s.text = `I was in the ${PLACES[s.x]} from ${at(s.t)} through ${at(s.t2)}.`; break;
      case "moved": s.text = `I went from the ${PLACES[s.x]} at ${at(s.t)} to the ${PLACES[s.x2]} at ${at(s.t + 1)}.`; break;
      case "sawTake": s.text = `At ${at(s.t)} I saw ${who(s.p)} take the coin from the desk.`; break;
      /* forms that narrow the world without naming a cell. Every statement type
         above pins a position outright, which is why 99% of settled cells were
         settled by lookup rather than deduction. */
      case "empty":     s.text = `The ${PLACES[s.x]} was empty at ${at(s.t)}.`; break;
      case "together":  s.text = `At ${at(s.t)} ${who(s.p)} and ${who(s.p2)} were in the same room.`; break;
      case "apart":     s.text = `At ${at(s.t)} ${who(s.p)} and ${who(s.p2)} were not in the same room.`; break;
      case "neverIn":   s.text = `${who(s.p)} was never in the ${PLACES[s.x]}.`; break;
      case "stayedPut": s.text = `I did not change rooms between ${at(s.t)} and ${at(s.t2)}.`; break;
      case "changed":   s.text = `${who(s.p)} changed rooms between ${at(s.t)} and ${at(s.t + 1)}.`; break;
      default: break;
    }
    return s;
  }

  function evalStmt(s, W) {
    const loc = (p, t) => W.loc[p * W.T + t];
    const def = (v) => v !== -1;
    switch (s.type) {
      case "selfAt": { const l = loc(s.w, s.t); return def(l) ? l === s.x : undefined; }
      case "sawWith": { const a = loc(s.w, s.t), b = loc(s.p, s.t); if (def(a) && a !== s.x) return false; if (def(b) && b !== s.x) return false; return def(a) && def(b) ? true : undefined; }
      case "notThere": { const a = loc(s.w, s.t), b = loc(s.p, s.t); if (def(a) && a !== s.x) return false; if (def(b) && b === s.x) return false; return def(a) && def(b) ? true : undefined; }
      case "alone": { const a = loc(s.w, s.t); if (def(a) && a !== s.x) return false; let und = !def(a); for (let p = 0; p < W.P; p++) { if (p === s.w) continue; const b = loc(p, s.t); if (def(b) && b === s.x) return false; if (!def(b)) und = true; } return und ? undefined : true; }
      case "coinSeen": { const a = loc(s.w, s.t); if (def(a) && a !== STUDY) return false; if (W.takeT !== -1 && !(s.t < W.takeT)) return false; return def(a) && W.takeT !== -1 ? true : undefined; }
      case "coinGone": { const a = loc(s.w, s.t); if (def(a) && a !== STUDY) return false; if (W.takeT !== -1 && !(s.t >= W.takeT)) return false; return def(a) && W.takeT !== -1 ? true : undefined; }
      case "stayed": { let und = false; for (let t = s.t; t <= s.t2; t++) { const l = loc(s.w, t); if (def(l) && l !== s.x) return false; if (!def(l)) und = true; } return und ? undefined : true; }
      case "moved": { const a = loc(s.w, s.t), b = loc(s.w, s.t + 1); if (def(a) && a !== s.x) return false; if (def(b) && b !== s.x2) return false; return def(a) && def(b) ? true : undefined; }
      case "sawTake": { const a = loc(s.w, s.t), b = loc(s.p, s.t); if (def(a) && a !== STUDY) return false; if (def(b) && b !== STUDY) return false; if (W.takeT !== -1 && W.takeT !== s.t) return false; if (W.taker !== -1 && W.taker !== s.p) return false; return def(a) && def(b) && W.takeT !== -1 && W.taker !== -1 ? true : undefined; }
      case "empty": { let und=false; for(let p=0;p<W.P;p++){ const l=loc(p,s.t); if(def(l)&&l===s.x) return false; if(!def(l)) und=true; } return und?undefined:true; }
      case "together": { const a=loc(s.p,s.t), b=loc(s.p2,s.t); if(def(a)&&def(b)) return a===b; return undefined; }
      case "apart": { const a=loc(s.p,s.t), b=loc(s.p2,s.t); if(def(a)&&def(b)) return a!==b; return undefined; }
      case "neverIn": { let und=false; for(let t=0;t<W.T;t++){ const l=loc(s.p,t); if(def(l)&&l===s.x) return false; if(!def(l)) und=true; } return und?undefined:true; }
      case "stayedPut": { let seen=-1, und=false; for(let t=s.t;t<=s.t2;t++){ const l=loc(s.w,t); if(!def(l)){und=true;continue;} if(seen===-1) seen=l; else if(l!==seen) return false; } return und?undefined:true; }
      case "changed": { const a=loc(s.p,s.t), b=loc(s.p,s.t+1); if(def(a)&&def(b)) return a!==b; return undefined; }
      default: return true;
    }
  }

  function evalTaker(W) {
    if (W.takeT === -1 || W.taker === -1) return undefined;
    const l = W.loc[W.taker * W.T + W.takeT];
    return l === -1 ? undefined : l === STUDY;
  }

  function satisfiable(P, T, stmts, extra, fixed) {
    const W = { P, T, loc: new Array(P * T).fill(-1), takeT: -1, taker: -1 };
    if (fixed) { if (fixed.takeT !== undefined) W.takeT = fixed.takeT; if (fixed.taker !== undefined) W.taker = fixed.taker; if (fixed.loc) for (const [i, v] of fixed.loc) W.loc[i] = v; }
    const check = () => {
      for (const s of stmts) if (evalStmt(s, W) === false) return false;
      if (evalTaker(W) === false) return false;
      if (extra) { const e = extra(W); if (e === false) return false; }
      return true;
    };
    if (!check()) return false;
    /* order: takeT, taker, then locations tick by tick */
    const order = [];
    if (W.takeT === -1) order.push("takeT");
    if (W.taker === -1) order.push("taker");
    for (let t = 0; t < T; t++) for (let p = 0; p < P; p++) if (W.loc[p * T + t] === -1) order.push(p * T + t);
    const rec = (k) => {
      if (k === order.length) return extra ? extra(W) !== false : true;
      const v = order[k];
      if (v === "takeT") { for (let t = 0; t < T; t++) { W.takeT = t; if (check() && rec(k + 1)) return true; } W.takeT = -1; return false; }
      if (v === "taker") { for (let p = 0; p < P; p++) { W.taker = p; if (check() && rec(k + 1)) return true; } W.taker = -1; return false; }
      for (let x = 0; x < PLACES.length; x++) { W.loc[v] = x; if (check() && rec(k + 1)) return true; }
      W.loc[v] = -1; return false;
    };
    return rec(0);
  }

  function touches(s, P, T) {
    const cell = (p, t) => p * T + t, out = [];
    switch (s.type) {
      case "selfAt": case "alone": out.push(cell(s.w, s.t)); break;
      case "sawWith": case "notThere": out.push(cell(s.w, s.t), cell(s.p, s.t)); break;
      case "coinSeen": case "coinGone": out.push(cell(s.w, s.t), "takeT"); break;
      case "stayed": case "stayedPut": for (let t = s.t; t <= s.t2; t++) out.push(cell(s.w, t)); break;
      case "moved": out.push(cell(s.w, s.t), cell(s.w, s.t + 1)); break;
      case "sawTake": out.push(cell(s.w, s.t), cell(s.p, s.t), "takeT", "taker"); break;
      case "empty": for (let p = 0; p < P; p++) out.push(cell(p, s.t)); break;
      case "together": case "apart": out.push(cell(s.p, s.t), cell(s.p2, s.t)); break;
      case "neverIn": for (let t = 0; t < T; t++) out.push(cell(s.p, t)); break;
      case "changed": out.push(cell(s.p, s.t), cell(s.p, s.t + 1)); break;
      default: break;
    }
    if (s.type === "alone") for (let p = 0; p < P; p++) if (p !== s.w) out.push(cell(p, s.t));
    return out;
  }

  function enumerateFast(P, T, stmts, liar, cap = 400000, order0 = null) {
    const maxFalse = liar ? 1 : 0, N = P * T;
    const W = { P, T, loc: new Array(N).fill(-1), takeT: -1, taker: -1 };
    const worlds = []; let blown = false, nodes = 0;

    const byVar = new Map();
    stmts.forEach((s, i) => { for (const v of touches(s, P, T)) {
      if (!byVar.has(v)) byVar.set(v, []); const a = byVar.get(v); if (a[a.length - 1] !== i) a.push(i); } });

    /* most-constrained-first: assign the cells the most statements mention
       before the ones nothing says anything about, so a contradiction surfaces
       near the root instead of after a full descent. */
    const order = order0 || (() => {
      const cells = [...Array(N).keys()];
      cells.sort((a, b) => (byVar.get(b)?.length || 0) - (byVar.get(a)?.length || 0) || a - b);
      return ["takeT", "taker", ...cells];
    })();

    const isFalse = new Uint8Array(stmts.length);
    let falseCount = 0;
    const assign = (v) => {               /* returns the trail of newly-false statements, or null if it breaks the budget */
      const hit = byVar.get(v); if (!hit) return [];
      const trail = [];
      for (const i of hit) {
        if (isFalse[i]) continue;
        if (evalStmt(stmts[i], W) === false) { isFalse[i] = 1; falseCount++; trail.push(i); }
      }
      if (falseCount > maxFalse) { for (const i of trail) { isFalse[i] = 0; falseCount--; } return null; }
      return trail;
    };
    const undo = (trail) => { for (const i of trail) { isFalse[i] = 0; falseCount--; } };

    const rec = (k) => {
      if (blown) return;
      if (++nodes > 40000000) { blown = true; return; }
      if (evalTaker(W) === false) return;
      if (k === order.length) {
        /* "exactly one is false" is a strictly stronger rule than "at most one":
           it discards every zero-false world, so more is settled and the player
           has something to use. The enumeration matches the
           sentence the board prints. */
        if (maxFalse === 1 && falseCount !== 1) return;
        if (worlds.length >= cap) { blown = true; return; }
        let bad = -1;
        for (let i = 0; i < stmts.length; i++) if (isFalse[i]) { bad = i; break; }
        worlds.push({ loc: W.loc.slice(), takeT: W.takeT, taker: W.taker, bad });
        return;
      }
      const v = order[k];
      if (v === "takeT") { for (let t = 0; t < T; t++) { W.takeT = t; const tr = assign(v); if (tr) { rec(k + 1); undo(tr); } } W.takeT = -1; return; }
      if (v === "taker") { for (let p = 0; p < P; p++) { W.taker = p; const tr = assign(v); if (tr) { rec(k + 1); undo(tr); } } W.taker = -1; return; }
      for (let x = 0; x < PLACES.length; x++) { W.loc[v] = x; const tr = assign(v); if (tr) { rec(k + 1); undo(tr); } }
      W.loc[v] = -1;
    };
    rec(0);
    return { worlds, blown, nodes };
  }

  function generate(seed, tierKey) {
    const tier = TIERS[tierKey];
    const rng = makeRng(seed + "|" + tierKey);
    const P = tier.people, T = tier.ticks;
    const people = rng.shuffle(NAMES).slice(0, P);
    for (let attempt = 0; attempt < ATTEMPTS.n; attempt++) {
      /* truth: everyone moves a little; taker is in the study at takeT */
      const loc = new Array(P * T);
      for (let p = 0; p < P; p++) { let x = rng.int(3); for (let t = 0; t < T; t++) { if (t > 0 && rng.chance(0.5)) x = (x + 1 + rng.int(2)) % 3; loc[p * T + t] = x; } }
      const takeT = 1 + rng.int(T - 1);
      const inStudy = []; for (let p = 0; p < P; p++) if (loc[p * T + takeT] === STUDY) inStudy.push(p);
      if (!inStudy.length || inStudy.length > 2) continue;
      let studyVisits = 0; for (let i = 0; i < P * T; i++) if (loc[i] === STUDY) studyVisits++;
      if (studyVisits < 3) continue;
      const taker = rng.pick(inStudy);
      const truth = { P, T, loc, takeT, taker };
      /* candidate true statements per witness */
      const stmts = [];
      /* Five forms assert nothing about who utters them — their own legend entries
         name only other people, rooms and slots. Two witnesses drawing the same
         one state the identical proposition, and under the exactly-one-false rule
         an identical pair cannot contain the liar: falsifying one would falsify
         both. So a duplicate certifies both members true for free and strikes
         them off the "which statement is false" list, which is a deduction about
         the generator's rule rather than about the house. The pool is dealt
         without replacement across the whole board to stop it. */
      const usedKeys = new Set();
      for (let w = 0; w < P; w++) {
        const cands = [];
        for (let t = 0; t < T; t++) {
          const x = loc[w * T + t];
          cands.push(mkStatement("selfAt", w, { t, x }, people, T));
          const others = []; for (let p = 0; p < P; p++) if (p !== w && loc[p * T + t] === x) others.push(p);
          for (const p of others) cands.push(mkStatement("sawWith", w, { t, p, x }, people, T));
          for (let p = 0; p < P; p++) if (p !== w && loc[p * T + t] !== x) cands.push(mkStatement("notThere", w, { t, p, x }, people, T));
          if (!others.length) cands.push(mkStatement("alone", w, { t, x }, people, T));
          if (x === STUDY) cands.push(mkStatement(t < takeT ? "coinSeen" : "coinGone", w, { t }, people, T));
          if (x === STUDY && t === takeT && w !== taker) cands.push(mkStatement("sawTake", w, { t, p: taker }, people, T));
          if (t + 1 < T && loc[w * T + t + 1] !== x) cands.push(mkStatement("moved", w, { t, x, x2: loc[w * T + t + 1] }, people, T));
          if (t + 1 < T && loc[w * T + t + 1] === x) { let t2 = t + 1; while (t2 + 1 < T && loc[w * T + t2 + 1] === x) t2++; cands.push(mkStatement("stayed", w, { t, t2, x }, people, T)); }
        }
        /* the constraining pool: true of this world, and naming no cell */
        const narrow = [];
        for (let t = 0; t < T; t++) {
          for (let x = 0; x < PLACES.length; x++) {
            let occupied = false; for (let p = 0; p < P; p++) if (loc[p * T + t] === x) occupied = true;
            if (!occupied) narrow.push(mkStatement("empty", w, { x, t }, people, T));
          }
          for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
            if (a === w || b === w) continue;
            const same = loc[a * T + t] === loc[b * T + t];
            narrow.push(mkStatement(same ? "together" : "apart", w, { p: a, p2: b, t }, people, T));
          }
          if (t + 1 < T) for (let p = 0; p < P; p++) if (p !== w && loc[p * T + t] !== loc[p * T + t + 1])
            narrow.push(mkStatement("changed", w, { p, t }, people, T));
        }
        for (let p = 0; p < P; p++) for (let x = 0; x < PLACES.length; x++) {
          let ever = false; for (let t = 0; t < T; t++) if (loc[p * T + t] === x) ever = true;
          if (!ever) narrow.push(mkStatement("neverIn", w, { p, x }, people, T));
        }
        { let t = 0; while (t < T) { let t2 = t; while (t2 + 1 < T && loc[w * T + t2 + 1] === loc[w * T + t]) t2++;
            if (t2 > t) narrow.push(mkStatement("stayedPut", w, { t, t2 }, people, T)); t = t2 + 1; } }

        const isCoin = (c) => c.type === "coinSeen" || c.type === "coinGone" || c.type === "sawTake";
        const coin = cands.filter(isCoin), rest = cands.filter((c) => !isCoin(c));
        const chosen = [];
        const take = (c) => { const k = propKey(c); if (k !== null) { if (usedKeys.has(k)) return false; usedKeys.add(k); } chosen.push(c); return true; };
        if (coin.length && rng.chance(0.85)) take(rng.pick(coin));
        const wantNarrow = Math.round(tier.perWitness * (MIX.narrow || 0));
        for (const c of rng.shuffle(narrow)) { if (chosen.length >= wantNarrow) break; take(c); }
        /* An account that never mentions 9:20 reads as a list of facts rather than
           as someone's evening, so a candidate touching a slot this witness has
           not reached yet is taken before one that repeats a slot. Preference, not
           a requirement: forcing coverage would starve the gate on worlds where a
           witness has nothing true and non-trivial to say about a slot. */
        const covered = new Set();
        for (const c of chosen) for (const t of slotsTouched(c, T)) covered.add(t);
        const queue = rng.shuffle(rest), spent = new Set();
        while (chosen.length < tier.perWitness) {
          /* recomputed each time round: a candidate is only worth preferring while
             the slot it would open is still unspoken for. */
          let next = queue.find((c) => !spent.has(c) && slotsTouched(c, T).some((t) => !covered.has(t)));
          if (!next) next = queue.find((c) => !spent.has(c));
          if (!next) break;
          spent.add(next);
          if (take(next)) for (const t of slotsTouched(next, T)) covered.add(t);
        }
        /* each account is told in order */
        chosen.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
        for (const c of chosen) stmts.push(c);
      }
      /* a witness the dedup could not fill is discarded, not shipped short */
      if (stmts.length !== P * tier.perWitness) continue;
      /* sanity: all true */
      if (!stmts.every((s) => evalStmt(s, truth) === true)) continue;
      /* falsify one statement in liar tiers (about half the time) */
      /* Open has no false statement, so there is nothing to falsify. The tiers
         that do — where exactly one statement is false and the question is how
         many accounts a reader must hold together to catch it — are designed and
         measured in docs/witness-design.md but are not built. falseIdx stays -1,
         which puzzleText() and keyText() already render as "every statement is
         true" and "No statement is false." */
      const falseIdx = -1;
      /* One enumeration answers everything below. Asking instead "is the
         record still consistent WITHOUT this statement?" is not the
         question the liar item puts: a statement can be removable and still be
         true in every world satisfying the others. Reading the falsified index
         off each world gets it right, and costs one traversal instead of a
         satisfiability search per question per value per drop. */
      const { worlds, blown } = enumerateFast(P, T, stmts, tier.liar);
      if (blown || !worlds.length) continue;
      const drops = [...new Set(worlds.map((w) => w.bad))].sort((a, b) => a - b);
      const readOff = (q) => {
        if (q.isLiar) return drops.slice();
        if (q.id === "taker") return [...new Set(worlds.map((w) => w.taker))].sort((a, b) => a - b);
        if (q.id === "when")  return [...new Set(worlds.map((w) => w.takeT))].sort((a, b) => a - b);
        return [...new Set(worlds.map((w) => w.loc[q.p * T + q.t]))].sort((a, b) => a - b);
      };
      /* questions */
      const qs = [];
      qs.push({ id: "taker", text: "Who took the coin?", values: people.map((_, i) => i), labels: people, fix: (v) => ({ taker: v }) });
      qs.push({ id: "when", text: "In which time slot was it taken?", values: [...Array(T).keys()], labels: TICKS.slice(0, T), fix: (v) => ({ takeT: v }) });
      const locQs = [];
      const cells = rng.shuffle([...Array(P * T).keys()]).slice(0, 10);
      for (const c of cells) { const p = Math.floor(c / T), t = c % T; locQs.push({ id: `loc${p}-${t}`, text: `Where was ${people[p]} at ${TICKS[t]}?`, values: [0, 1, 2], labels: PLACES, fix: (v) => ({ loc: [[p * T + t, v]] }), p, t }); }
      for (const q of qs) q.possible = readOff(q);
      if (qs[1].possible.length > 3) continue;
      if (tier.liar) {
        /* -1 (none) is possible only if the full record is consistent; a statement is a possible liar only if dropping it is viable */
        /* "none" is gone: exactly one is false, so it is never an answer */
        const vals = stmts.map((_, i) => i);
        const labels = stmts.map((st, i) => `${people[st.w]} #${stmts.filter((x, j) => x.w === st.w && j < i).length + 1}`);
        qs.push({ id: "liar", text: "Which statement is false?", values: vals, labels, possible: drops.filter((d) => d >= 0), fix: null, isLiar: true });
        /* drops now means 'could actually BE the false one', not 'is removable' */
      }
      for (const q of locQs) q.possible = readOff(q);
      const det = locQs.filter((q) => q.possible.length === 1), und = locQs.filter((q) => q.possible.length > 1);
      const want = tier.questions - 2;
      const pickDet = rng.shuffle(det).slice(0, Math.ceil(want / 2)), pickUnd = rng.shuffle(und).slice(0, want - pickDet.length);
      const chosenLoc = rng.shuffle([...pickDet, ...pickUnd]);
      if (chosenLoc.length < want - 1) continue;
      const questions = [...qs, ...chosenLoc];
      if (GATE.on) {
        const settled = questions.filter((q) => q.possible.length === 1).length;
        if (!(settled / questions.length > GATE.minSettled)) continue;
      }
      /* ensure the record is interesting: at least one location question is settled only by combining witnesses */
      const grouped = people.map((_, w) => stmts.filter((s) => s.w === w));
      return { tier, seed, people, P, T, truth, stmts, grouped, falseIdx, questions, attempts: attempt + 1 };
    }
    return null;
  }

  const labelFor = (q, v) => q.labels[v];

  function score(G, answers) {
    const rows = G.questions.map((q) => {
      const a = answers[q.id];
      const settled = q.possible.length === 1;
      const truthVal = q.id === "taker" ? G.truth.taker : q.id === "when" ? G.truth.takeT : q.id === "liar" ? G.falseIdx : G.truth.loc[q.p * G.T + q.t];
      let verdict, ok;
      if (a === undefined) { verdict = "no answer"; ok = false; }
      else if (a === "und") { ok = !settled; verdict = settled ? `missed: the record settles it (${labelFor(q, q.possible[0])})` : "correct: not determined"; }
      else { ok = settled && a === q.possible[0]; verdict = settled ? (ok ? "correct" : `wrong: the record says ${labelFor(q, q.possible[0])}`) : (a === truthVal ? "asserted what the record does not settle (it happened to be true)" : "asserted what the record does not settle (and it was false)"); }
      return { q, a, ok, verdict, settled };
    });
    return { rows, correct: rows.filter((r) => r.ok).length, total: rows.length };
  }

  const SEMANTICS = new Map([
    ["selfAt",    `"At T I was in the R." = the speaker was in R during slot T.`],
    ["sawWith",   `"At T X was in the R with me." = the speaker was in R at T, and X was in R at T. Both parts are asserted.`],
    ["notThere",  `"X was not in the R at T; I was there and would have seen them." = the speaker was in R at T, and X was not in R at T. Both parts are asserted; if the speaker was elsewhere, the statement is false.`],
    ["alone",     `"At T I was alone in the R." = the speaker was in R at T, and no one else was.`],
    ["stayed",    `"I was in the R from T1 through T2." = the speaker was in R during every slot from T1 to T2 inclusive.`],
    ["moved",     `"I went from the R1 at T to the R2 at T+1." = the speaker was in R1 at T and in R2 at the next slot.`],
    ["coinSeen",  `"At T the coin was still on the study desk." = the speaker was in the study at T, and the coin was taken in a later slot than T.`],
    ["coinGone",  `"At T the study desk was empty; the coin was gone." = the speaker was in the study at T, and the coin was taken at T or earlier.`],
    ["sawTake",   `"At T I saw X take the coin from the desk." = the speaker and X were both in the study at T, X is the taker, and T is the slot of the taking.`],
    ["empty",     `"The R was empty at T." = nobody at all was in R during slot T. It says nothing about where the speaker was.`],
    ["together",  `"At T X and Y were in the same room." = X and Y were in one room at T, and it does not say which.`],
    ["apart",     `"At T X and Y were not in the same room." = X and Y were in different rooms at T, and it does not say which.`],
    ["neverIn",   `"X was never in the R." = X was in some other room during every slot.`],
    ["stayedPut", `"I did not change rooms between T1 and T2." = the speaker was in one room for every slot from T1 to T2, and it does not say which.`],
    ["changed",   `"X changed rooms between T and T+1." = X was in different rooms in those two slots, and it does not say which.`],
  ]);

  function legendFor(stmts, liar) {
    const seen = [];
    for (const s of stmts) if (!seen.includes(s.type)) seen.push(s.type);
    const missing = seen.filter((t) => !SEMANTICS.has(t));
    if (missing.length) throw new Error("statement form with no legend entry: " + missing.join(", "));
    const out = [...SEMANTICS.keys()].filter((t) => seen.includes(t)).map((t) => SEMANTICS.get(t));
    if (liar) out.push(`A false statement is false as a whole: at least one of its parts fails. Nothing else can be inferred from it.`);
    return out;
  }

  function slotsTouched(s, T) {
    if (s.t === undefined) return [];
    if (s.t2 !== undefined) { const o = []; for (let t = s.t; t <= Math.min(s.t2, T - 1); t++) o.push(t); return o; }
    if (s.type === "moved") return s.t + 1 < T ? [s.t, s.t + 1] : [s.t];
    return [s.t];
  }

  const SPEAKER_FREE = new Set(["empty", "together", "apart", "neverIn", "changed"]);
  function propKey(s) {
    /* sawWith is not speaker-free, but it is SYMMETRIC: "X was in R with me" from
       w asserts {w in R, X in R}, and the same sentence from X asserts the same
       pair, so the two are one proposition even though both name their speaker.
       Keying only the speaker-free forms missed them on 10.5% of Open boards.
       notThere is NOT symmetric — {speaker in R, X not in R} differs by role —
       and alone can be truthfully uttered by only one person per room and slot. */
    if (s.type === "sawWith")
      return `sawWith|${Math.min(s.w, s.p)},${Math.max(s.w, s.p)}|${s.x}|${s.t}`;
    if (!SPEAKER_FREE.has(s.type)) return null;
    switch (s.type) {
      case "empty":    return `empty|${s.x}|${s.t}`;
      case "together":
      case "apart":    return `${s.type}|${Math.min(s.p, s.p2)},${Math.max(s.p, s.p2)}|${s.t}`;
      case "neverIn":  return `neverIn|${s.p}|${s.x}`;
      case "changed":  return `changed|${s.p}|${s.t}`;
    }
  }

  function puzzleText(G) {
    const L = [`Witness — ${G.tier.label}.`, "",
      `A house with three rooms: kitchen, study, garden. ${G.P} people were in it from ${TICKS[0]} to ${TICKS[G.T - 1]}, in ${G.T} ten-minute slots. Each person was in exactly one room during each slot. A coin sat on the study desk; at some slot it was taken by someone who was in the study then. Before that slot it was on the desk; from that slot on it was gone.`,
      G.tier.liar ? "Reliability: exactly one statement in this record is false. You are not told which." : "Reliability: every statement is true.",
      "", "How to read statements (each form asserts exactly this, and only the forms used below are listed):", ...legendFor(G.stmts, G.tier.liar).map((x) => "  " + x),
      "", "Statements:"];
    G.people.forEach((name, w) => { L.push(`${name}:`); G.grouped[w].forEach((s, i) => L.push(`  ${name} #${i + 1}: ${s.text}`)); });
    L.push("", "Questions. Answer each with one option, or UNDETERMINED if the record does not settle it. Both kinds of answer are graded: asserting what is not settled counts against you, and so does calling settled things undetermined.");
      /* The options a player is offered come from the question's own labels, not
       from a sentence written beside them. The hardcoded version still offered
       "none" after the exactly-one rule removed it, and gave an example naming a
       witness who need not be in this cast — the model and the text disagreeing
       about the rule, in the line a player actually reads. */
    G.questions.forEach((q, i) => L.push(`  Q${i + 1}. ${q.text}  [${q.isLiar ? `a statement by witness and number, e.g. ${q.labels[0]}` : q.labels.join(" / ")} / undetermined]`));
    return L.join("\n");
  }

  function keyText(G) {
    const L = [`Witness — ${G.tier.label} — seed ${G.seed}`, "", "What actually happened:"];
    for (let t = 0; t < G.T; t++) L.push(`  ${TICKS[t]}: ` + G.people.map((n, p) => `${n} in ${PLACES[G.truth.loc[p * G.T + t]]}`).join(", ") + (t === G.truth.takeT ? `  ← ${G.people[G.truth.taker]} takes the coin` : ""));
    L.push("", G.falseIdx >= 0 ? `The false statement: ${G.people[G.stmts[G.falseIdx].w]}: "${G.stmts[G.falseIdx].text}"` : "No statement is false.");
    L.push("", "Answers (what the record settles under the stated model):");
    G.questions.forEach((q, i) => L.push(`  Q${i + 1}. ${q.text}  ${q.possible.length === 1 ? labelFor(q, q.possible[0]) : "UNDETERMINED (possible: " + q.possible.map((v) => labelFor(q, v)).join(", ") + ")"}`));
    return L.join("\n");
  }

  /* ---------------- UI ----------------
     Everything above is the generator. Everything below is this site's
     interface. The boundary is load-bearing: llms.txt names this banner as the
     split for a reader that runs JavaScript but has no DOM, so the lines between
     the opening `(function () {` and this comment are a module on their own. */

  const TEMPLATE = `
    <div class="ctl">
      <input type="text" id="wt-seed" aria-label="Seed">
      <button type="button" id="wt-use">Use seed</button>
      <button type="button" id="wt-roll">New morning</button>
    </div>
    <h2>Witness</h2>
    <p class="note" style="margin-top:6px">Four people were in a house for forty minutes. A coin went missing. Each of them tells you what they saw. Work out what the accounts settle &mdash; and what they leave open, because <em>undetermined</em> is a real answer here and claiming more than the record carries counts against you.</p>
    <p class="note" id="wt-tier"></p>
    <p class="note" id="wt-fail" hidden></p>

    <div id="wt-board">
      <h3>The morning</h3>
      <p class="note" id="wt-premise"></p>

      <h3>How to read a statement</h3>
      <p class="note">Each form asserts exactly what is written here and nothing more. Only the forms this record actually uses are listed.</p>
      <ul class="note" id="wt-legend"></ul>

      <h3>The accounts</h3>
      <div id="wt-accounts"></div>

      <h3>Questions</h3>
      <p class="note">Both kinds of answer are graded. Asserting something the record does not settle counts against you, and so does calling a settled thing undetermined. There is no partial credit inside a question and no penalty for thinking about it for a while &mdash; nothing here is timed, and nothing records what you chose.</p>
      <div id="wt-questions"></div>
      <p class="note" style="margin-top:12px">Or write the whole answer in one line, the way the record's own text asks for it: a value per question in order, separated by spaces or commas, with <code>-</code> for undetermined. This fills in the rows above.</p>
      <div class="ctl">
        <input type="text" id="wt-bulk" aria-label="Whole answer" placeholder="Hal 9:30 kitchen - study -">
        <button type="button" id="wt-bulkgo">Answer</button>
      </div>
      <div class="ctl" style="margin-top:12px">
        <button type="button" id="wt-check">Check</button>
      </div>
      <div id="wt-verdict"></div>
      <p class="note" id="wt-doornote" hidden></p>

      <h3>What happened</h3>
      <p class="note">Checking and looking are two different acts, and this button is the second one. Nothing records whether you pressed it.</p>
      <div class="ctl">
        <button type="button" id="wt-reveal">Reveal the morning</button>
      </div>
      <div id="wt-key" hidden>
        <textarea id="wt-keytext" readonly></textarea>
      </div>

      <h3>The record as text</h3>
      <p class="note">The record exactly as it stands, for handing to something that reads text rather than pages. Seed <em id="wt-seedecho"></em> regenerates it, and the address bar already holds the link.</p>
      <textarea id="wt-text" readonly></textarea>
    </div>
  `;

  const root = document.getElementById("witness");
  if (!root) return;
  root.className = "wt";
  root.innerHTML = TEMPLATE;

  const el = (id) => root.querySelector("#" + id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const seedInput = el("wt-seed"), tierEl = el("wt-tier"), failEl = el("wt-fail"),
    boardEl = el("wt-board"), premiseEl = el("wt-premise"), legendEl = el("wt-legend"),
    accountsEl = el("wt-accounts"), questionsEl = el("wt-questions"),
    bulkInput = el("wt-bulk"), bulkBtn = el("wt-bulkgo"), checkBtn = el("wt-check"),
    verdictEl = el("wt-verdict"), doorNote = el("wt-doornote"), revealBtn = el("wt-reveal"),
    keyEl = el("wt-key"), keyTextEl = el("wt-keytext"), textEl = el("wt-text"),
    seedEcho = el("wt-seedecho");

  const state = { G: null, tier: "open", answers: {}, checked: false, revealed: false };

  /* ---------------- addressable records ----------------
     ?seed=... names a morning, and ?answers=... plays a whole turn in one fetch
     for a reader that can request a page and execute it but cannot type into
     one. Both are read once at load and the answer is deleted in toUrl(), so a
     shared link carries a record rather than somebody's answer. There is no
     endpoint behind any of this: grading is score(), in the page. */
  const URL_MODE = "mode", URL_SEED = "seed", URL_ANSWERS = "answers", URL_REVEAL = "reveal";

  /* `mode` is read even though Open is the only tier built, because every
     machine here takes mode and seed and arcade.html says so. An unrecognised
     value falls back rather than throwing, which is also what makes a link
     minted now keep working when a second tier arrives. */
  function tierKeyFor(raw) {
    const k = String(raw || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(TIERS, k) ? k : "open";
  }

  function fromUrl() {
    let p;
    try { p = new URLSearchParams(location.search); } catch { return {}; }
    return { mode: p.get(URL_MODE), seed: p.get(URL_SEED), answers: p.get(URL_ANSWERS), reveal: p.get(URL_REVEAL) };
  }

  function toUrl(mode, seed) {
    let p;
    try { p = new URLSearchParams(location.search); } catch { return; }
    p.set(URL_MODE, mode);
    p.set(URL_SEED, seed);
    p.delete(URL_ANSWERS);
    p.delete(URL_REVEAL);
    try { history.replaceState(null, "", location.pathname + "?" + p.toString()); } catch { /* file:// */ }
  }

  /* A front-door refusal is written, not flashed. The reader this door exists
     for fetches, executes and reads the DOM once; a message that clears itself
     after three seconds is a refusal nobody receives. */
  function door(msg) {
    doorNote.textContent = msg;
    doorNote.hidden = !msg;
  }

  /* ---------------- answering ----------------
     One parser, used by the clickable rows, the one-line box and the URL
     parameter alike. Two would drift and the strict one would be the one nobody
     exercised. It refuses rather than trims: a wrong number of values is stated,
     an unrecognised value is named back. Guessing which question a stray word
     belonged to is an edit, and this repo does not make those. */
  const UND = "und";

  function parseWhole(text, G) {
    const toks = String(text).trim().split(/[\s,;]+/).filter(Boolean);
    if (!toks.length) return { error: "Nothing to read. Give one value per question, in order." };
    if (toks.length !== G.questions.length)
      return { error: `That is ${toks.length} value${toks.length === 1 ? "" : "s"} for ${G.questions.length} questions. Give one per question, in order, with - for undetermined.` };
    const out = {};
    for (let i = 0; i < toks.length; i++) {
      const q = G.questions[i], raw = toks[i], t = raw.toLowerCase();
      if (t === "-" || t === UND || t === "undetermined" || t === "?") { out[q.id] = UND; continue; }
      const hit = q.labels.findIndex((lab) => String(lab).toLowerCase() === t);
      if (hit < 0) return { error: `Q${i + 1} does not take "${raw}". It takes ${q.labels.join(", ")}, or - for undetermined.` };
      out[q.id] = q.values[hit];
    }
    return { answers: out };
  }

  function applyAnswers(obj) {
    state.answers = obj;
    state.checked = false;
    verdictEl.textContent = "";
    verdictEl.removeAttribute("data-verdict");
    verdictEl.removeAttribute("data-score");
    renderQuestions();
  }

  /* ---------------- rendering ---------------- */

  function renderPremise() {
    const G = state.G;
    premiseEl.textContent = `A house with three rooms: ${PLACES.join(", ")}. ${G.P} people were in it from ${TICKS[0]} to ${TICKS[G.T - 1]}, in ${G.T} ten-minute slots, each in exactly one room per slot. A coin sat on the study desk; at some slot it was taken by someone who was in the study then. Before that slot it was on the desk; from that slot on it was gone.`;
    tierEl.textContent = G.tier.liar
      ? "Exactly one statement in this record is false. You are not told which."
      : "Every statement in this record is true. The work is reconciling four partial accounts, not catching anyone out.";
  }

  function renderLegend() {
    legendEl.textContent = "";
    for (const line of legendFor(state.G.stmts, state.G.tier.liar)) legendEl.appendChild(mk("li", null, line));
  }

  function renderAccounts() {
    const G = state.G;
    accountsEl.textContent = "";
    G.people.forEach((name, w) => {
      const box = mk("div", "wt-account");
      box.appendChild(mk("div", "wt-who", name));
      const list = mk("ol", "wt-said");
      /* Told in order. An account that jumps about reads as a list of facts
         rather than as somebody's morning; the generator sorts each one by slot
         and this just preserves that. */
      G.grouped[w].forEach((s) => list.appendChild(mk("li", "mono", s.text)));
      box.appendChild(list);
      accountsEl.appendChild(box);
    });
  }

  function renderQuestions() {
    const G = state.G;
    questionsEl.textContent = "";
    G.questions.forEach((q, i) => {
      const row = mk("div", "wt-q");
      row.appendChild(mk("div", "wt-qtext", `Q${i + 1}. ${q.text}`));
      const opts = mk("div", "ctl wt-opts");
      const add = (label, value) => {
        const b = mk("button", null, label);
        b.type = "button";
        if (state.answers[q.id] === value) b.className = "on";
        b.addEventListener("click", () => {
          const next = Object.assign({}, state.answers);
          if (next[q.id] === value) delete next[q.id]; else next[q.id] = value;
          applyAnswers(next);
        });
        opts.appendChild(b);
      };
      q.values.forEach((v, k) => add(String(q.labels[k]), v));
      add("undetermined", UND);
      row.appendChild(opts);
      questionsEl.appendChild(row);
    });
  }

  function renderVerdict() {
    const G = state.G;
    verdictEl.textContent = "";
    if (!state.checked) { verdictEl.removeAttribute("data-verdict"); verdictEl.removeAttribute("data-score"); return; }
    const s = score(G, state.answers);
    /* The verdict is an attribute, not a sentence. A verdict sentence is the most
       rewordable thing on a page; this is a promise about a name and a small
       closed vocabulary instead. Witness grades several questions, so it carries
       three values rather than two, plus the tally as its own attribute.
       llms.txt names all of it. */
    const kind = s.correct === s.total ? "correct" : s.correct === 0 ? "wrong" : "partial";
    verdictEl.setAttribute("data-verdict", kind);
    verdictEl.setAttribute("data-score", s.correct + "/" + s.total);
    verdictEl.appendChild(mk("p", "wt-tally", `${s.correct} of ${s.total} questions answered as the record has them.`));
    const list = mk("ol", "wt-rows");
    s.rows.forEach((r, i) => {
      const li = mk("li", r.ok ? "wt-ok" : "wt-no");
      li.textContent = `Q${i + 1}. ${r.verdict}`;
      list.appendChild(li);
    });
    verdictEl.appendChild(list);
    verdictEl.appendChild(mk("p", "note", "Nothing about this is recorded. The key is below when you want it."));
  }

  function renderKey() {
    keyEl.hidden = !state.revealed;
    keyTextEl.value = state.revealed ? keyText(state.G) : "";
  }

  function paint() {
    const G = state.G;
    boardEl.hidden = false;
    failEl.hidden = true;
    seedInput.value = G.seed;
    seedEcho.textContent = G.seed;
    renderPremise();
    renderLegend();
    renderAccounts();
    renderQuestions();
    renderVerdict();
    renderKey();
    textEl.value = puzzleText(G);
  }

  /* ---------------- generation, deferred past a paint ----------------
     Open builds in well under a millisecond, so the wait is imperceptible — but
     the deferral is kept because a front door that ran on the line after this
     would read a null board, and because the tiers with a false statement in
     them are not this cheap. `then` fires once state exists. */
  function regenerate(seed, then) {
    failEl.hidden = true;
    setTimeout(() => {
      let G = null;
      try { G = generate(seed, state.tier); } catch { G = null; }
      if (!G) {
        boardEl.hidden = true;
        failEl.hidden = false;
        failEl.textContent = "No record could be built for that seed. Try another.";
        state.G = null;
        if (then) then();
        return;
      }
      state.G = G;
      state.answers = {};
      state.checked = false;
      state.revealed = false;
      paint();
      toUrl(state.tier, G.seed);
      if (then) then();
    }, 0);
  }

  function newSeed() { return String(Math.floor(Math.random() * 1e9)); }

  el("wt-use").addEventListener("click", () => {
    const s = seedInput.value.trim();
    if (s) regenerate(s);
  });
  el("wt-roll").addEventListener("click", () => regenerate(newSeed()));
  seedInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { const s = seedInput.value.trim(); if (s) regenerate(s); } });

  checkBtn.addEventListener("click", () => {
    if (!state.G) return;
    state.checked = true;
    renderVerdict();
  });

  bulkBtn.addEventListener("click", () => {
    if (!state.G) return;
    const r = parseWhole(bulkInput.value, state.G);
    if (r.error) { door(r.error); return; }
    door("");
    applyAnswers(r.answers);
  });

  revealBtn.addEventListener("click", () => {
    if (!state.G) return;
    state.revealed = true;
    renderKey();
  });

  /* ---------------- the front door ----------------
     One fetch plays a turn: ?seed=...&answers=... answers every question and
     grades it, ?reveal=1 opens the key. Read once, acted on once, deleted from
     the address bar. */
  const from = fromUrl();
  state.tier = tierKeyFor(from.mode);
  regenerate(from.seed && from.seed.trim() ? from.seed.trim() : newSeed(), () => {
    if (!state.G) return;
    if (from.answers) {
      const r = parseWhole(from.answers, state.G);
      if (r.error) { door(r.error); }
      else { applyAnswers(r.answers); state.checked = true; renderVerdict(); }
    }
    if (from.reveal && /^(1|y|yes|true)$/i.test(from.reveal)) { state.revealed = true; renderKey(); }
  });
})();
