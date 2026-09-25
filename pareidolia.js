/* Pareidolia — ported from the React original to plain JS. No build step.
   Mounts into #pareidolia.

   The logic below the UI divider is the original's, extracted mechanically and
   left alone; only the interface was rewritten as DOM construction.
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
  function hashSeed(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function makeRng(seed) {
    const f = mulberry32(hashSeed(seed));
    return { next: f, int: (n) => Math.floor(f() * n), pick: (a) => a[Math.floor(f() * a.length)], chance: (p) => f() < p,
      shuffle: (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; } };
  }

  /* ---------------- universe ---------------- */
  const SYM = ["A", "B", "C", "D"];
  const LEN = 5;
  const UNIVERSE = [];
  (function build(prefix) { if (prefix.length === LEN) { UNIVERSE.push(prefix); return; } for (const s of SYM) build(prefix + s); })("");
  const ORD = ["first", "second", "third", "fourth", "fifth"];
  const show = (item) => item.split("").join(" ");

  /* ---------------- rule language ---------------- */
  function atoms() {
    const R = [];
    const count = (it, x) => it.split(x).length - 1;
    for (const x of SYM) {
      for (const k of [1, 2, 3]) R.push({ text: `contains at least ${k} ${x}`, fn: (it) => count(it, x) >= k });
      for (const k of [0, 1, 2]) R.push({ text: `contains exactly ${k} ${x}`, fn: (it) => count(it, x) === k });
      R.push({ text: `starts with ${x}`, fn: (it) => it[0] === x });
      R.push({ text: `ends with ${x}`, fn: (it) => it[LEN - 1] === x });
      R.push({ text: `the number of ${x} is even (zero counts)`, fn: (it) => count(it, x) % 2 === 0 });
      for (let i = 0; i < LEN; i++) R.push({ text: `the ${ORD[i]} symbol is ${x}`, fn: (it) => it[i] === x });
      for (const y of SYM) if (y !== x) {
        R.push({ text: `some ${x} comes before some ${y}`, fn: (it) => { const i = it.indexOf(x), j = it.lastIndexOf(y); return i >= 0 && j >= 0 && i < j; } });
        R.push({ text: `more ${x} than ${y}`, fn: (it) => count(it, x) > count(it, y) });
        R.push({ text: `${x} and ${y} are adjacent somewhere (either order)`, fn: (it) => it.includes(x + y) || it.includes(y + x) });
      }
    }
    R.push({ text: "the first and last symbols are the same", fn: (it) => it[0] === it[LEN - 1] });
    R.push({ text: "no two adjacent symbols are the same", fn: (it) => { for (let i = 1; i < LEN; i++) if (it[i] === it[i - 1]) return false; return true; } });
    R.push({ text: "reads the same backwards", fn: (it) => it === it.split("").reverse().join("") });
    R.push({ text: "uses all four symbols", fn: (it) => SYM.every((s) => it.includes(s)) });
    R.push({ text: "uses at most two different symbols", fn: (it) => new Set(it).size <= 2 });
    return R;
  }
  const ext = (fn) => { let s = ""; for (const it of UNIVERSE) s += fn(it) ? "1" : "0"; return s; };
  function buildLanguage(level) {
    const A = atoms().map((r) => ({ ...r, ext: ext(r.fn), cx: 1 }));
    const seen = new Set(); const uniq = [];
    for (const r of A) if (!seen.has(r.ext)) { seen.add(r.ext); uniq.push(r); }
    let rules = uniq;
    if (level >= 2) {
      const nots = uniq.map((r) => ({ text: `not (${r.text})`, fn: (it) => !r.fn(it), ext: r.ext.replace(/[01]/g, (c) => (c === "1" ? "0" : "1")), cx: 2 }));
      rules = [...uniq, ...nots.filter((r) => !seen.has(r.ext) && (seen.add(r.ext), true))];
    }
    if (level >= 3) {
      const comp = [];
      for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i], b = uniq[j];
        let and = "", or = "";
        for (let k = 0; k < a.ext.length; k++) { const x = a.ext[k] === "1", y = b.ext[k] === "1"; and += x && y ? "1" : "0"; or += x || y ? "1" : "0"; }
        if (!seen.has(and)) { seen.add(and); comp.push({ text: `(${a.text}) and (${b.text})`, fn: (it) => a.fn(it) && b.fn(it), ext: and, cx: 3 }); }
        if (!seen.has(or)) { seen.add(or); comp.push({ text: `(${a.text}) or (${b.text})`, fn: (it) => a.fn(it) || b.fn(it), ext: or, cx: 3 }); }
      }
      rules = [...rules, ...comp];
    }
    return rules;
  }
  const LANG_CACHE = {};
  const language = (level) => (LANG_CACHE[level] || (LANG_CACHE[level] = buildLanguage(level)));

  /* ---------------- tiers ---------------- */
  const TIERS = {
    open: { label: "Open", level: 1, examples: 14, maxExamples: 22, probes: 0, tests: 10, decoy: false,
      blurb: "Fourteen labelled strings, no probing. A rule is a single statement from the list. Decide, then prove it by labelling ten more." },
    probe: { label: "Probe", level: 2, examples: 6, maxExamples: 12, probes: 6, tests: 10, decoy: false, maxSurvivors: 24,
      blurb: "Six labelled strings and six probes. Rules may be a statement or its negation. Rule boards can be pinned down within the budget; noise boards may leave a rule standing, and the last call can be a judgment." },
    hell: { label: "Hell", level: 3, examples: 8, maxExamples: 16, probes: 4, tests: 10, decoy: true, maxSurvivors: 6,
      blurb: "Eight strings, four probes, and rules may combine two statements with and/or. Noise boards are built to almost fit a simple rule, and a false rule can survive every probe." },
  };

  /* ---------------- generation ---------------- */
  function consistent(rules, exs) {
    return rules.filter((r) => exs.every((e) => r.fn(e.item) === e.label));
  }
  function splitter(rng, survivors, used) {
    let best = null, bestScore = -1;
    for (let t = 0; t < 250; t++) {
      const it = rng.pick(UNIVERSE); if (used.has(it)) continue;
      const idx = UNIVERSE.indexOf(it);
      let ones = 0; for (const r of survivors) if (r.ext[idx] === "1") ones++;
      const score = Math.min(ones, survivors.length - ones);
      if (score > bestScore) { bestScore = score; best = it; }
    }
    return best;
  }
  /* decision tree: can the survivors be reduced to at most one within `budget`
     probes in EVERY answer branch? Greedy choice of the most-splitting string at
     each node, with a few alternatives tried before giving up. */
  function treeResolves(surv, budget, rng, depth = 0) {
    if (surv.length <= 1) return true;
    if (budget === 0) return false;
    const cands = [];
    for (let t = 0; t < 4; t++) {
      const it = splitter(rng, surv, new Set(cands)); if (it) cands.push(it);
    }
    for (const it of cands) {
      const i = UNIVERSE.indexOf(it);
      const yes = surv.filter((r) => r.ext[i] === "1"), no = surv.filter((r) => r.ext[i] === "0");
      if (!yes.length || !no.length) continue;
      if (treeResolves(yes, budget - 1, rng, depth + 1) && treeResolves(no, budget - 1, rng, depth + 1)) return true;
    }
    return false;
  }
  /* greedy adaptive prober: always asks the string that best splits the survivors.
     Unused by generate() — kept because it is part of the original. */
  function proberSettles(rules, exs, budget, labelFn, wantRuleExt) {
    let surv = consistent(rules, exs);
    const seen = [...exs]; const used = new Set(exs.map((e) => e.item));
    const r = makeRng("prober|" + exs.map((e) => e.item).join(""));
    for (let k = 0; k < budget; k++) {
      if (wantRuleExt ? surv.length <= 1 : surv.length === 0) break;
      const it = splitter(r, surv, used); if (!it) break;
      used.add(it); const e = { item: it, label: labelFn(it) }; seen.push(e);
      surv = surv.filter((x) => x.fn(it) === e.label);
    }
    return wantRuleExt ? surv.length === 1 && surv[0].ext === wantRuleExt : surv.length === 0;
  }
  function generate(seed, tierKey) {
    const tier = TIERS[tierKey];
    const rng = makeRng(seed + "|" + tierKey);
    const rules = language(tier.level);
    const noise = rng.chance(0.5);
    const interactive = tier.probes > 0;
    /* A noise board's labels must not be a rule. They were: see the note on
       noiseLabel() below. Both call sites build the same string and must stay
       in agreement, or a probe would contradict a labelled example. */
    const nz = (it) => makeRng(seed + "|" + tier.label + "|" + it).next() < 0.5;
    for (let attempt = 0; attempt < 60; attempt++) {
      const used = new Set(); const exs = [];
      const add = (item, label) => { used.add(item); exs.push({ item, label }); };
      const finish = (rule) => {
        const tests = []; while (tests.length < tier.tests) { const it = rng.pick(UNIVERSE); if (!used.has(it)) { used.add(it); tests.push(it); } }
        return { tier, seed, noise: !rule, rule, examples: rng.shuffle(exs), tests, testLabels: rule ? tests.map((it) => rule.fn(it)) : null, attempts: attempt + 1, survivorsAtStart: consistent(rules, exs).length };
      };
      if (!noise) {
        const rule = rng.pick(rules.filter((r) => { const p = (r.ext.match(/1/g) || []).length / r.ext.length; return p > 0.2 && p < 0.8; }));
        const pos = UNIVERSE.filter((it) => rule.fn(it)), neg = UNIVERSE.filter((it) => !rule.fn(it));
        for (let i = 0; i < tier.examples; i++) { const it = i % 2 ? rng.pick(neg) : rng.pick(pos); if (used.has(it)) { i--; continue; } add(it, rule.fn(it)); }
        let ok = false;
        while (exs.length <= tier.maxExamples) {
          const surv = consistent(rules, exs);
          if (!interactive) { const others = surv.filter((r) => r.ext !== rule.ext); if (!others.length) { ok = true; break; } const it = splitter(rng, others, used); if (!it) break; add(it, rule.fn(it)); continue; }
          if (surv.length <= tier.maxSurvivors) { ok = surv.length >= 2 && treeResolves(surv, tier.probes, makeRng("tree|" + seed + attempt)); break; }
          const it = splitter(rng, surv, used); if (!it) break; add(it, rule.fn(it));
        }
        if (!ok) continue;
        return finish(rule);
      }
      /* noise: a fixed random labelling of every string; the examples are drawn from it */
      if (tier.decoy) {
        const decoy = rng.pick(rules.filter((r) => r.cx === 1));
        const agree = UNIVERSE.filter((it) => decoy.fn(it) === nz(it)), disagree = UNIVERSE.filter((it) => decoy.fn(it) !== nz(it));
        const a1 = agree.filter((it) => nz(it)), a0 = agree.filter((it) => !nz(it));
        if (a1.length < 4 || a0.length < 4 || !disagree.length) continue;
        for (let i = 0; i < tier.examples - 1; i++) { const it = i % 2 ? rng.pick(a0) : rng.pick(a1); if (used.has(it)) { i--; continue; } add(it, nz(it)); }
        const d = rng.pick(disagree); if (used.has(d)) continue; add(d, nz(d));
      } else {
        const ones = UNIVERSE.filter(nz), zeros = UNIVERSE.filter((it) => !nz(it));
        for (let i = 0; i < tier.examples; i++) { const it = i % 2 ? rng.pick(zeros) : rng.pick(ones); if (used.has(it)) { i--; continue; } add(it, nz(it)); }
      }
      let ok = false;
      while (exs.length <= tier.maxExamples) {
        const surv = consistent(rules, exs);
        if (!interactive) { if (!surv.length) { ok = true; break; } }
        else if (surv.length <= tier.maxSurvivors) { ok = surv.length >= 1; break; }
        const it = splitter(rng, surv, used); if (!it) break; add(it, nz(it));
      }
      if (!ok) continue;
      return finish(null);
    }
    return null;
  }
  /* Probe labels on a noise board: pseudorandom, fixed per item, and — this is
     the part that was wrong — not a rule.

     This read `hashSeed(...) % 2 === 0`, and that is a parity function rather
     than a coin. FNV-1a is h = (h XOR byte) * 16777619; 16777619 is odd, and
     multiplying by an odd number leaves the low bit untouched, so the low bit
     of the finished hash is just the XOR of the low bits of every input byte.
     'A' and 'C' are odd, 'B' and 'D' are even, so %2 of that hash is a
     seed-and-tier constant XOR the parity of how many A and C the string has.

     Every noise board was therefore labelled by exactly one rule — "the number
     of symbols from {A, C} is even", possibly flipped — which is the one thing
     a noise board must not be. It is the game's negative control, and the
     control had a rule in it. Measured before the fix: parity explained the
     labelling on 1200 of 1200 (seed, tier) pairs with no exceptions, every
     board split 512/512 over the 1024 strings, and knowing only that fact
     answered rule-versus-noise on 599 of 600 boards with zero probes spent.

     Any bit above the lowest would do, because the carries in the multiply
     destroy the linearity. mulberry32 is used instead so that the reason it
     is sound is the mixing function rather than an argument about which bit
     is safe. Found by Marco (marcologs.com), third audit. */
  const noiseLabel = (G, item) => makeRng(G.seed + "|" + G.tier.label + "|" + item).next() < 0.5;
  const labelOf = (G, item) => (G.noise ? noiseLabel(G, item) : G.rule.fn(item));
  /* how informative a probe was, judged against the rule language: of the rules
     still consistent with everything seen before it, how many did it split? */
  function probeQuality(G, priorProbes, item) {
    const seen = [...G.examples, ...priorProbes];
    const surv = consistent(language(G.tier.level), seen);
    const idx = UNIVERSE.indexOf(item);
    let ones = 0; for (const r of surv) if (r.ext[idx] === "1") ones++;
    const split = Math.min(ones, surv.length - ones);
    return { remaining: surv.length, split, kind: surv.length === 0 ? "after noise was established" : split === 0 ? (surv.length === 1 ? "tests the last hypothesis" : "tests all survivors at once") : "splits survivors" };
  }

  /* ---------------- text protocol ---------------- */
  function grammarText(level) {
    const lines = ["A rule is one statement about a string of five symbols from A, B, C, D. The statements a rule can be built from:",
      "  contains at least k X (k is 1, 2 or 3) / contains exactly k X (k is 0, 1 or 2); starts with X; ends with X; the number of X is even (zero counts); the Nth symbol is X;",
      "  some X comes before some Y (first X before last Y); more X than Y; X and Y are adjacent in either order (X and Y must be different symbols);",
      "  first and last symbols are the same; no two adjacent symbols are the same;",
      "  reads the same backwards; uses all four symbols; uses at most two different symbols.",
      "Rules are counted by what they do, not by how they are worded: two statements that agree on all 1024 strings are one rule here. 'starts with A' and 'the first symbol is A' are the same rule, and so is any combination that reduces to a rule you already have."];
    if (level === 2) lines.push("A rule may also be the negation of one statement.");
    if (level === 3) lines.push("A rule may also be the negation of one statement, or two plain statements joined by 'and' or 'or' (neither part negated).");
    lines.push("A NOISE board is one whose labels were assigned by a coin flipped from the seed rather than by a rule, so no rule in this language fits them all." + (level === 1 ? " On this tier the labelled strings alone are enough to decide either way; the generator has verified this." : " Half of all boards are noise. On this tier, noise boards are sampled so that at least one rule survives the labelled strings, and probe answers come from the same coin: pseudorandom, and fixed per string."));
    if (level > 1) lines.push("What is guaranteed: on a RULE board, a strategy exists that reduces the candidates to one within the probe budget, whatever the answers. What is not: a noise board can leave one rule fitting everything you have seen, and no strategy can promise to expose it. If you end with one rule standing, the final call is a judgment, and the game is whether you make it well over many boards.");
    if (level > 1) lines.push(`How much to trust a lone survivor: if N rules are consistent with the labelled strings and you separate them all and spend every probe, a noise board can only match one of N answer patterns out of 2^${level === 3 ? 4 : 6}. So a rule that survives everything is a coincidence with probability about N/${level === 3 ? 16 : 64} (at even odds between rule and noise boards). Counting N is up to you. Candidates that agree on all ten target strings need not be separated; only their answers on the targets matter.`);
    if (level > 1) lines.push(`How boards are sampled, so the odds are computable: a fair coin picks rule or noise. Rule boards: a rule is drawn uniformly from the language (restricted to rules true of 20-80% of all strings), examples are drawn half fitting and half not, and the board is kept only if between 2 and ${level === 3 ? 6 : 24} rules survive the examples and a decision tree within the budget can separate them. Noise boards: every string gets a fixed random label, examples are drawn ${level === 3 ? "to agree with one randomly chosen simple statement on all but one string" : "half ✓ and half ✗"}, and the board is kept only if between 1 and ${level === 3 ? 6 : 24} rules survive. Both kinds carry the same ceiling, so a count above ${level === 3 ? 6 : 24} is never evidence of noise: it means you are counting in a wider language than this one, most often by counting equivalent phrasings separately. Rejected boards are redrawn.`);
    return lines;
  }
  function puzzleText(G, probes) {
    const L = [`Pareidolia — ${G.tier.label}.`, "", ...grammarText(G.tier.level), "", "Labelled strings (✓ fits the rule, ✗ does not):"];
    G.examples.forEach((e, i) => L.push(`${String(i + 1).padStart(2)}. ${show(e.item)}   ${e.label ? "✓" : "✗"}`));
    if (G.tier.probes) {
      L.push("", `Probes: you may ask for the label of up to ${G.tier.probes} strings of your choice (${G.tier.probes - probes.length} left). Reply "PROBE X X X X X".`);
      if (probes.length) { L.push("Probe results:"); probes.forEach((p) => L.push(`    ${show(p.item)}   ${p.label ? "✓" : "✗"}`)); }
    }
    L.push("", "When ready, answer one of:", `  NOISE`, `  RULE, followed by ✓ or ✗ for each of these ten strings, in order:`);
    G.tests.forEach((t, i) => L.push(`    ${String.fromCharCode(97 + i)}. ${show(t)}`));
    L.push("", "A RULE answer counts only if all ten labels are correct. On a noise board the only correct answer is NOISE.");
    return L.join("\n");
  }
  function probeLog(G, probes) {
    if (!probes.length) return [];
    const L = ["Probe log (rules still consistent before the probe / how many it split):"];
    probes.forEach((p, i) => L.push(`  p${i + 1} ${show(p.item)} ${p.label ? "✓" : "✗"}   ${p.remaining} remaining, split ${p.split}   ${p.kind}`));
    const sp = probes.filter((p) => p.kind === "splits survivors").length, joint = probes.filter((p) => p.kind === "tests all survivors at once").length, last = probes.filter((p) => p.kind === "tests the last hypothesis").length, wasted = probes.length - sp - joint - last;
    L.push(`  ${sp} split survivors, ${joint} tested all survivors at once, ${last} tested a lone surviving hypothesis, ${wasted} came after noise was already established.`);
    return L;
  }
  /* after a wrong RULE answer: strings whose true labels refute every rule still
     consistent with what the player saw, preferring the ten test strings */
  function counterexamples(G, probes) {
    let surv = consistent(language(G.tier.level), [...G.examples, ...probes]);
    const out = [];
    const pool = [...G.tests, ...UNIVERSE];
    while (surv.length && out.length < 4) {
      let best = null, bestKill = 0;
      for (const it of pool) {
        const lab = labelOf(G, it);
        const kill = surv.filter((r) => r.fn(it) !== lab).length;
        if (kill > bestKill) { bestKill = kill; best = it; if (kill === surv.length) break; }
      }
      if (!best) break;
      out.push({ item: best, label: labelOf(G, best), kills: bestKill, of: surv.length, isTest: G.tests.includes(best) });
      surv = surv.filter((r) => r.fn(best) === labelOf(G, best));
    }
    return out;
  }
  function probesText(G, probes) {
    if (!probes.length) return "No probes yet.";
    const L = [`Probe results (${G.tier.probes - probes.length} left):`];
    probes.forEach((p) => L.push(`  ${show(p.item)}   ${p.label ? "✓" : "✗"}`));
    return L.join("\n");
  }
  function keyText(G, probes) {
    probes = probes || [];
    const L = [`Pareidolia — ${G.tier.label} — seed ${G.seed}`, ""];
    if (G.noise) L.push("This board is NOISE. Labels are a fixed random labelling of every string. " + (G.tier.probes ? "At least one rule survived the labelled strings by construction; whether the probes expose it depends on which strings were asked and what the random labels happened to be. A player who ends with one rule standing has not made an error; they have a judgment to make." : "No rule fits the labelled strings."));
    else if (G.tier.probes) L.push("This is a RULE board. The generator verified a decision tree that isolates the rule within the probe budget in every answer branch.");
    else { L.push(`Rule: ${G.rule.text}`, "", "Test labels:"); G.tests.forEach((t, i) => L.push(`  ${String.fromCharCode(97 + i)}. ${show(t)}   ${G.testLabels[i] ? "✓" : "✗"}`)); }
    L.push(`Rules in the language consistent with the labelled strings before any probe: ${G.survivorsAtStart}.`);
    const pl = probeLog(G, probes); if (pl.length) L.push("", ...pl);
    if (G.noise) { const cx = counterexamples(G, probes); if (cx.length) { L.push("", "Refutation of whatever still fits everything seen:"); cx.forEach((c) => L.push(`  ${show(c.item)} is ${c.label ? "✓" : "✗"}${c.isTest ? " (test string)" : ""}: contradicts ${c.kills} of ${c.of} standing rules`)); } else if (probes.length) L.push("", "After these probes no rule in the language fits everything seen; noise was established."); }
    return L.join("\n");
  }

  /* ================= UI =================
     Everything above is the port. Everything below is this site's interface. */

  const TEMPLATE = `
    <div class="ctl">
      <input type="text" id="pd-seed" aria-label="Seed">
      <button type="button" id="pd-use">Use seed</button>
      <button type="button" id="pd-roll">New board</button>
    </div>
    <h2>Pareidolia</h2>
    <p class="note" style="margin-top:6px">Some boards follow a rule. Some are noise. Decide which, and if there is a rule, prove it by labelling ten new strings. <em>Nothing</em> is sometimes the right answer.</p>
    <div class="ctl" style="margin-top:8px" id="pd-tiers" role="group" aria-label="Tier"></div>
    <p class="note" style="margin-top:8px" id="pd-blurb"></p>
    <p class="note" id="pd-fail" hidden></p>

    <div id="pd-board">
      <h3>The rule language</h3>
      <ul class="note" id="pd-grammar"></ul>

      <h3>Labelled strings</h3>
      <div class="ex" id="pd-examples"></div>

      <section id="pd-probesec" hidden>
        <h3>Probes <span class="note" id="pd-probeleft" style="font-weight:400"></span></h3>
        <p class="note">Ask for the label of any string you like. The budget is the point: a probe that every surviving rule answers the same way tells you nothing about which one is right, but it can refute them all at once.</p>
        <div class="ctl">
          <input type="text" class="mono" id="pd-probe" aria-label="Probe string" placeholder="e.g. A B C D A" autocomplete="off">
          <button type="button" id="pd-ask">Ask</button>
        </div>
        <div class="ctl" id="pd-probecopyrow" hidden style="margin-top:8px">
          <button type="button" id="pd-probecopy">Copy probes</button><span class="note" id="pd-probecopied"></span>
        </div>
        <div class="ex probelist" id="pd-probelist"></div>
        <p class="note" id="pd-probenote" hidden></p>
      </section>

      <h3>Answer</h3>
      <p class="note">Either call it noise, or label all ten and submit as a rule. A rule answer counts only if all ten are right.</p>
      <div id="pd-tests"></div>
      <div class="ctl" style="margin-top:12px">
        <button type="button" id="pd-submit">Submit as rule</button>
        <button type="button" class="red" id="pd-noise">It's noise</button>
      </div>
      <div id="pd-result"></div>
      <p class="note" id="pd-doornote" hidden></p>

      <h3>The board as text</h3>
      <p class="note">The board in the state it is in now. For Probe and Hell, relay a model's probe requests into the box above, then hand back <em>Probes only</em> rather than the whole board again. Seed <em id="pd-seedecho"></em> at tier <span id="pd-tierecho"></span> regenerates it, and the address bar already holds a link. <em>Key + probe log</em> gives the board away — it is there when you want it, and nothing records whether you looked.</p>
      <div class="ctl" style="margin-bottom:8px" id="pd-views"></div>
      <textarea id="pd-text" readonly></textarea>
    </div>
  `;

  const root = document.getElementById("pareidolia");
  if (!root) return;
  root.className = "pd";
  root.innerHTML = TEMPLATE;

  const el = (id) => root.querySelector("#" + id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const seedInput = el("pd-seed"), tiersBox = el("pd-tiers"), blurbEl = el("pd-blurb"),
    failEl = el("pd-fail"), boardEl = el("pd-board"), grammarEl = el("pd-grammar"),
    examplesEl = el("pd-examples"), probeSec = el("pd-probesec"), probeLeftEl = el("pd-probeleft"),
    probeInput = el("pd-probe"), askBtn = el("pd-ask"), probeCopyRow = el("pd-probecopyrow"),
    probeCopiedEl = el("pd-probecopied"), probeListEl = el("pd-probelist"), probeNoteEl = el("pd-probenote"),
    testsEl = el("pd-tests"), submitBtn = el("pd-submit"), noiseBtn = el("pd-noise"),
    resultEl = el("pd-result"), viewsEl = el("pd-views"), textEl = el("pd-text"),
    seedEcho = el("pd-seedecho"), tierEcho = el("pd-tierecho");

  /* ---------------- addressable boards ----------------
     ?mode=probe&seed=77777 — a board is a link, so it can be handed to someone
     (or something) else and come back the same board. A malformed value falls
     back to the default rather than throwing. */
  const URL_MODE = "mode", URL_SEED = "seed";
  const URL_PROBE = "probe", URL_ANSWER = "answer";
  function fromUrl() {
    let p;
    try { p = new URLSearchParams(location.search); } catch { return {}; }
    const mode = (p.get(URL_MODE) || "").toLowerCase();
    const seed = p.get(URL_SEED);
    return { tierKey: TIERS[mode] ? mode : null, seed: seed || null };
  }
  function toUrl() {
    try {
      const p = new URLSearchParams(location.search);
      p.delete(URL_PROBE); p.delete(URL_ANSWER);   /* never written back: a shared link is a board, not a judgment */
      p.set(URL_MODE, state.tierKey);
      p.set(URL_SEED, state.seed);
      history.replaceState(null, "", location.pathname + "?" + p + location.hash);
    } catch { /* file:// and the like — playing still works, linking doesn't */ }
  }

  const fromLink = fromUrl();
  const state = {
    seed: fromLink.seed || String(Math.floor(Math.random() * 1e6)),
    tierKey: fromLink.tierKey || "open",
    G: null,
    probes: [],
    labels: {},
    answer: null,
    view: "puzzle",
  };

  const tierBtns = {};
  for (const [k, t] of Object.entries(TIERS)) {
    const b = mk("button", null, t.label);
    b.type = "button";
    b.addEventListener("click", () => { if (state.tierKey !== k) { state.tierKey = k; regenerate(); } });
    tierBtns[k] = b;
    tiersBox.appendChild(b);
  }

  const VIEWS = [
    ["puzzle", "Puzzle"],
    ["probes", "Probes only"],
    ["key", "Key + probe log"],
  ];
  const viewBtns = {};
  for (const [k, label] of VIEWS) {
    const b = mk("button", null, label);
    b.type = "button";
    b.addEventListener("click", () => { state.view = k; render(); });
    viewBtns[k] = b;
    viewsEl.appendChild(b);
  }
  const copyBtn = mk("button", null, "Copy");
  copyBtn.type = "button";
  const copiedEl = mk("span", "note", "");
  viewsEl.appendChild(copyBtn);
  viewsEl.appendChild(copiedEl);

  function flash(node, msg) {
    node.textContent = msg;
    setTimeout(() => { if (node.textContent === msg) node.textContent = ""; }, 3000);
  }

  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(textEl.value); flash(copiedEl, "Copied"); }
    catch { flash(copiedEl, "Select the text and copy it"); }
  });
  el("pd-probecopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(probesText(state.G, state.probes)); flash(probeCopiedEl, "Copied"); }
    catch { flash(probeCopiedEl, "Select the text and copy it"); }
  });

  /* ---------------- board construction ---------------- */

  const testBtns = [];

  function buildBoard() {
    const G = state.G;

    grammarEl.textContent = "";
    for (const line of grammarText(G.tier.level).slice(1)) grammarEl.appendChild(mk("li", null, line.trim()));

    examplesEl.textContent = "";
    G.examples.forEach((e, i) => {
      examplesEl.appendChild(mk("span", "note", (i + 1) + "."));
      examplesEl.appendChild(mk("span", "mono", show(e.item)));
      examplesEl.appendChild(mk("span", e.label ? "yes" : "no", e.label ? "✓" : "✗"));
    });

    probeSec.hidden = !G.tier.probes;

    testsEl.textContent = "";
    testBtns.length = 0;
    G.tests.forEach((t, i) => {
      const row = mk("div", "test");
      row.appendChild(mk("span", "note", String.fromCharCode(97 + i) + "."));
      row.appendChild(mk("span", "mono", show(t)));
      const ctl = mk("span", "ctl");
      const name = "String " + String.fromCharCode(97 + i) + ", " + show(t);
      const yes = mk("button", null, "✓"), no = mk("button", "red", "✗");
      yes.type = no.type = "button";
      yes.setAttribute("aria-label", name + ": fits the rule");
      no.setAttribute("aria-label", name + ": does not fit the rule");
      yes.addEventListener("click", () => { if (!state.answer) { state.labels[t] = true; render(); } });
      no.addEventListener("click", () => { if (!state.answer) { state.labels[t] = false; render(); } });
      ctl.appendChild(yes); ctl.appendChild(no);
      row.appendChild(ctl);
      testsEl.appendChild(row);
      testBtns.push({ item: t, yes, no });
    });
  }

  /* ---------------- render ---------------- */

  function render() {
    const G = state.G;
    for (const [k, b] of Object.entries(tierBtns)) b.classList.toggle("on", k === state.tierKey);
    blurbEl.textContent = TIERS[state.tierKey].blurb;
    if (!G) return;

    const done = !!state.answer;

    /* probes */
    if (G.tier.probes) {
      const left = G.tier.probes - state.probes.length;
      probeLeftEl.textContent = "(" + left + " left)";
      probeInput.disabled = askBtn.disabled = left <= 0 || done;
      probeCopyRow.hidden = state.probes.length === 0;
      probeListEl.textContent = "";
      state.probes.forEach((p, i) => {
        probeListEl.appendChild(mk("span", "note", "p" + (i + 1)));
        probeListEl.appendChild(mk("span", "mono", show(p.item)));
        probeListEl.appendChild(mk("span", p.label ? "yes" : "no", p.label ? "✓" : "✗"));
        probeListEl.appendChild(mk("span", "note quality", done ? p.kind + ": split " + p.split + " of " + p.remaining + " remaining rules" : ""));
      });
      const showNote = done && state.probes.length > 0;
      probeNoteEl.hidden = !showNote;
      if (showNote) {
        probeNoteEl.textContent = probeLog(G, state.probes).slice(-1)[0].trim() +
          " Splitting probes narrow the field; a probe every survivor agrees on can't narrow it but can refute them all at once; and a probe of the last standing hypothesis is the one that separates a rule from a coincidence. Only probes asked after every rule was already excluded are wasted. Shown only after you answer, so it can't guide the probing.";
      }
    }

    /* test labels */
    for (const { item, yes, no } of testBtns) {
      const v = state.labels[item];
      yes.classList.toggle("on", v === true);
      no.classList.toggle("on", v === false);
      yes.setAttribute("aria-pressed", String(v === true));
      no.setAttribute("aria-pressed", String(v === false));
      yes.disabled = no.disabled = done;
    }
    const allLabelled = G.tests.every((t) => state.labels[t] !== undefined);
    submitBtn.disabled = !allLabelled || done;
    noiseBtn.disabled = done;

    /* verdict */
    resultEl.textContent = "";
    if (state.answer) {
      const a = state.answer;
      resultEl.appendChild(mk("div", "verdict " + (a.ok ? "right" : "wrong"), a.verdict));
      resultEl.appendChild(mk("p", null, a.detail));
      if (!G.noise) {
        resultEl.appendChild(mk("p", "note", "Correct test labels: " +
          G.testLabels.map((l, i) => String.fromCharCode(97 + i) + (l ? "✓" : "✗")).join(" ")));
      }
      if (a.cx && a.cx.length) {
        const box = mk("div", "note");
        box.appendChild(mk("p", null, "What refutes the rules that still fit everything you saw:"));
        for (const c of a.cx) {
          const line = mk("div");
          line.appendChild(mk("span", "mono", show(c.item)));
          const tail = c.kills === c.of
            ? (c.of === 1 ? "the last standing rule" : "all " + c.of + " standing rules")
            : c.kills + " of " + c.of + " standing rules";
          line.appendChild(document.createTextNode(" is " + (c.label ? "✓" : "✗") +
            (c.isTest ? " (one of the test strings)" : "") + ", contradicting " + tail + "."));
          box.appendChild(line);
        }
        resultEl.appendChild(box);
      }
    }

    /* text protocol */
    for (const [k, b] of Object.entries(viewBtns)) b.classList.toggle("on", k === state.view);
    viewBtns.probes.disabled = !G.tier.probes;
    if (state.view === "probes" && !G.tier.probes) state.view = "puzzle";
    textEl.value = state.view === "puzzle" ? puzzleText(G, state.probes)
      : state.view === "probes" ? probesText(G, state.probes)
      : keyText(G, state.probes);
    seedEcho.textContent = state.seed;
    tierEcho.textContent = G.tier.label;
  }

  /* ---------------- actions ---------------- */

  function ask() {
    const G = state.G;
    if (!G || state.answer || state.probes.length >= G.tier.probes) return;
    /* The board prints: Reply "PROBE X X X X X". Take that, and the other
       shapes a reply arrives in — spaced, bare, lowercase, comma-separated,
       quoted — while refusing anything that is not five symbols. The old
       version stripped every character outside ABCD, which kept the B in
       "PROBE" and so rejected the format the board itself asks for, and
       silently truncated a six-symbol probe to five rather than saying so.
       Separators are dropped; a symbol that is not A, B, C or D is a refusal,
       because guessing which five of six were meant is an edit. */
    const raw = probeInput.value.toUpperCase().trim();
    const it = raw.replace(/^PROBE\b[\s:.\-]*/, "").replace(/[\s,;.:"'\-_|]/g, "");
    if (/[^ABCD]/.test(it)) {
      const strays = [...new Set(it.replace(/[ABCD]/g, ""))].join(" ");
      flash(probeCopiedEl, `A probe uses only A, B, C and D — not ${strays}`);
      probeCopyRow.hidden = false; return;
    }
    if (it.length !== LEN) {
      flash(probeCopiedEl, `A probe is ${LEN} symbols from A, B, C and D; that is ${it.length}`);
      probeCopyRow.hidden = false; return;
    }
    const q = probeQuality(G, state.probes, it);
    state.probes.push(Object.assign({ item: it, label: labelOf(G, it) }, q));
    probeInput.value = "";
    render();
  }

  function submitRule() {
    const G = state.G;
    if (!G || state.answer) return;
    if (!G.tests.every((t) => state.labels[t] !== undefined)) return;
    if (G.noise) {
      const cx = counterexamples(G, state.probes);
      state.answer = { kind: "rule", ok: false, verdict: "Saw a pattern in noise.",
        detail: cx.length
          ? "The labels were random. No rule in the language fits all of them."
          : "The labels were random, and by the time you answered, the strings you had seen already contradicted every rule in the language. Whatever you were following was outside it.",
        cx };
    } else {
      const wrong = G.tests.filter((t, i) => state.labels[t] !== G.testLabels[i]).length;
      state.answer = wrong
        ? { kind: "rule", ok: false, verdict: "Rule not identified: " + wrong + " of ten labels wrong.", detail: "The rule was: " + G.rule.text + "." }
        : { kind: "rule", ok: true, verdict: "Rule identified.", detail: "The rule was: " + G.rule.text + "." };
    }
    render();
  }

  function submitNoise() {
    const G = state.G;
    if (!G || state.answer) return;
    state.answer = G.noise
      ? { kind: "noise", ok: true, verdict: "Correct: noise.", detail: "No rule in the language fits these labels." }
      : { kind: "noise", ok: false, verdict: "Missed a rule.", detail: "The rule was: " + G.rule.text + "." };
    render();
  }

  function regenerate() {
    state.probes = [];
    state.labels = {};
    state.answer = null;
    state.view = "puzzle";
    probeInput.value = "";
    probeCopiedEl.textContent = "";
    el("pd-doornote").textContent = ""; el("pd-doornote").hidden = true;
    state.G = generate(state.seed, state.tierKey);
    toUrl();
    if (!state.G) {
      boardEl.hidden = true;
      failEl.hidden = false;
      failEl.textContent = "No board satisfying this tier's guarantees came out of seed " + state.seed + " within sixty attempts. Try another seed — this is the generator refusing to show a board it cannot vouch for.";
      for (const [k, b] of Object.entries(tierBtns)) b.classList.toggle("on", k === state.tierKey);
      blurbEl.textContent = TIERS[state.tierKey].blurb;
      return;
    }
    boardEl.hidden = false;
    failEl.hidden = true;
    buildBoard();
    render();
  }

  el("pd-use").addEventListener("click", () => { state.seed = seedInput.value.trim() || state.seed; seedInput.value = state.seed; regenerate(); });
  el("pd-roll").addEventListener("click", () => { state.seed = String(Math.floor(Math.random() * 1e6)); seedInput.value = state.seed; regenerate(); });
  seedInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el("pd-use").click(); } });
  probeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } });
  askBtn.addEventListener("click", ask);
  submitBtn.addEventListener("click", submitRule);
  noiseBtn.addEventListener("click", submitNoise);
  textEl.addEventListener("focus", () => textEl.select());

  /* ---------------- the front door ----------------
     Probes and a judgment handed over in the address bar, for hands that can
     fetch a page and execute it but cannot type into one.

     `probe` takes the whole round so far, comma-separated, and replays it in
     order. It has to be the whole round because nothing is kept between loads
     — but a probe's answer is a function of the seed and the string, so
     replaying a prefix returns the same answers and probing stays adaptive
     across fetches: ask one, read it, come back with two. Each one goes
     through ask(), so the budget is spent honestly and a malformed probe is
     refused by name rather than trimmed.

     `answer` takes what the board's own text asks for — NOISE, or RULE
     followed by ten marks in order. ✓/✗, Y/N, 1/0 and +/- all read, because
     a tick is awkward to put in a URL; anything else is refused with a count,
     for the same reason ask() refuses rather than trims. */
  function frontDoor(p) {
    if (!p || !state.G) return;
    const pr = p.get(URL_PROBE);
    if (pr && pr.trim()) {
      for (const one of pr.split(/[,;|]+/).map((x) => x.trim()).filter(Boolean)) {
        probeInput.value = one;
        ask();
      }
      probeInput.value = "";
    }
    const a = (p.get(URL_ANSWER) || "").trim();
    if (!a) return;
    if (/^noise$/i.test(a)) { submitNoise(); return; }
    const m = a.match(/^rule\b([\s\S]*)$/i);
    if (!m) return refuse('An answer is NOISE, or RULE followed by ' + state.G.tests.length + ' marks in order.');
    const marks = m[1].replace(/[\s,;|]/g, "");
    const bad = [...new Set(marks.replace(/[\u2713\u2717yn10+\-]/gi, ""))].join(" ");
    if (bad) return refuse(`A label is \u2713 or \u2717 — or Y/N, 1/0, +/- — not ${bad}.`);
    if (marks.length !== state.G.tests.length) {
      return refuse(`RULE needs ${state.G.tests.length} marks in order; that is ${marks.length}.`);
    }
    state.G.tests.forEach((t, i) => { state.labels[t] = /[\u2713y1+]/i.test(marks[i]); });
    submitRule();
  }
  /* A front-door refusal is written, not flashed. flash() clears itself after
     three seconds, which is fine for someone watching the page and useless to
     the reader this door exists for: it fetches, executes, and reads the DOM
     once. A message that erases itself before that read is a refusal nobody
     receives, which is the same fault as trimming a probe silently. */
  function refuse(msg) {
    const n = el("pd-doornote");
    n.textContent = msg;
    n.hidden = false;
  }

  seedInput.value = state.seed;
  /* captured before regenerate(), which calls toUrl() and strips these out */
  const door = (() => { try { return new URLSearchParams(location.search); } catch { return null; } })();
  regenerate();
  frontDoor(door);
})();
