/* Language Forge — ported from the React original to plain JS. No build step.
   Mounts into #forge.

   Generates a complete artificial language from a seed — phonology, morphology,
   syntax, lexicon — then builds a Linguistics-Olympiad-style puzzle out of it
   and checks that the puzzle is actually solvable from the clues given. */
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
  function makeRng(seed) {
    const f = mulberry32(hashSeed(seed));
    return {
      next: () => f(),
      int: (n) => Math.floor(f() * n),
      pick: (a) => a[Math.floor(f() * a.length)],
      chance: (p) => f() < p,
      weighted: (pairs) => {
        const t = pairs.reduce((s, [, w]) => s + w, 0);
        let x = f() * t;
        for (const [v, w] of pairs) { x -= w; if (x < 0) return v; }
        return pairs[pairs.length - 1][0];
      },
      shuffle: (a) => {
        const b = [...a];
        for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
        return b;
      },
    };
  }

  /* ---------------- phonemes ---------------- */
  const P = (ipa, rom) => ({ ipa, rom: rom ?? ipa });
  const CORE = [P("p"), P("t"), P("k"), P("m"), P("n"), P("s"), P("l")];
  const OPT = [
    [P("b"), P("d"), P("g")],
    [P("r")],
    [P("f"), P("v"), P("z"), P("h")],
    [P("ʃ", "sh"), P("tʃ", "ch"), P("dʒ", "j")],
    [P("q"), P("x", "kh"), P("ɣ", "gh")],
    [P("ŋ", "ng"), P("ɲ", "ny")],
    [P("w"), P("j", "y")],
    [P("θ", "th"), P("ð", "dh")],
    [P("ʔ", "'")],
    [P("pʼ", "p'"), P("tʼ", "t'"), P("kʼ", "k'")],
    [P("ɬ", "hl"), P("tɬ", "tl")],
  ];
  const VOW = [
    [P("a"), P("i"), P("u")],
    [P("a"), P("e"), P("i"), P("o"), P("u")],
    [P("a"), P("e"), P("i"), P("o"), P("u"), P("ə", "ë")],
    [P("a"), P("ɛ", "è"), P("i"), P("ɔ", "ò"), P("u"), P("y", "ü"), P("ø", "ö")],
    [P("a"), P("i"), P("u"), P("aː", "aa"), P("iː", "ii"), P("uː", "uu")],
  ];

  function genPhonology(rng) {
    const cons = [...CORE];
    for (const set of OPT) if (rng.chance(0.38)) cons.push(...set);
    const vowels = rng.pick(VOW);
    const onsetRequired = rng.chance(0.4);
    const codaType = rng.weighted([["none", 2], ["nasal", 3], ["sonorant", 2], ["any", 3]]);
    const is = (list) => (c) => list.includes(c.ipa);
    let codas =
      codaType === "none" ? [] :
      codaType === "nasal" ? cons.filter(is(["m", "n", "ŋ", "ɲ"])) :
      codaType === "sonorant" ? cons.filter(is(["m", "n", "ŋ", "ɲ", "l", "r", "w", "j"])) :
      rng.shuffle(cons).slice(0, Math.ceil(cons.length / 2));
    const stops = cons.filter(is(["p", "t", "k", "b", "d", "g"]));
    const liq = cons.filter(is(["l", "r"]));
    const sC = cons.find((c) => c.ipa === "s");
    const clusters = [];
    if (rng.chance(0.35)) {
      for (const s of stops) for (const l of liq) clusters.push([s, l]);
      if (sC) for (const s of stops) clusters.push([sC, s]);
    }
    const stress = rng.pick(["the first syllable", "the last syllable", "the second-to-last syllable"]);
    return { cons, vowels, onsetRequired, codaType, codas, clusters, stress };
  }

  function genSyl(rng, ph, { noOnset = false, noCoda = false, forceOnset = false } = {}) {
    const s = [];
    if (!noOnset && (forceOnset || ph.onsetRequired || rng.chance(0.85))) {
      if (ph.clusters.length && rng.chance(0.15)) s.push(...rng.pick(ph.clusters));
      else s.push(rng.pick(ph.cons));
    }
    s.push(rng.pick(ph.vowels));
    if (!noCoda && ph.codas.length && rng.chance(0.35)) s.push(rng.pick(ph.codas));
    return s;
  }
  const romOf = (syls) => syls.flat().map((p) => p.rom).join("");
  const ipaOf = (syls) => syls.flat().map((p) => p.ipa).join("");

  /* reject stems that would create false leads: a final vowel identical to the
     first vowel of a suffix, an initial vowel identical to the last vowel of a
     prefix, or a form one sound away from an existing word */
  function rejectWord(rom, syls, L, used) {
    const ph = syls.flat(); const first = ph[0], last = ph[ph.length - 1];
    const isV = (p) => L.ph.vowels.includes(p);
    if (isV(last) && L.sufs.some((s) => s.syls.flat()[0].ipa === last.ipa)) return true;
    if (isV(first) && L.pres.some((p) => { const a = p.syls.flat(); return a[a.length - 1].ipa === first.ipa; })) return true;
    for (const u of used) {
      if (u === rom) return true;
      const d = Math.abs(u.length - rom.length);
      if (d === 0) { let diff = 0; for (let i = 0; i < u.length; i++) if (u[i] !== rom[i]) diff++; if (diff <= 1) return true; }
      else if (d === 1) { const [a, b] = u.length > rom.length ? [u, rom] : [rom, u]; if (a.startsWith(b) || a.endsWith(b)) return true; }
    }
    return false;
  }
  function mkWord(rng, ph, used, nSyl, L) {
    let syls;
    for (let t = 0; t < 90; t++) {
      const n = t < 55 ? nSyl : nSyl + 1;
      syls = [];
      for (let i = 0; i < n; i++) syls.push(genSyl(rng, ph, { forceOnset: i > 0 }));
      const r = romOf(syls);
      if (!rejectWord(r, syls, L, used)) { used.add(r); break; }
    }
    used.add(romOf(syls));
    return { syls, rom: romOf(syls), ipa: ipaOf(syls) };
  }
  function mkAffix(rng, ph, used, kind) {
    let syls;
    for (let t = 0; t < 60; t++) {
      if (kind === "pre") {
        syls = t < 25 ? [genSyl(rng, ph, { forceOnset: true, noCoda: true })]
          : [genSyl(rng, ph, { forceOnset: true, noCoda: true }), genSyl(rng, ph, { forceOnset: true, noCoda: true })];
      } else if (!ph.codas.length) {
        syls = t < 25 ? [genSyl(rng, ph, { forceOnset: true, noCoda: true })]
          : [genSyl(rng, ph, { forceOnset: true, noCoda: true }), genSyl(rng, ph, { forceOnset: true, noCoda: true })];
      } else {
        syls = t < 25 ? [genSyl(rng, ph, { noOnset: true })]
          : [genSyl(rng, ph, { noOnset: true, noCoda: true }), genSyl(rng, ph, { forceOnset: true })];
      }
      const key = kind === "pre" ? romOf(syls) + "-" : "-" + romOf(syls);
      if (!used.has(key)) { used.add(key); break; }
    }
    return { syls, rom: romOf(syls), ipa: ipaOf(syls) };
  }

  /* ---------------- semantic stock ---------------- */
  const N = (en, pl, o = {}) => ({ en, pl, ...o });
  const NOUN_STOCK = [
    N("person", "people", { anim: 1 }), N("man", "men", { anim: 1 }), N("woman", "women", { anim: 1 }),
    N("child", "children", { anim: 1 }), N("dog", "dogs", { anim: 1 }), N("fish", "fish", { anim: 1 }),
    N("bird", "birds", { anim: 1 }), N("horse", "horses", { anim: 1 }), N("wolf", "wolves", { anim: 1 }),
    N("tree", "trees"), N("stone", "stones"), N("water", "water", { mass: 1 }), N("fire", "fire", { mass: 1 }),
    N("sun", "suns"), N("moon", "moons"), N("star", "stars"), N("sky", "skies"), N("earth", "earth", { mass: 1 }),
    N("mountain", "mountains"), N("river", "rivers"), N("house", "houses"), N("road", "roads"),
    N("hand", "hands"), N("eye", "eyes"), N("head", "heads"), N("heart", "hearts"), N("blood", "blood", { mass: 1 }),
    N("bone", "bones"), N("meat", "meat", { mass: 1 }), N("name", "names"), N("night", "nights"), N("day", "days"),
    N("wind", "wind", { mass: 1 }), N("rain", "rain", { mass: 1 }), N("snow", "snow", { mass: 1 }), N("seed", "seeds"),
    N("root", "roots"), N("leaf", "leaves"), N("egg", "eggs"), N("horn", "horns"), N("feather", "feathers"),
    N("knife", "knives"), N("boat", "boats"), N("salt", "salt", { mass: 1 }), N("smoke", "smoke", { mass: 1 }),
    N("mouth", "mouths"), N("tooth", "teeth"), N("foot", "feet"), N("song", "songs"), N("bread", "bread", { mass: 1 }),
    N("door", "doors"), N("path", "paths"), N("cloud", "clouds"), N("word", "words"),
  ];
  const V = (en, past, tr) => ({ en, past, tr });
  const VERB_STOCK = [
    V("eat", "ate", 1), V("drink", "drank", 1), V("see", "saw", 1), V("hear", "heard", 1), V("know", "knew", 1),
    V("kill", "killed", 1), V("cut", "cut", 1), V("hunt", "hunted", 1), V("fear", "feared", 1), V("want", "wanted", 1),
    V("make", "made", 1), V("carry", "carried", 1), V("find", "found", 1), V("wash", "washed", 1), V("bite", "bit", 1),
    V("hold", "held", 1), V("build", "built", 1), V("break", "broke", 1), V("cook", "cooked", 1), V("follow", "followed", 1),
    V("sleep", "slept", 0), V("die", "died", 0), V("swim", "swam", 0), V("fly", "flew", 0), V("walk", "walked", 0),
    V("come", "came", 0), V("go", "went", 0), V("sit", "sat", 0), V("stand", "stood", 0), V("sing", "sang", 0),
    V("burn", "burned", 0), V("run", "ran", 0), V("fall", "fell", 0), V("laugh", "laughed", 0), V("wake", "woke", 0),
  ];
  const ADJ_STOCK = ["big", "small", "long", "old", "new", "good", "bad", "red", "black", "white", "hot", "cold", "full", "dry", "heavy", "far", "near", "wet", "sharp", "quiet"];
  const PRON = [
    { gloss: "1SG", en: "I", obj: "me", sg: 0 }, { gloss: "2SG", en: "you", obj: "you", sg: 0 },
    { gloss: "3SG", en: "she", obj: "her", sg: 1 }, { gloss: "1PL", en: "we", obj: "us", sg: 0 },
    { gloss: "2PL", en: "you all", obj: "you all", sg: 0 }, { gloss: "3PL", en: "they", obj: "them", sg: 0 },
  ];
  const QUIRKS = [
    { note: "One word covers both 'hand' and 'arm'.", apply: (L) => { const n = L.nouns.find((x) => x.en === "hand"); n.dict = "hand, arm"; } },
    { note: "One word covers 'blue' and 'green'.", apply: (L) => { L.adjs.push({ en: "blue", dict: "blue, green" }); } },
    { note: "'Sun' and 'day' are the same word.", apply: (L) => { const d = L.nouns.find((x) => x.en === "day"); d.merge = "sun"; } },
    { note: "Still water and moving water are different words; there is no general word for 'water'.", apply: (L) => { const w = L.nouns.find((x) => x.en === "water"); w.dict = "water (still)"; L.nouns.push(N("water (moving)", "water (moving)", { mass: 1 })); } },
    { note: "'Fear' and 'respect' are the same verb.", apply: (L) => { const v = L.verbs.find((x) => x.en === "fear"); v.dict = "fear, respect"; } },
    { note: "There are separate words for older and younger sibling, and no word for 'sibling'.", apply: (L) => { L.nouns.push(N("older sibling", "older siblings", { anim: 1 }), N("younger sibling", "younger siblings", { anim: 1 })); } },
    { note: "'Black' and 'night' share a root: night is literally 'black-place'.", apply: (L) => { const n = L.nouns.find((x) => x.en === "night"); n.derived = { from: "black", how: "PLACE" }; } },
    { note: "'Know' and 'see' are the same verb.", apply: (L) => { const v = L.verbs.find((x) => x.en === "know"); v.merge = "see"; } },
  ];

  /* ---------------- build a language ---------------- */
  function buildLanguage(seed, mode, total = 30) {
    const rng = makeRng(seed);
    const ph = genPhonology(rng);
    const used = new Set();
    const L = { seed, ph, sufs: [], pres: [] };
    const W = (n) => mkWord(rng, ph, used, n, L);
    const A = (k) => { const a = mkAffix(rng, ph, used, k); (k === "pre" ? L.pres : L.sufs).push(a); return a; };

    const nameW = W(rng.chance(0.5) ? 2 : 3);
    L.name = nameW.rom.charAt(0).toUpperCase() + nameW.rom.slice(1);
    L.nameIpa = nameW.ipa;
    L.nouns = NOUN_STOCK.map((n) => ({ ...n }));
    L.verbs = VERB_STOCK.map((v) => ({ ...v }));
    L.adjs = ADJ_STOCK.map((a) => ({ en: a }));
    L.quirks = rng.shuffle(QUIRKS).slice(0, 2);
    L.quirks.forEach((q) => q.apply(L));

    /* grammar */
    L.order = rng.weighted([["SOV", 40], ["SVO", 35], ["VSO", 12], ["VOS", 5], ["OVS", 4], ["OSV", 2]]);
    L.adjBefore = L.order === "SOV" ? rng.chance(0.6) : rng.chance(0.4);
    L.alignment = rng.weighted([["nomacc", 5], ["ergabs", 3], ["none", 2]]);
    L.cases = {};
    if (L.alignment === "nomacc") L.cases.ACC = A("suf");
    if (L.alignment === "ergabs") L.cases.ERG = A("suf");
    for (const c of rng.shuffle(["GEN", "DAT", "LOC", "INS"]).slice(0, rng.int(3) + 1)) L.cases[c] = A("suf");
    L.plural = { type: rng.weighted([["suffix", 4], ["prefix", 2], ["redup", 2], ["none", 2]]) };
    if (L.plural.type === "suffix") L.plural.morph = A("suf");
    if (L.plural.type === "prefix") L.plural.morph = A("pre");
    const nCls = rng.weighted([[0, 5], [2, 3], [3, 2]]);
    L.classes = nCls ? { n: nCls, agr: Array.from({ length: nCls }, () => A("pre")) } : null;
    L.tense = { set: rng.chance(0.5) ? ["PST", "NPST"] : ["PST", "PRS", "FUT"], type: rng.chance(0.65) ? "suffix" : "prefix", morphs: {} };
    for (const t of L.tense.set) if (t !== "NPST" && t !== "PRS") L.tense.morphs[t] = A(L.tense.type === "suffix" ? "suf" : "pre");
    L.evid = rng.chance(0.45) ? { VIS: A("suf"), INFR: A("suf"), REP: A("suf") } : null;
    L.agree = rng.chance(0.5) ? Object.fromEntries(PRON.map((p) => [p.gloss, A("pre")])) : null;
    L.neg = { type: rng.weighted([["particle", 4], ["suffix", 3], ["circumfix", 2]]) };
    if (L.neg.type !== "suffix") L.neg.particle = W(1);
    if (L.neg.type !== "particle") L.neg.suffix = A("suf");
    L.q = { type: rng.weighted([["initial", 3], ["final", 4], ["intonation", 2]]) };
    if (L.q.type !== "intonation") L.q.particle = W(1);
    L.def = rng.chance(0.45) ? A("suf") : null;
    L.numBase = rng.weighted([[10, 5], [12, 3], [20, 2]]);
    L.numJoin = rng.chance(0.4) ? W(1) : null;
    L.deriv = { AGT: A("suf"), PLACE: A("suf") };

    /* lexicon */
    for (const p of PRON) p.w = null;
    L.prons = PRON.map((p) => ({ ...p, w: W(1) }));
    for (const n of L.nouns) {
      if (n.merge) { n.w = L.nouns.find((x) => x.en === n.merge).w; n.w = n.w || null; continue; }
      if (n.derived) continue;
      n.w = W(rng.weighted([[1, 3], [2, 6], [3, 2]]));
      n.cls = !L.classes ? 0 : n.anim ? 0 : 1 + rng.int(L.classes.n - 1);
    }
    for (const n of L.nouns) if (n.merge) { const src = L.nouns.find((x) => x.en === n.merge); n.w = src.w; n.cls = src.cls; }
    for (const v of L.verbs) v.w = v.merge ? L.verbs.find((x) => x.en === v.merge).w : W(rng.weighted([[1, 4], [2, 6]]));
    for (const a of L.adjs) a.w = W(rng.weighted([[1, 4], [2, 5]]));
    for (const n of L.nouns) if (n.derived) {
      const src = L.adjs.find((x) => x.en === n.derived.from);
      n.w = { syls: [...src.w.syls, ...L.deriv.PLACE.syls] };
      n.w.rom = romOf(n.w.syls); n.w.ipa = ipaOf(n.w.syls);
      n.cls = L.classes ? 1 + rng.int(L.classes.n - 1) : 0;
      n.dict = `night (lit. black-${"place"})`;
    }
    for (const [vEn, out, pl] of [["hunt", "hunter", "hunters"], ["sing", "singer", "singers"], ["make", "maker", "makers"], ["build", "builder", "builders"]]) {
      const v = L.verbs.find((x) => x.en === vEn);
      const syls = [...v.w.syls, ...L.deriv.AGT.syls];
      L.nouns.push({ en: out, pl, anim: 1, cls: 0, derivedAgent: 1, dict: `${out} (${vEn}-agt)`, w: { syls, rom: romOf(syls), ipa: ipaOf(syls) } });
    }
    for (const [nEn, out, pl] of [["fire", "hearth", "hearths"], ["tree", "forest", "forests"], ["stone", "quarry", "quarries"], ["fish", "fishing ground", "fishing grounds"]]) {
      const n = L.nouns.find((x) => x.en === nEn);
      const syls = [...n.w.syls, ...L.deriv.PLACE.syls];
      L.nouns.push({ en: out, pl, cls: L.classes ? 1 + rng.int(L.classes.n - 1) : 0, place: 1, dict: `${out} (${nEn}-place)`, w: { syls, rom: romOf(syls), ipa: ipaOf(syls) } });
    }
    L.nums = Array.from({ length: L.numBase }, () => W(rng.chance(0.6) ? 1 : 2));
    L.misc = { yes: W(1), no: W(1), and: W(1), here: W(rng.chance(0.5) ? 1 : 2), there: W(rng.chance(0.5) ? 1 : 2), what: W(1), who: W(1) };

    /* sentences */
    L.mode = mode;
    const { specs, ctx } = designedSpecs(rng, L, mode);
    L.designed = specs.length;
    L.sentences = specs.map((sp) => genSentence(rng, L, mode, sp));
    const tSpec = taskSpec(L, ctx);
    L.task = genSentence(rng, L, mode, tSpec);
    /* siblings: the task's word-shapes with different stems, split so no single
       sentence is the task with the words swapped */
    const other = (pool, not) => rng.pick(pool.filter((x) => !not.includes(x)));
    const vt2 = other(L.verbs.filter((v) => v.tr && !v.merge), [ctx.vt]);
    const nB2 = other(L.nouns.filter((n) => n.w && !n.anim && !n.mass && !n.place), [ctx.nB]);
    const nA2 = other(L.nouns.filter((n) => n.w && n.anim && !n.derivedAgent), [ctx.nA]);
    const adj2 = other(L.adjs.filter((a) => !a.dict), [ctx.adj]);
    const sib = (o) => ({ neg: false, q: false, adjunct: null, evid: L.evid ? "VIS" : null, transitive: true, verb: vt2, subj: { n: nA2, plural: false, adj: null, def: true }, obj: { n: nB2, plural: false, adj: null, def: false }, tense: ctx.present, ...o });
    L.sentences.push(genSentence(rng, L, mode, sib({ neg: true, tense: tSpec.tense, evid: tSpec.evid })));
    L.sentences.push(genSentence(rng, L, mode, sib({ obj: { n: nB2, plural: tSpec.obj.plural, num: 2, adj: adj2, def: tSpec.obj.def } })));
    while (L.sentences.length < total) L.sentences.push(genSentence(rng, L, mode, {}));
    for (let pass = 0; pass < 3; pass++) {
      const counts = {};
      for (const s of L.sentences) for (const w of s.words) for (const g of w.gloss.split("-")) if (/^[A-Z0-9]+$/.test(g)) counts[g] = (counts[g] || 0) + 1;
      const needed = COVERABLE(L).filter((m) => (counts[m] || 0) < 2);
      if (!needed.length) break;
      for (const m of needed) L.sentences.push(genSentence(rng, L, mode, coverageSpec(rng, L, ctx, m)));
    }
    /* check 1: every task stem must be pinned or derivable from the translated sentences */
    for (let pass = 0; pass < 4; pass++) {
      const { known, derivable } = pinnedStems(L);
      const missing = L.task.stemInfo.filter((st) => !known.has(st.en) && !derivable.has(st.en));
      if (!missing.length) break;
      for (const st of missing) {
        const base = { neg: false, q: false, adjunct: null, evid: L.evid ? "VIS" : null, tense: ctx.present, known: true };
        if (st.pos === "v") { const v = L.verbs.find((x) => x.en === st.en); L.sentences.push(genSentence(rng, L, mode, v.tr ? { ...base, transitive: true, verb: v, subj: { n: ctx.nA, plural: false, adj: null, def: true }, obj: { n: ctx.nB, plural: false, adj: null, def: false } } : { ...base, transitive: false, verb: v, subj: { n: ctx.nA, plural: false, adj: null, def: true } })); }
        else if (st.pos === "adj") { const a = L.adjs.find((x) => x.en === st.en); L.sentences.push(genSentence(rng, L, mode, { ...base, transitive: true, verb: ctx.vt, subj: { n: ctx.nA, plural: false, adj: null, def: true }, obj: { n: ctx.nB, plural: false, adj: a, def: false } })); }
        else { const n = L.nouns.find((x) => x.en === st.en); L.sentences.push(genSentence(rng, L, mode, { ...base, transitive: true, verb: ctx.vt, subj: { n: ctx.nA, plural: false, adj: null, def: true }, obj: { n, plural: false, adj: null, def: false } })); }
      }
    }
    /* check 2: every word-shape in the task, and numeral+adjective in one phrase, must be attested; fallback is a full structural twin */
    const rep = shapeReport(L);
    if (rep.missing.length || rep.numAdjMissing) {
      L.sentences.push(genSentence(rng, L, mode, { ...tSpec, verb: vt2, subj: { n: nA2, plural: false, adj: null, def: true }, obj: { ...tSpec.obj, n: nB2, adj: adj2, num: 2 } }));
    }
    L.sentences.sort((a, b) => (b.known ? 1 : 0) - (a.known ? 1 : 0));
    L.knownCount = L.sentences.filter((s) => s.known).length;
    L.solvability = { ...pinnedStems(L), shapes: shapeReport(L) };
    return L;
  }

  /* ---------------- sentence machinery ---------------- */
  const word = (m) => ({ surface: romOf(m.flatMap((x) => x.syls)), gloss: m.map((x) => x.gloss).join("-") });
  function caseFor(L, role) {
    if (L.alignment === "nomacc" && role === "O") return "ACC";
    if (L.alignment === "ergabs" && role === "A") return "ERG";
    return null;
  }
  function nounPhrase(L, np) {
    const m = [];
    if (np.plural && L.plural.type === "prefix") m.push({ syls: L.plural.morph.syls, gloss: "PL" });
    if (np.plural && L.plural.type === "redup") m.push({ syls: [np.n.w.syls[0]], gloss: "PL" });
    m.push({ syls: np.n.w.syls, gloss: np.n.en });
    if (np.plural && L.plural.type === "suffix") m.push({ syls: L.plural.morph.syls, gloss: "PL" });
    if (np.def && L.def) m.push({ syls: L.def.syls, gloss: "DEF" });
    const c = caseFor(L, np.role);
    if (c) m.push({ syls: L.cases[c].syls, gloss: c });
    const nw = word(m);
    const mods = [];
    if (np.num) mods.push({ ...word([{ syls: L.nums[np.num - 1].syls, gloss: String(np.num) }]), kind: "num" });
    if (np.adj) {
      const am = [];
      if (L.classes) am.push({ syls: L.classes.agr[np.n.cls].syls, gloss: "C" + (np.n.cls + 1) });
      am.push({ syls: np.adj.w.syls, gloss: np.adj.en });
      mods.push({ ...word(am), kind: "adj" });
    }
    if (!mods.length) return [nw];
    return L.adjBefore ? [...mods, nw] : [nw, ...mods.reverse()];
  }
  function pronPhrase(L, pr, role) {
    const m = [{ syls: pr.w.syls, gloss: pr.gloss }];
    const c = caseFor(L, role);
    if (c) m.push({ syls: L.cases[c].syls, gloss: c });
    return [word(m)];
  }
  function verbPhrase(L, c) {
    const m = [];
    if (L.agree) m.push({ syls: L.agree[c.person].syls, gloss: c.person });
    if (L.tense.type === "prefix" && L.tense.morphs[c.tense]) m.push({ syls: L.tense.morphs[c.tense].syls, gloss: c.tense });
    m.push({ syls: c.verb.w.syls, gloss: c.verb.en });
    if (L.tense.type === "suffix" && L.tense.morphs[c.tense]) m.push({ syls: L.tense.morphs[c.tense].syls, gloss: c.tense });
    if (L.evid && c.evid) m.push({ syls: L.evid[c.evid].syls, gloss: c.evid });
    if (c.neg && L.neg.type !== "particle") m.push({ syls: L.neg.suffix.syls, gloss: "NEG" });
    const out = [];
    if (c.neg && L.neg.type !== "suffix") out.push(word([{ syls: L.neg.particle.syls, gloss: "NEG" }]));
    out.push(word(m));
    return out;
  }
  const NUMEN = ["", "one", "two", "three", "four", "five"];
  const s3 = (v) => (/(s|sh|ch|x|z)$/.test(v) ? v + "es" : /[^aeiou]y$/.test(v) ? v.slice(0, -1) + "ies" : v + "s");
  const article = (w) => (/^[aeiou]/.test(w) ? "an " : "a ");
  function enNP(np, isObj) {
    if (np.pr) return isObj ? np.pr.obj : np.pr.en;
    const adj = (np.num ? NUMEN[np.num] + " " : "") + (np.adj ? np.adj.en + " " : "");
    const noun = np.plural || np.num ? np.n.pl : np.n.en;
    if (np.def) return "the " + adj + noun;
    if (np.plural || np.num || np.n.mass) return adj + noun;
    return article(adj + noun) + adj + noun;
  }
  /* selectional tables for plausible mode */
  const AGENTS = ["person", "man", "woman", "child", "older sibling", "younger sibling", "hunter", "singer", "maker", "builder"];
  const ANIM = [...AGENTS, "dog", "wolf", "bird", "horse", "fish"];
  const THINGS_FOOD = ["meat", "bread", "fish", "egg", "seed", "leaf", "root"];
  const PLAUS = {
    eat: { s: [...AGENTS, "dog", "wolf", "bird", "horse"], o: THINGS_FOOD },
    drink: { s: [...AGENTS, "dog", "wolf", "horse"], o: ["water", "water (moving)", "blood"] },
    see: { s: ANIM }, hear: { s: ANIM }, want: { s: ANIM }, find: { s: ANIM },
    know: { s: AGENTS, o: ["name", "word", "song", "path", "road", "river", "mountain", "man", "woman"] },
    kill: { s: [...AGENTS, "wolf", "dog"], o: ["fish", "bird", "wolf", "dog", "horse", "man", "woman"] },
    cut: { s: AGENTS, o: ["meat", "bread", "tree", "leaf", "root", "bone", "feather", "horn"] },
    hunt: { s: [...AGENTS, "wolf", "dog"], o: ["fish", "bird", "horse", "wolf"] },
    fear: { s: ANIM, o: ["wolf", "fire", "night", "wind", "man", "dog", "river", "mountain"] },
    make: { s: AGENTS, o: ["house", "boat", "knife", "road", "door", "song", "bread", "fire", "path"] },
    carry: { s: [...AGENTS, "horse"], o: ["stone", "water", "meat", "child", "knife", "egg", "seed", "leaf", "salt", "bread"] },
    wash: { s: AGENTS, o: ["hand", "foot", "head", "knife", "child", "mouth"] },
    bite: { s: ["dog", "wolf", "horse", "fish", "child"], o: ["man", "woman", "dog", "meat", "bread", "hand", "foot"] },
    hold: { s: AGENTS, o: ["knife", "stone", "egg", "hand", "child", "feather", "bread", "horn"] },
    build: { s: AGENTS, o: ["house", "boat", "road", "door"] },
    break: { s: [...AGENTS, "horse", "wind"], o: ["stone", "bone", "egg", "door", "knife", "boat", "horn"] },
    cook: { s: AGENTS, o: ["meat", "fish", "egg", "bread", "root"] },
    follow: { s: ANIM, o: [...ANIM, "road", "path", "river"] },
    sleep: { s: ANIM }, walk: { s: ANIM }, sit: { s: ANIM }, wake: { s: ANIM }, laugh: { s: AGENTS },
    die: { s: [...ANIM, "fire", "tree"] },
    swim: { s: ["fish", "child", "dog", "man", "woman", "horse"] },
    fly: { s: ["bird", "feather", "leaf", "cloud", "smoke"] },
    come: { s: [...ANIM, "rain", "snow", "wind", "night", "day"] },
    go: { s: [...ANIM, "rain", "snow", "wind", "night", "day", "sun", "moon"] },
    stand: { s: [...ANIM, "tree", "house", "mountain", "stone", "door"] },
    sing: { s: [...AGENTS, "bird"] },
    burn: { s: ["fire", "tree", "house", "boat", "leaf", "bread", "meat", "road", "forest", "hearth"] },
    run: { s: [...ANIM, "water (moving)", "river"] },
    fall: { s: ["stone", "leaf", "tree", "child", "rain", "snow", "star", "egg", "man"] },
  };
  const TOOLS = ["knife", "stone", "hand", "fire", "boat", "feather", "horn", "bone", "tooth", "foot"];
  const PLACES = ["house", "river", "mountain", "road", "forest", "path", "boat", "hearth", "quarry", "fishing ground", "door", "tree"];

  function pickNoun(rng, L, pool, filter) {
    let c = L.nouns.filter((n) => n.w && (!filter || filter(n)));
    if (pool) { const p = c.filter((n) => pool.includes(n.en)); if (p.length) c = p; }
    const rare = c.filter((n) => !(n.derivedAgent || n.place));
    if (rare.length && rng.chance(0.8)) c = rare;
    return rng.pick(c);
  }
  function frameFor(L, mode, verb) {
    const t = mode === "surreal" ? {} : PLAUS[verb.en] || {};
    return { verb, sPool: t.s || null, oPool: t.o || null, pronOK: mode === "surreal" || !t.s || t.s.includes("person") };
  }
  function designedSpecs(rng, L, mode) {
    const canPl = L.plural.type !== "none";
    const present = L.tense.set.includes("PRS") ? "PRS" : "NPST";
    const vt = rng.pick(L.verbs.filter((v) => v.tr && !v.merge));
    const ft = frameFor(L, mode, vt);
    const nA = pickNoun(rng, L, ft.sPool, (n) => n.anim && !n.derivedAgent);
    const nB = pickNoun(rng, L, ft.oPool, (n) => !n.anim && !n.mass && !n.place && n.en !== nA.en);
    const vis = L.verbs.filter((v) => !v.tr && (mode === "surreal" || !PLAUS[v.en] || PLAUS[v.en].s.includes(nA.en)));
    const vi = rng.pick(vis.length ? vis : L.verbs.filter((v) => !v.tr));
    const adj = rng.pick(L.adjs.filter((a) => !a.dict));
    const S = (o = {}) => ({ n: nA, plural: false, adj: null, def: true, ...o });
    const O = (o = {}) => ({ n: nB, plural: false, adj: null, def: false, ...o });
    const base = { neg: false, q: false, adjunct: null, evid: L.evid ? "VIS" : null };
    const specs = [];
    specs.push({ ...base, transitive: false, verb: vi, subj: S(), tense: present });
    specs.push({ ...base, transitive: false, verb: vi, subj: S(), tense: "PST" });
    if (L.tense.set.includes("FUT")) specs.push({ ...base, transitive: false, verb: vi, subj: S(), tense: "FUT" });
    if (canPl) specs.push({ ...base, transitive: false, verb: vi, subj: S({ plural: true, def: false }), tense: present });
    const T = (o = {}) => ({ ...base, transitive: true, verb: vt, subj: S(), obj: O(), tense: present, ...o });
    specs.push(T());
    if (L.def) specs.push(T({ obj: O({ def: true }) }));
    specs.push(T({ neg: true }));
    specs.push(T({ q: true }));
    if (L.cases.INS) specs.push(T({ adjunct: "INS" })); else if (L.cases.LOC) specs.push(T({ adjunct: "LOC" }));
    specs.push(T({ obj: O({ adj }) }));
    specs.push(T({ subj: S({ adj }) }));
    const agent = pickNoun(rng, L, null, (n) => n.derivedAgent);
    if (agent) specs.push(T({ subj: S({ n: agent }) }));
    if (L.evid) specs.push(T({ evid: "REP" }));
    specs.push({ ...base, transitive: false, verb: vi, subj: S({ num: 3, plural: canPl, def: false }), tense: present });
    const agent2 = pickNoun(rng, L, null, (n) => n.derivedAgent && n !== agent);
    if (agent2) specs.push(T({ obj: O({ n: agent2 }), known: true }));
    /* the verbs the two agent nouns are built on, in translated sentences, so the
       agent suffix can be learned from agent2 and then applied to agent1 */
    for (const ag of [agent, agent2]) {
      const bv = L.verbs.find((v) => ag.dict.includes(`(${v.en}-agt)`));
      if (!bv) continue;
      if (bv.tr) specs.push(T({ verb: bv, obj: O({ n: pickNoun(rng, L, frameFor(L, mode, bv).oPool, (x) => !x.anim && !x.place && x !== nB) }), known: true }));
      else specs.push({ ...base, transitive: false, verb: bv, subj: S(), tense: present, known: true });
    }
    /* translated core: pins the animate noun, the intransitive verb, the transitive verb, the inanimate noun, the adjective */
    specs[0].known = true; specs[1].known = true;
    const baseIdx = specs.findIndex((s) => s.transitive && !s.neg && !s.q && !s.adjunct && s.obj.def === false && !s.obj.adj && !s.subj.adj && s.subj.n === nA && s.obj.n === nB);
    specs[baseIdx].known = true;
    specs.find((s) => s.obj && s.obj.adj && s.obj.n === nB).known = true;
    const place = pickNoun(rng, L, null, (n) => n.place);
    if (L.cases.LOC) specs.push(T({ adjunct: "LOC", adjunctN: place }));
    else {
      const vp = L.verbs.filter((v) => !v.tr && (mode === "surreal" || (PLAUS[v.en] && PLAUS[v.en].s.includes(place.en))));
      specs.push({ ...base, transitive: false, verb: rng.pick(vp.length ? vp : L.verbs.filter((v) => !v.tr)), subj: S({ n: place }), tense: present });
    }
    return { specs, ctx: { nA, nB, vt, vi, adj, present, agent } };
  }
  const COVERABLE = (L) => {
    const out = [];
    if (L.plural.type !== "none") out.push("PL");
    if (L.def) out.push("DEF");
    out.push(...Object.keys(L.tense.morphs));
    if (L.evid) out.push("VIS", "INFR", "REP");
    out.push("NEG");
    if (L.q.type !== "intonation") out.push("Q");
    if (L.cases.INS) out.push("INS");
    if (L.cases.LOC) out.push("LOC");
    if (L.classes) for (let i = 0; i < L.classes.n; i++) out.push("C" + (i + 1));
    if (L.agree) out.push(...PRON.map((p) => p.gloss));
    return out;
  };
  function coverageSpec(rng, L, ctx, m) {
    const canPl = L.plural.type !== "none";
    const T = (o = {}) => ({ neg: false, q: false, adjunct: null, evid: L.evid ? "VIS" : null, transitive: true, verb: ctx.vt, subj: { n: ctx.nA, plural: false, adj: null, def: true }, obj: { n: ctx.nB, plural: false, adj: null, def: false }, tense: ctx.present, ...o });
    if (m === "PL") return T({ subj: { n: ctx.nA, plural: true, adj: null, def: false } });
    if (m === "DEF") return T({ obj: { n: ctx.nB, plural: false, adj: null, def: true } });
    if (m === "NEG") return T({ neg: true });
    if (m === "Q") return T({ q: true });
    if (m === "INS" || m === "LOC") return T({ adjunct: m });
    if (["VIS", "INFR", "REP"].includes(m)) return T({ evid: m });
    if (L.tense.morphs[m]) return T({ tense: m });
    if (/^C\d$/.test(m)) { const k = +m[1] - 1; const n = pickNoun(rng, L, null, (x) => x.cls === k && !x.mass); return T({ subj: { n, plural: false, adj: ctx.adj, def: true } }); }
    const pr = L.prons.find((p) => p.gloss === m);
    if (pr) return T({ subj: { pr } });
    return T();
  }
  /* what a solver can pin from the translated sentences: within one sentence,
     if a part of speech has exactly one unknown stem, it is pinned; derived nouns
     are derivable once their base verb/noun is pinned and the suffix is attested
     on some other pinned derived noun */
  function pinnedStems(L) {
    const known = new Set(["one", "two", "three", "four", "five"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of L.sentences) {
        if (!s.known) continue;
        const byPos = {};
        for (const st of s.stemInfo) if (!known.has(st.en)) (byPos[st.pos] = byPos[st.pos] || []).push(st.en);
        for (const p in byPos) if (byPos[p].length === 1) { known.add(byPos[p][0]); changed = true; }
      }
    }
    const derivable = new Set();
    const baseOf = (n) => { const m = n.dict && n.dict.match(/\((.+)-(agt|place)\)/); return m ? { base: m[1], kind: m[2] } : null; };
    const attested = new Set();
    for (const n of L.nouns) { const b = baseOf(n); if (b && known.has(n.en) && known.has(b.base)) attested.add(b.kind); }
    for (const n of L.nouns) { const b = baseOf(n); if (b && !known.has(n.en) && known.has(b.base) && attested.has(b.kind)) derivable.add(n.en); }
    return { known, derivable };
  }
  const shapeOf = (w) => w.gloss.split("-").filter((g) => /^[A-Z0-9]+$/.test(g)).map((g) => (/^\d+$/.test(g) ? "NUM" : g)).sort().join("+");
  const npHasNumAndAdj = (s) => s.words.some((w) => w.kind === "num") && s.words.some((w) => w.kind === "adj");
  function shapeReport(L) {
    const corpusShapes = new Set(L.sentences.flatMap((s) => s.words.map(shapeOf)));
    const need = [...new Set(L.task.words.map(shapeOf))].filter((x) => x);
    const missing = need.filter((x) => !corpusShapes.has(x));
    const taskNumAdj = npHasNumAndAdj(L.task);
    const corpusNumAdj = L.sentences.some(npHasNumAndAdj);
    return { need, missing, numAdjMissing: taskNumAdj && !corpusNumAdj };
  }
  function taskSpec(L, ctx) {
    const canPl = L.plural.type !== "none";
    return { transitive: true, verb: ctx.vt, subj: { n: ctx.agent || ctx.nA, plural: false, adj: null, def: true }, obj: { n: ctx.nB, plural: canPl, num: 3, adj: ctx.adj, def: !!L.def }, tense: L.tense.set.includes("FUT") ? "FUT" : "PST", neg: true, q: false, adjunct: null, evid: L.evid ? "INFR" : null };
  }
  function genSentence(rng, L, mode, spec) {
    const canPl = L.plural.type !== "none";
    const transitive = spec.transitive ?? rng.chance(0.65);
    const verb = spec.verb || rng.pick(L.verbs.filter((v) => !!v.tr === transitive));
    const fr = frameFor(L, mode, verb);
    const info = [{ en: verb.en, pos: "v" }];
    const stems = { add: (en, pos) => { if (!info.some((x) => x.en === en)) info.push({ en, pos }); } };
    stems.add(verb.en, "v");
    const mkNP = (role, sp, pool) => {
      if (sp && sp.pr) { stems.add(sp.pr.en, "pron"); return { pr: sp.pr, role }; }
      if (!sp && fr.pronOK && rng.chance(0.2)) { const pr = rng.pick(L.prons); stems.add(pr.en, "pron"); return { pr, role }; }
      const n = sp && sp.n ? sp.n : pickNoun(rng, L, pool);
      const plural = canPl && !n.mass && (sp && sp.plural !== undefined ? sp.plural : rng.chance(0.3));
      const adj = sp && sp.adj !== undefined ? sp.adj : rng.chance(0.3) ? rng.pick(L.adjs) : null;
      const def = sp && sp.def !== undefined ? sp.def : L.def ? rng.chance(role === "O" ? 0.5 : 0.7) : role !== "O";
      stems.add(n.en, "n"); if (adj) stems.add(adj.en, "adj");
      return { n, plural, adj, def, role, num: (sp && sp.num) || null };
    };
    const subj = mkNP(transitive ? "A" : "S", spec.subj, fr.sPool);
    const obj = transitive ? mkNP("O", spec.obj, fr.oPool) : null;
    const tense = spec.tense || rng.pick(L.tense.set);
    const evid = L.evid ? spec.evid || rng.pick(["VIS", "INFR", "REP"]) : null;
    const neg = spec.neg ?? rng.chance(0.15);
    const q = spec.q ?? (!neg && rng.chance(0.15));
    let adjCase = spec.adjunct;
    if (adjCase === undefined) adjCase = rng.chance(0.18) ? (L.cases.INS && (!L.cases.LOC || rng.chance(0.5)) ? "INS" : L.cases.LOC ? "LOC" : null) : null;
    let adjunct = null;
    if (adjCase) {
      const n = spec.adjunctN || pickNoun(rng, L, mode === "surreal" ? null : adjCase === "INS" ? TOOLS : PLACES, (n) => !n.anim);
      stems.add(n.en, "n");
      const m = [{ syls: n.w.syls, gloss: n.en }];
      if (L.def) m.push({ syls: L.def.syls, gloss: "DEF" });
      m.push({ syls: L.cases[adjCase].syls, gloss: adjCase });
      adjunct = { words: [word(m)], en: (adjCase === "INS" ? " with the " : " at the ") + n.en };
    }
    const person = subj.pr ? subj.pr.gloss : subj.plural ? "3PL" : "3SG";
    const groups = {
      S: subj.pr ? pronPhrase(L, subj.pr, subj.role) : nounPhrase(L, subj),
      V: verbPhrase(L, { verb, tense, evid, neg, person }),
      O: obj ? (obj.pr ? pronPhrase(L, obj.pr, "O") : nounPhrase(L, obj)) : [],
    };
    const seq = [];
    const verbFinal = L.order.endsWith("V");
    for (const ch of L.order) {
      if (ch === "V" && verbFinal && adjunct) seq.push(...adjunct.words);
      seq.push(...groups[ch]);
    }
    if (adjunct && !verbFinal) seq.push(...adjunct.words);
    if (q && L.q.type === "initial") seq.unshift(word([{ syls: L.q.particle.syls, gloss: "Q" }]));
    if (q && L.q.type === "final") seq.push(word([{ syls: L.q.particle.syls, gloss: "Q" }]));
    /* english */
    const S = enNP(subj, false), O = (obj ? " " + enNP(obj, true) : "") + (adjunct ? adjunct.en : "");
    const sg3 = subj.pr ? subj.pr.sg : !subj.plural;
    const base = verb.en;
    let en;
    if (q) en = `${tense === "PST" ? "Did" : tense === "FUT" ? "Will" : sg3 ? "Does" : "Do"} ${S} ${base}${O}?`;
    else if (neg) en = `${S} ${tense === "PST" ? "did not" : tense === "FUT" ? "will not" : sg3 ? "does not" : "do not"} ${base}${O}.`;
    else en = `${S} ${tense === "PST" ? verb.past : tense === "FUT" ? "will " + base : sg3 ? s3(base) : base}${O}.`;
    en = en.charAt(0).toUpperCase() + en.slice(1);
    if (evid) en += evid === "VIS" ? " [speaker saw it]" : evid === "INFR" ? " [speaker infers it]" : " [speaker was told]";
    return { words: seq, en, q, stems: info.map((x) => x.en), stemInfo: info, known: !!spec.known };
  }

  /* ---------------- prose ---------------- */
  const ORDER_WORDS = { S: "subject", O: "object", V: "verb" };
  const CASE_NAMES = { ACC: "accusative (marks the object)", ERG: "ergative (marks the subject of a transitive verb only)", GEN: "genitive (possessor)", DAT: "dative (recipient, goal)", LOC: "locative (place)", INS: "instrumental (tool, means)" };
  function grammarProse(L) {
    const out = [];
    out.push(`Basic word order is ${L.order.split("").map((c) => ORDER_WORDS[c]).join("–")}. Adjectives come ${L.adjBefore ? "before" : "after"} the noun they describe.`);
    if (L.alignment === "nomacc") out.push(`Subjects are unmarked; objects take the accusative suffix -${L.cases.ACC.rom}.`);
    if (L.alignment === "ergabs") out.push(`Alignment is ergative: the subject of a transitive verb takes -${L.cases.ERG.rom}, while objects and the subjects of intransitive verbs are unmarked. "The dog sleeps" and "the dog" in "the wolf bit the dog" look identical; "the dog" in "the dog bit the wolf" does not.`);
    if (L.alignment === "none") out.push(`There is no case marking for subject and object; word order alone tells them apart.`);
    const extra = Object.keys(L.cases).filter((c) => !["ACC", "ERG"].includes(c));
    out.push(`Other case suffixes: ${extra.map((c) => `-${L.cases[c].rom} ${CASE_NAMES[c]}`).join("; ")}.`);
    if (L.plural.type === "suffix") out.push(`Plural is marked with the suffix -${L.plural.morph.rom}.`);
    if (L.plural.type === "prefix") out.push(`Plural is marked with the prefix ${L.plural.morph.rom}-.`);
    if (L.plural.type === "redup") out.push(`Plural is formed by repeating the first syllable of the noun.`);
    if (L.plural.type === "none") out.push(`Nouns do not mark number; a numeral or context does that work.`);
    if (L.def) out.push(`Definiteness is marked by the suffix -${L.def.rom} ("the"). Indefinite nouns are bare. Case comes after it.`);
    else out.push(`There are no articles; "the" and "a" in translations are free.`);
    if (L.classes) out.push(`Nouns fall into ${L.classes.n} classes. Class I holds people and animals. ${L.classes.n === 2 ? "Class II holds everything else." : "Classes II and III split the rest with no obvious logic; they must be memorized."} Adjectives agree with the class of their noun by prefix: ${L.classes.agr.map((a, i) => `${a.rom}- for class ${["I", "II", "III"][i]}`).join(", ")}.`);
    const tm = L.tense.morphs;
    if (L.tense.set.length === 2) out.push(`Verbs distinguish past and non-past. Non-past is unmarked; past takes the ${L.tense.type} ${L.tense.type === "suffix" ? "-" + tm.PST.rom : tm.PST.rom + "-"}.`);
    else out.push(`Verbs mark tense with ${L.tense.type === "suffix" ? "suffixes" : "prefixes"}: past ${L.tense.type === "suffix" ? "-" + tm.PST.rom : tm.PST.rom + "-"}, future ${L.tense.type === "suffix" ? "-" + tm.FUT.rom : tm.FUT.rom + "-"}. Present is unmarked.`);
    if (L.evid) out.push(`Every finite verb carries an evidential suffix saying how the speaker knows: -${L.evid.VIS.rom} witnessed, -${L.evid.INFR.rom} inferred from evidence, -${L.evid.REP.rom} reported by someone else. Leaving it off is ungrammatical.`);
    if (L.agree) out.push(`Verbs agree with their subject by prefix: ${L.prons.map((p) => `${L.agree[p.gloss].rom}- (${p.en})`).join(", ")}.`);
    if (L.neg.type === "particle") out.push(`Negation: the particle ${L.neg.particle.rom} stands directly before the verb.`);
    if (L.neg.type === "suffix") out.push(`Negation: the suffix -${L.neg.suffix.rom} on the verb, after tense${L.evid ? " and evidential" : ""}.`);
    if (L.neg.type === "circumfix") out.push(`Negation is two-part: ${L.neg.particle.rom} before the verb and -${L.neg.suffix.rom} on the end of it. Both are required.`);
    if (L.q.type === "initial") out.push(`Yes/no questions begin with the particle ${L.q.particle.rom}.`);
    if (L.q.type === "final") out.push(`Yes/no questions end with the particle ${L.q.particle.rom}.`);
    if (L.q.type === "intonation") out.push(`Yes/no questions have no marker; only intonation distinguishes them.`);
    out.push(`Numerals take the adjective slot, ${L.adjBefore ? "before" : "after"} the noun${L.plural.type === "none" ? "; the noun is unchanged" : ", and the noun is plural"}.`);
    out.push(`Derivation: -${L.deriv.AGT.rom} makes an agent noun from a verb (hunt → hunter); -${L.deriv.PLACE.rom} makes a place noun (fire → hearth).`);
    out.push(`Stress falls on ${L.ph.stress}.`);
    for (const qk of L.quirks) out.push(qk.note);
    return out;
  }
  function numWord(L, n) {
    const b = L.numBase;
    if (n <= b) return L.nums[n - 1].rom;
    const a = Math.floor(n / b), r = n % b;
    let s = (a > 1 ? L.nums[a - 1].rom + " " : "") + L.nums[b - 1].rom;
    if (r) s += (L.numJoin ? " " + L.numJoin.rom : "") + " " + L.nums[r - 1].rom;
    return s;
  }
  function dictionary(L) {
    const rows = [];
    for (const n of L.nouns) if (n.w) rows.push({ rom: n.w.rom, ipa: n.w.ipa, pos: "n.", en: n.dict || n.en, cls: L.classes ? ["I", "II", "III"][n.cls] : null, key: n.w.rom + n.en });
    for (const v of L.verbs) rows.push({ rom: v.w.rom, ipa: v.w.ipa, pos: "v.", en: v.dict || v.en, key: v.w.rom + v.en });
    for (const a of L.adjs) rows.push({ rom: a.w.rom, ipa: a.w.ipa, pos: "adj.", en: a.dict || a.en, key: a.w.rom + a.en });
    for (const p of L.prons) rows.push({ rom: p.w.rom, ipa: p.w.ipa, pos: "pron.", en: p.en, key: p.w.rom + p.en });
    for (const [k, w] of Object.entries(L.misc)) rows.push({ rom: w.rom, ipa: w.ipa, pos: k === "and" ? "conj." : k === "yes" || k === "no" ? "interj." : k === "what" || k === "who" ? "pron." : "adv.", en: k, key: w.rom + k });
    const seen = new Set();
    return rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true))).sort((a, b) => a.rom.localeCompare(b.rom));
  }
  const surfaceOf = (s) => s.words.map((w) => w.surface).join(" ") + (s.q ? "?" : ".");
  const HELL_TASK = [
    "1. State the basic word order (subject, object, verb).",
    "2. State how the subject and the object of a transitive verb are distinguished (case marking, word order, or both), and whether intransitive subjects pattern with transitive subjects or with objects.",
    "3. List every bound affix and every free particle you can identify, with its position (prefix, suffix, particle before/after the verb) and its function.",
    "4. Identify the plural marker, the tense markers, the negation strategy, and the question strategy, or state that the text shows none.",
  ];
  function hellAnswers(L) {
    const a = [];
    a.push(`1. ${L.order}.`);
    a.push(`2. ${L.alignment === "nomacc" ? `Objects carry -${L.cases.ACC.rom}; subjects are bare; intransitive subjects pattern with transitive subjects (accusative alignment).` : L.alignment === "ergabs" ? `Transitive subjects carry -${L.cases.ERG.rom}; objects and intransitive subjects are bare (ergative alignment).` : "Word order only; no case marking; intransitive and transitive subjects are identical."}`);
    const m = [];
    for (const [c, w] of Object.entries(L.cases)) m.push(`-${w.rom} suffix, ${CASE_NAMES[c].split(" (")[0]} case`);
    if (L.plural.type === "suffix") m.push(`-${L.plural.morph.rom} suffix, plural`);
    if (L.plural.type === "prefix") m.push(`${L.plural.morph.rom}- prefix, plural`);
    if (L.plural.type === "redup") m.push(`first-syllable reduplication, plural`);
    if (L.def) m.push(`-${L.def.rom} suffix, definite`);
    if (L.classes) L.classes.agr.forEach((w, i) => m.push(`${w.rom}- prefix on adjectives, agreement with noun class ${["I", "II", "III"][i]}`));
    for (const [t, w] of Object.entries(L.tense.morphs)) m.push(`${L.tense.type === "suffix" ? "-" + w.rom : w.rom + "-"} ${L.tense.type}, ${t === "PST" ? "past" : "future"} tense`);
    if (L.evid) for (const [e, w] of Object.entries(L.evid)) m.push(`-${w.rom} suffix, evidential (${e === "VIS" ? "witnessed" : e === "INFR" ? "inferred" : "reported"})`);
    if (L.agree) for (const p of L.prons) m.push(`${L.agree[p.gloss].rom}- prefix on verbs, subject agreement (${p.en})`);
    if (L.neg.particle) m.push(`${L.neg.particle.rom} particle before the verb, negation`);
    if (L.neg.suffix) m.push(`-${L.neg.suffix.rom} suffix, negation`);
    if (L.q.particle) m.push(`${L.q.particle.rom} particle at the ${L.q.type === "initial" ? "start" : "end"} of the sentence, yes/no question`);
    m.push(`-${L.deriv.AGT.rom} suffix, agent noun from verb`, `-${L.deriv.PLACE.rom} suffix, place noun`);
    a.push("3. " + m.join("; ") + ".");
    a.push(`4. Plural: ${L.plural.type === "none" ? "not marked" : "see above"}. Tense: ${Object.keys(L.tense.morphs).join(", ")} marked, ${L.tense.set.includes("PRS") ? "present" : "non-past"} unmarked. Negation: ${L.neg.type}. Question: ${L.q.type === "intonation" ? "no marker" : L.q.type + " particle"}.`);
    return a;
  }
  function puzzleText(L, hints) {
    if (hints === "hell") {
      const lines = [`A text in ${L.name}: ${L.sentences.length} sentences, no translations. Work out the structure.`, ""];
      L.sentences.forEach((s, i) => lines.push(`${i + 1}. ${surfaceOf(s)}`));
      lines.push("", "Task:", ...HELL_TASK);
      return lines.join("\n");
    }
    const lines = [`A text in ${L.name}. Work out the grammar and the vocabulary, then do the task at the end.`, ""];
    L.sentences.forEach((s, i) => lines.push(`${i + 1}. ${surfaceOf(s)}`));
    if (hints !== "none") {
      lines.push("", `Known: sentences 1–${L.knownCount} mean:`);
      L.sentences.slice(0, L.knownCount).forEach((s, i) => lines.push(`${i + 1}. ${s.en}`));
      lines.push("", `Numerals: ${[1, 2, 3, 4, 5].map((n) => `${n} = ${numWord(L, n)}`).join(", ")}.`);
    }
    if (hints === "bank") {
      const r = makeRng(L.seed + "|bank");
      const stems = r.shuffle([...new Set(L.sentences.flatMap((s) => s.stems))]);
      lines.push("", "Word bank (the English meaning of every stem in the text, in shuffled order; grammatical affixes and particles are not listed):", stems.join(", "));
    }
    lines.push("", `Task: translate into ${L.name}: "${L.task.en}"`);
    return lines.join("\n");
  }
  function keyText(L) {
    const lines = [`${L.name} [${L.nameIpa}] — reference grammar (seed: ${L.seed})`, "", "SOUNDS"];
    lines.push(`Consonants: ${L.ph.cons.map((c) => c.rom + (c.rom !== c.ipa ? ` [${c.ipa}]` : "")).join(" ")}`);
    lines.push(`Vowels: ${L.ph.vowels.map((c) => c.rom + (c.rom !== c.ipa ? ` [${c.ipa}]` : "")).join(" ")}`);
    lines.push("", "GRAMMAR", ...grammarProse(L));
    lines.push("", "NUMBERS", `Base ${L.numBase}. ` + L.nums.map((w, i) => `${i + 1} ${w.rom}`).join(", ") + `. ${L.numBase + 3} = ${numWord(L, L.numBase + 3)}; ${2 * L.numBase + 5} = ${numWord(L, 2 * L.numBase + 5)}.`);
    lines.push("", "TEXT");
    L.sentences.forEach((s, i) => { lines.push(`${i + 1}. ${surfaceOf(s)}`, `   ${s.words.map((w) => w.gloss).join(" ")}`, `   ${s.en}`); });
    lines.push("", "TASK", `"${L.task.en}"`, `= ${surfaceOf(L.task)}`, `  ${L.task.words.map((w) => w.gloss).join(" ")}`);
    const sv = L.solvability;
    lines.push("", "HELL-MODE ANSWERS", ...hellAnswers(L));
    lines.push("", "SOLVABILITY CHECK", `Translated sentences: ${L.knownCount}. Stems a solver can pin from them (same part of speech, one unknown per sentence, propagated): ${sv.known.size - 5} of ${new Set(L.sentences.flatMap((s) => s.stems)).size} in the text.`);
    lines.push(`Task stems: ${L.task.stemInfo.map((st) => `${st.en} (${sv.known.has(st.en) ? "pinned" : sv.derivable.has(st.en) ? "derivable" : "NOT PINNED"})`).join(", ")}.`);
    lines.push(`Task word-shapes attested in the corpus: ${sv.shapes.need.join(", ")}${sv.shapes.missing.length ? " — MISSING: " + sv.shapes.missing.join(", ") : " — all present"}. Numeral and adjective together in one phrase: ${sv.shapes.numAdjMissing ? "MISSING" : "attested"}.`);
    lines.push("", "DICTIONARY");
    for (const r of dictionary(L)) lines.push(`${r.rom} [${r.ipa}] ${r.pos} ${r.en}${r.cls ? ` (class ${r.cls})` : ""}`);
    return lines.join("\n");
  }

  /* ---------------- markup ----------------
     The page is split in two: the puzzle, which is all a solver should see,
     and the answer, which stays hidden until it is asked for. Everything that
     gives the game away — the grammar prose, the glosses, the translations,
     the dictionary, the summary of word order and alignment — lives in the
     second half. */
  const TEMPLATE = `
    <div class="ctl">
      <input type="text" id="cf-seed" aria-label="Seed">
      <button type="button" id="cf-use">Use seed</button>
      <button type="button" id="cf-roll">New language</button>
    </div>
    <h2>Language Forge</h2>
    <p class="note" style="margin-top:6px">A whole language out of a seed — sounds, grammar, words — and a puzzle in it that is checked to be solvable from the clues you're given. Every language on this page has never existed before.</p>

    <div class="cf-head">
      <div class="langname" id="cf-name"></div>
      <div class="ipa" id="cf-nameipa"></div>
      <p class="note" id="cf-tally"></p>
      <div class="spec" id="cf-spec"></div>
    </div>

    <h3>The puzzle</h3>
    <div class="ctl" style="margin-bottom:12px" role="group" aria-label="Difficulty">
      <span class="note">Difficulty</span>
      <button type="button" id="cf-bank">Easy</button>
      <button type="button" id="cf-three">Standard</button>
      <button type="button" id="cf-hell">Hell</button>
    </div>
    <p class="note" id="cf-diffnote"></p>

    <div id="cf-puzzleview"></div>

    <p class="note" style="margin-top:18px">The same thing as plain text, to carry somewhere else. Nothing below the fold is in it.</p>
    <div class="ctl" style="margin-bottom:8px">
      <button type="button" id="cf-copy">Copy the puzzle</button>
      <span class="note" id="cf-copied"></span>
    </div>
    <textarea id="cf-text" readonly aria-label="Puzzle text"></textarea>

    <h3>The answer</h3>
    <p class="note" id="cf-answernote"></p>
    <textarea id="cf-answer" class="cf-answerbox" aria-label="Answer" placeholder="Put an answer here…"></textarea>
    <div class="ctl" style="margin-top:8px">
      <button type="button" id="cf-check">Check it</button>
      <button type="button" id="cf-reveal"></button>
    </div>
    <div id="cf-verdict"></div>

    <div id="cf-key" hidden>
      <p class="note" id="cf-summary"></p>

      <h3>Sounds</h3>
      <table><tbody id="cf-sounds"></tbody></table>
      <p class="note" style="margin-top:8px" id="cf-rom"></p>

      <h3>Grammar</h3>
      <div id="cf-grammar"></div>

      <h3>Numbers</h3>
      <div class="num" id="cf-nums"></div>
      <p style="margin-top:10px" id="cf-numprose"></p>

      <h3>The text, glossed</h3>
      <div class="ctl" style="margin-bottom:14px" role="group" aria-label="Sentence style">
        <button type="button" id="cf-plausible">Plausible</button>
        <button type="button" id="cf-surreal">Surreal</button>
        <span class="note">Same grammar and words either way; only the sentences change.</span>
      </div>
      <div id="cf-sentences"></div>
      <p class="note" id="cf-corpusnote"></p>
      <p style="margin-top:14px">Task sentence: <span class="tr" id="cf-tasken"></span></p>
      <div id="cf-task"></div>
      <p class="note" id="cf-tasknote"></p>

      <h3>The full key, as text</h3>
      <div class="ctl" style="margin-bottom:8px">
        <button type="button" id="cf-copykey">Copy the key</button>
        <span class="note" id="cf-copiedkey"></span>
      </div>
      <textarea id="cf-keytext" readonly aria-label="Answer key"></textarea>

      <h3>Dictionary</h3>
      <div class="dict" id="cf-dict"></div>
    </div>
  `;

  /* ---------------- UI ---------------- */
  const root = document.getElementById("forge");
  if (!root) return;
  root.className = "cf";
  root.innerHTML = TEMPLATE;

  const el = (id) => root.querySelector("#" + id);
  const seedInput = el("cf-seed"), textEl = el("cf-text"), keyTextEl = el("cf-keytext"),
    answerEl = el("cf-answer"), verdictEl = el("cf-verdict"), keyBox = el("cf-key");

  const DIFF = {
    bank: { label: "Easy", note: "The text, the first few sentences translated, the numerals, and a word bank listing the English meaning of every stem. The task is a translation." },
    three: { label: "Standard", note: "The text, the first few sentences translated, and the numerals. No word bank — you have to work out which word is which. The task is a translation." },
    hell: { label: "Hell", note: "Sixty sentences, no translations, no word list, no numerals. Vocabulary can't be recovered without an anchor, so the task asks for the grammar instead: word order, alignment, and every affix you can find." },
  };

  /* ---------------- addressable puzzles ----------------
     ?forge_mode=hell&forge_seed=31337&forge_style=surreal — a puzzle is a link,
     so it can be handed to someone (or something) else and come back the same
     puzzle. The URL uses the difficulty's public name; the internal keys are
     accepted as aliases. Anything unrecognized falls back to the default. */
  const URL_MODE = "forge_mode", URL_SEED = "forge_seed", URL_STYLE = "forge_style";
  const MODE_OUT = { bank: "easy", three: "standard", hell: "hell" };
  const MODE_IN = { easy: "bank", standard: "three", hell: "hell", bank: "bank", three: "three" };
  function fromUrl() {
    let p;
    try { p = new URLSearchParams(location.search); } catch { return {}; }
    const mode = MODE_IN[(p.get(URL_MODE) || "").toLowerCase()];
    const style = (p.get(URL_STYLE) || "").toLowerCase();
    const seed = p.get(URL_SEED);
    return {
      hints: mode || null,
      style: style === "surreal" || style === "plausible" ? style : null,
      seed: seed || null,
    };
  }
  function toUrl() {
    try {
      const p = new URLSearchParams(location.search);
      p.set(URL_MODE, MODE_OUT[state.hints]);
      p.set(URL_SEED, state.seed);
      p.set(URL_STYLE, state.style);
      history.replaceState(null, "", location.pathname + "?" + p + location.hash);
    } catch { /* file:// and the like — playing still works, linking doesn't */ }
  }

  const fromLink = fromUrl();
  const state = {
    seed: fromLink.seed || String(Math.floor(Math.random() * 1e6)),
    style: fromLink.style || "plausible",
    hints: fromLink.hints || "bank",
    revealed: false,
    L: null,
  };

  /* small DOM helper: h("span.g", "text") or h("div", [child, child]) */
  function h(spec, content) {
    const [tag, ...cls] = spec.split(".");
    const node = document.createElement(tag || "div");
    if (cls.length) node.className = cls.join(" ");
    if (Array.isArray(content)) content.forEach((c) => c && node.appendChild(c));
    else if (content != null) node.textContent = String(content);
    return node;
  }
  const fill = (node, kids) => { node.textContent = ""; kids.forEach((k) => k && node.appendChild(k)); };

  /* a gloss like "dog-PL-ACC": grammatical tags in small caps, stems as-is */
  function glossNode(text) {
    const span = h("span");
    text.split("-").forEach((p, i) => {
      if (i > 0) span.appendChild(document.createTextNode("-"));
      span.appendChild(/^[A-Z0-9]+$/.test(p) ? h("span.g", p.toLowerCase()) : document.createTextNode(p));
    });
    return span;
  }

  /* interlinear: surface line over gloss line, then the free translation */
  function sentenceNode(s, showTr) {
    const il = h("div.il");
    s.words.forEach((w, i) => {
      const stack = h("span");
      stack.appendChild(h("span.top", w.surface + (i === s.words.length - 1 ? (s.q ? "?" : ".") : "")));
      if (showTr) {
        const bot = h("span.bot");
        bot.appendChild(glossNode(w.gloss));
        stack.appendChild(bot);
      }
      il.appendChild(stack);
    });
    const out = h("div.sent", [il]);
    if (showTr) out.appendChild(h("div.tr", s.en));
    return out;
  }

  /* a numbered line: "12. thaki muun." */
  const numbered = (i, text, cls) => h("div." + cls, [h("span.n", i + "."), h("span", text)]);

  const setOn = (id, on) => {
    const b = el(id);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  };

  /* ---------------- the puzzle half ---------------- */
  function renderPuzzle() {
    const L = state.L, hints = state.hints;

    for (const k of ["bank", "three", "hell"]) setOn("cf-" + k, hints === k);
    el("cf-diffnote").textContent = DIFF[hints].note;

    el("cf-name").textContent = L.name;
    el("cf-nameipa").textContent = "[" + L.nameIpa + "]";
    /* nothing here may describe the grammar: Hell asks for exactly that */
    el("cf-tally").textContent = `Seed ${L.seed} · ${L.sentences.length} sentences · ${DIFF[hints].label}`;
    el("cf-spec").textContent = surfaceOf(L.sentences[0]);

    const view = [];
    view.push(h("p", `A text in ${L.name}${hints === "hell"
      ? ", with no translations. Work out the structure."
      : ". Work out the grammar and the vocabulary, then do the task at the end."}`));

    const text = h("div.corpus");
    L.sentences.forEach((s, i) => text.appendChild(numbered(i + 1, surfaceOf(s), "cline")));
    view.push(text);

    if (hints !== "hell") {
      view.push(h("p.subhead", `Known: sentences 1–${L.knownCount} mean:`));
      const tr = h("div.corpus");
      L.sentences.slice(0, L.knownCount).forEach((s, i) => tr.appendChild(numbered(i + 1, s.en, "cline eng")));
      view.push(tr);
      view.push(h("p", "Numerals: " + [1, 2, 3, 4, 5].map((n) => `${n} = ${numWord(L, n)}`).join(", ") + "."));
    }
    if (hints === "bank") {
      const r = makeRng(L.seed + "|bank");
      const stems = r.shuffle([...new Set(L.sentences.flatMap((s) => s.stems))]);
      view.push(h("p.subhead", "Word bank"));
      view.push(h("p.note", "The English meaning of every stem in the text, shuffled. Grammatical affixes and particles are not listed."));
      view.push(h("p", stems.join(", ") + "."));
    }

    view.push(h("p.subhead", "Task"));
    if (hints === "hell") {
      const ol = h("div.corpus");
      HELL_TASK.forEach((t) => ol.appendChild(h("div.cline", [h("span", t)])));
      view.push(ol);
    } else {
      view.push(h("p", [document.createTextNode(`Translate into ${L.name}: `), h("span.tr", `"${L.task.en}"`)]));
    }
    fill(el("cf-puzzleview"), view);

    textEl.value = puzzleText(L, hints);
  }

  /* ---------------- checking an answer ----------------
     Models explain themselves, so the expected sentence is looked for inside
     whatever came back rather than compared to the whole of it. Apostrophes are
     left alone: they spell glottal stops and ejectives, so they are letters. */
  const normalize = (s) => s.toLowerCase().replace(/[.,;:!?()[\]"“”]/g, " ").replace(/\s+/g, " ").trim();

  function check() {
    const L = state.L, given = answerEl.value.trim();
    if (!given) {
      fill(verdictEl, [h("p.note", "Paste an answer first, or just reveal the key.")]);
      return;
    }
    if (state.hints === "hell") {
      fill(verdictEl, [h("p.verdict.open", "Hell asks for an analysis, not a sentence, so there is nothing to match against."),
        h("p.note", "Reveal the key and compare it yourself — the grammar section and the four numbered answers at the bottom of the key text are what to read against.")]);
      state.revealed = true;
      renderAnswer();
      return;
    }
    const want = surfaceOf(L.task), got = normalize(given);
    const hit = got.includes(normalize(want));
    fill(verdictEl, [
      h("p.verdict." + (hit ? "right" : "wrong"), hit ? "Correct." : "Not a match."),
      h("p.note", hit
        ? "The expected sentence appears in the answer."
        : "The expected sentence does not appear in the answer. Word order or a single affix is usually what went wrong — the glosses below show where."),
      h("div.compare", [
        h("div", [h("span.clabel", "Expected"), h("span.L", want)]),
        h("div", [h("span.clabel", "Given"), h("span.given", given.length > 400 ? given.slice(0, 400) + "…" : given)]),
      ]),
    ]);
    state.revealed = true;
    renderAnswer();
  }

  /* ---------------- the answer half ---------------- */
  function renderAnswer() {
    const L = state.L;

    el("cf-answernote").textContent = state.hints === "hell"
      ? "Put an analysis here to keep it beside the key, then reveal. Hell is graded by eye, not by this page."
      : "Put an answer here and check it before you look. Committing first is the whole point — it is the difference between a test and a reading.";
    el("cf-reveal").textContent = state.revealed ? "Hide the answer" : "Reveal the answer";
    el("cf-reveal").setAttribute("aria-expanded", String(state.revealed));
    keyBox.hidden = !state.revealed;
    if (!state.revealed) return;

    el("cf-summary").textContent =
      `${L.ph.cons.length + L.ph.vowels.length} sounds, ${L.order} order, ` +
      `${L.alignment === "ergabs" ? "ergative" : L.alignment === "nomacc" ? "accusative" : "no case"} alignment` +
      `${L.evid ? ", evidential verbs" : ""}${L.classes ? `, ${L.classes.n} noun classes` : ""}, base-${L.numBase} numbers.`;

    /* sounds */
    const row = (label, valNode) => h("tr", [h("td", label), valNode]);
    fill(el("cf-sounds"), [
      row("Consonants", h("td.L", L.ph.cons.map((c) => c.rom).join(" "))),
      row("Vowels", h("td.L", L.ph.vowels.map((c) => c.rom).join(" "))),
      row("Syllable", h("td",
        `${L.ph.onsetRequired ? "C" : "(C)"}V${L.ph.codaType === "none" ? "" : "(C)"}` +
        `${L.ph.clusters.length ? ", initial clusters allowed" : ""}; ` +
        `${L.ph.onsetRequired ? "every syllable begins with a consonant" : "syllables may begin with a vowel"}; ` +
        (L.ph.codaType === "none" ? "no final consonants"
          : L.ph.codaType === "nasal" ? "only nasals can end a syllable"
          : L.ph.codaType === "sonorant" ? "only nasals and liquids can end a syllable"
          : `final consonants: ${L.ph.codas.map((c) => c.rom).join(" ")}`))),
    ]);
    const romNotes = L.ph.cons.concat(L.ph.vowels).filter((c) => c.rom !== c.ipa).map((c) => `${c.rom} = [${c.ipa}]`).join(", ");
    el("cf-rom").textContent = "Spelling is a plain romanization: " + (romNotes || "every letter is its IPA value") + ".";

    /* grammar */
    fill(el("cf-grammar"), grammarProse(L).map((p) => h("p", p)));

    /* numbers */
    const nums = [];
    L.nums.forEach((w, i) => { nums.push(h("span", String(i + 1))); nums.push(h("span.L", w.rom)); });
    fill(el("cf-nums"), nums);
    el("cf-numprose").textContent =
      `Counting is base ${L.numBase}. Higher numbers are multiples of ${L.numBase} plus a remainder: ` +
      `${L.numBase + 3} is ${numWord(L, L.numBase + 3)}, ${2 * L.numBase + 5} is ${numWord(L, 2 * L.numBase + 5)}.`;

    /* glossed text */
    setOn("cf-plausible", state.style === "plausible"); setOn("cf-surreal", state.style === "surreal");
    fill(el("cf-sentences"), L.sentences.map((s) => sentenceNode(s, true)));
    el("cf-corpusnote").textContent =
      `Sentences 1–${L.knownCount} are the ones the puzzle translates. The designed set varies one animate noun, ` +
      `one inanimate noun, one transitive and one intransitive verb a feature at a time; the rest are random, plus a few ` +
      `added so every grammatical marker appears at least twice and every word-shape the task needs is attested.`;
    el("cf-tasken").textContent = L.task.en;
    fill(el("cf-task"), [sentenceNode(L.task, true)]);
    el("cf-tasknote").textContent =
      `Every stem in it is ${L.task.stemInfo.every((st) => L.solvability.known.has(st.en)) ? "pinned by" : "pinned by, or derivable from,"} ` +
      `the ${L.knownCount} translated sentences, and every word-shape it needs is attested somewhere in the corpus. ` +
      `The key text below reports that check in full.`;

    keyTextEl.value = keyText(L);

    /* dictionary */
    fill(el("cf-dict"), dictionary(L).map((r) => {
      const d = h("div", [h("span.L", r.rom), document.createTextNode(" "), h("span.ipa", "[" + r.ipa + "]"),
        document.createTextNode(` ${r.pos} ${r.en}`)]);
      if (r.cls) d.appendChild(h("span.note", " · " + r.cls));
      return d;
    }));
  }

  const render = () => { renderPuzzle(); renderAnswer(); };

  function rebuild() {
    el("cf-name").textContent = "Forging…";
    toUrl();
    /* a new language means a new puzzle: close the key and drop the old answer */
    state.revealed = false;
    answerEl.value = "";
    verdictEl.textContent = "";
    /* let the browser paint before the synchronous generate */
    setTimeout(() => {
      state.L = buildLanguage(state.seed, state.style, state.hints === "hell" ? 60 : 30);
      render();
    }, 0);
  }

  /* ---------------- events ---------------- */
  const onClick = (id, fn) => el(id).addEventListener("click", fn);
  onClick("cf-use", () => { state.seed = seedInput.value; rebuild(); });
  onClick("cf-roll", () => {
    state.seed = String(Math.floor(Math.random() * 1e6));
    seedInput.value = state.seed;
    rebuild();
  });
  seedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); state.seed = seedInput.value; rebuild(); }
  });

  /* difficulty changes the corpus size, so the language is rebuilt; grammar and
     lexicon are unchanged because they are drawn before any sentence is generated */
  for (const k of ["bank", "three", "hell"]) onClick("cf-" + k, () => { if (state.hints !== k) { state.hints = k; rebuild(); } });
  for (const s of ["plausible", "surreal"]) onClick("cf-" + s, () => { if (state.style !== s) { state.style = s; rebuild(); } });

  onClick("cf-check", check);
  onClick("cf-reveal", () => { state.revealed = !state.revealed; renderAnswer(); });

  const copier = (btn, src, label) => onClick(btn, async () => {
    try { await navigator.clipboard.writeText(src.value); el(label).textContent = "Copied"; }
    catch { el(label).textContent = "Select the text and copy it"; }
    setTimeout(() => { el(label).textContent = ""; }, 2500);
  });
  copier("cf-copy", textEl, "cf-copied");
  copier("cf-copykey", keyTextEl, "cf-copiedkey");
  textEl.addEventListener("focus", () => textEl.select());
  keyTextEl.addEventListener("focus", () => keyTextEl.select());

  seedInput.value = state.seed;
  rebuild();
})();
