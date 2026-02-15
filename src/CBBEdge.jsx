import { useState, useEffect, useRef } from "react";

// ============================================================
// SIMULATION ENGINE — UNTOUCHED LOGIC
// ============================================================
function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function parseFormBoost(form) {
  if (!form || typeof form !== "string") return 0;
  const w = (form.match(/W|Won/gi) || []).length;
  const l = (form.match(/L|Lost/gi) || []).length;
  const t = w + l;
  if (t < 3) return 0;
  return (w / t - 0.5) * 0.008;
}

function runMonteCarloSim(home, away, intangibles, numSims = 2000) {
  const results = [], homeMargins = [], homeTotals = [];
  const homeExpEff = ((home.adjOE || 105) + (away.adjDE || 105)) / 2;
  const awayExpEff = ((away.adjOE || 105) + (home.adjDE || 105)) / 2;
  let homeExpPPP = homeExpEff / 100, awayExpPPP = awayExpEff / 100;

  const calcInjuryDrag = (team) => {
    if (!team.injuries || !Array.isArray(team.injuries)) return 0;
    let drag = 0;
    team.injuries.forEach(inj => {
      if (inj.status === "OUT" && inj.ppg) {
        drag += (inj.ppg * (inj.role === "Starter" ? 0.5 : inj.role === "Key Bench" ? 0.3 : 0.15)) / 100;
      } else if (inj.status === "DOUBTFUL" && inj.ppg) {
        drag += (inj.ppg * 0.35) / 100;
      } else if (inj.status === "QUESTIONABLE" && inj.ppg) {
        drag += (inj.ppg * 0.15) / 100;
      }
    });
    return drag;
  };

  const homeInjDrag = calcInjuryDrag(home), awayInjDrag = calcInjuryDrag(away);
  homeExpPPP -= homeInjDrag;
  awayExpPPP -= awayInjDrag;

  const d1Avg = { to: 18, or: 28, ftr: 30, efg: 50, ast: 52, blk: 8, threePt: 34, twoPt: 50, dReb: 72 };
  const homeMatchupTO = ((home.toRate || 18) + (away.defToRate || d1Avg.to)) / 200;
  const awayMatchupTO = ((away.toRate || 18) + (home.defToRate || d1Avg.to)) / 200;
  const homeMatchupOR = ((home.orRate || 28) + (100 - (away.defRebRate || d1Avg.dReb))) / 200;
  const awayMatchupOR = ((away.orRate || 28) + (100 - (home.defRebRate || d1Avg.dReb))) / 200;
  const homeMatchupFTR = ((home.ftRate || 30) + (away.defFTRate || d1Avg.ftr)) / 200;
  const awayMatchupFTR = ((away.ftRate || 30) + (home.defFTRate || d1Avg.ftr)) / 200;
  const home3ptMake = ((home.threePtPct || 34) + (d1Avg.threePt * 2 - (away.def3ptPct || d1Avg.threePt))) / 200;
  const away3ptMake = ((away.threePtPct || 34) + (d1Avg.threePt * 2 - (home.def3ptPct || d1Avg.threePt))) / 200;
  const home2ptMake = ((home.twoPtPct || 50) + (d1Avg.twoPt * 2 - (away.def2ptPct || d1Avg.twoPt))) / 200;
  const away2ptMake = ((away.twoPtPct || 50) + (d1Avg.twoPt * 2 - (home.def2ptPct || d1Avg.twoPt))) / 200;
  const home3ptRate = Math.max(0.2, Math.min(0.5, (home.threePtRate || 35) / 100));
  const away3ptRate = Math.max(0.2, Math.min(0.5, (away.threePtRate || 35) / 100));
  const homeBlkAdj = Math.max(0, ((away.blockPct || 8) - d1Avg.blk)) * 0.005;
  const awayBlkAdj = Math.max(0, ((home.blockPct || 8) - d1Avg.blk)) * 0.005;
  const homeDefQ = 1 / ((home.adjDE || 105) / 100), awayDefQ = 1 / ((away.adjDE || 105) / 100);
  const defSum = homeDefQ + awayDefQ;
  const baseTempo = ((home.adjTempo || 67) * homeDefQ + (away.adjTempo || 67) * awayDefQ) / defSum;

  let homeBoost = 0, awayBoost = 0;
  homeBoost += 0.05;
  const restDiff = (intangibles.homeRestDays || 2) - (intangibles.awayRestDays || 2);
  if (restDiff !== 0) {
    const rb = Math.min(Math.abs(restDiff) * 0.004, 0.012);
    if (restDiff > 0) homeBoost += rb; else awayBoost += rb;
  }
  if (intangibles.awayTravel === "cross-country") awayBoost -= 0.007;
  else if (intangibles.awayTravel === "regional") awayBoost -= 0.002;
  const motMap = { low: -0.003, medium: 0, high: 0.004 };
  homeBoost += motMap[intangibles.homeMotivation] || 0;
  awayBoost += motMap[intangibles.awayMotivation] || 0;
  homeBoost += (intangibles.homeCoachAdj || 0) * 0.005;
  awayBoost += (intangibles.awayCoachAdj || 0) * 0.005;
  homeBoost += parseFormBoost(home.recentForm);
  awayBoost += parseFormBoost(away.recentForm);

  const theoreticalSpread = (homeExpPPP - awayExpPPP + homeBoost - awayBoost) * baseTempo;

  const calcExpPtsPerShot = (threeRate, threeMake, twoMake, ftr, blkAdj) => {
    return threeRate * threeMake * 3 + 0.12 * ftr * 2 * 0.72 + (1 - threeRate - 0.12) * (twoMake - blkAdj) * 2;
  };
  const homeRawPtsPerShot = calcExpPtsPerShot(home3ptRate, home3ptMake, home2ptMake, homeMatchupFTR, homeBlkAdj);
  const awayRawPtsPerShot = calcExpPtsPerShot(away3ptRate, away3ptMake, away2ptMake, awayMatchupFTR, awayBlkAdj);
  const homeNonTOrate = 1 - homeMatchupTO, awayNonTOrate = 1 - awayMatchupTO;
  const homeOrBonus = homeNonTOrate * 0.3 * homeMatchupOR * 0.8 * home2ptMake * 2;
  const awayOrBonus = awayNonTOrate * 0.3 * awayMatchupOR * 0.8 * away2ptMake * 2;
  const homeSimRawPPP = homeNonTOrate * homeRawPtsPerShot + homeOrBonus;
  const awaySimRawPPP = awayNonTOrate * awayRawPtsPerShot + awayOrBonus;
  const homeScale = homeSimRawPPP > 0 ? (homeExpPPP + homeBoost) / homeSimRawPPP : 1;
  const awayScale = awaySimRawPPP > 0 ? (awayExpPPP + awayBoost) / awaySimRawPPP : 1;

  for (let sim = 0; sim < numSims; sim++) {
    const gameTempo = baseTempo + gaussianRandom() * 2.5;
    const totalPoss = Math.round(Math.max(58, Math.min(80, gameTempo)));
    let homeScore = 0, awayScore = 0;

    for (let p = 0; p < totalPoss; p++) {
      // Home possession
      if (Math.random() < homeMatchupTO) {
        if (Math.random() < 0.30) awayScore += (Math.random() < 0.55 ? 2 : (Math.random() < 0.5 ? 1 : 3)) * awayScale;
      } else {
        let pts = 0;
        const shot = Math.random();
        if (shot < home3ptRate) { pts = Math.random() < home3ptMake ? 3 : 0; }
        else if (shot < home3ptRate + 0.12) { if (Math.random() < homeMatchupFTR * 2) { pts = (Math.random() < 0.72 ? 1 : 0) + (Math.random() < 0.72 ? 1 : 0); } }
        else { pts = Math.random() < (home2ptMake - homeBlkAdj) ? 2 : 0; if (pts === 2 && Math.random() < homeMatchupFTR * 0.1) pts += Math.random() < 0.72 ? 1 : 0; }
        homeScore += pts * homeScale;
        if (pts === 0 && Math.random() < homeMatchupOR * 0.8) { homeScore += (Math.random() < home2ptMake ? 2 : 0) * homeScale; }
      }

      // Away possession
      if (Math.random() < awayMatchupTO) {
        if (Math.random() < 0.30) homeScore += (Math.random() < 0.55 ? 2 : (Math.random() < 0.5 ? 1 : 3)) * homeScale;
      } else {
        let pts = 0;
        const shot = Math.random();
        if (shot < away3ptRate) { pts = Math.random() < away3ptMake ? 3 : 0; }
        else if (shot < away3ptRate + 0.12) { if (Math.random() < awayMatchupFTR * 2) { pts = (Math.random() < 0.72 ? 1 : 0) + (Math.random() < 0.72 ? 1 : 0); } }
        else { pts = Math.random() < (away2ptMake - awayBlkAdj) ? 2 : 0; if (pts === 2 && Math.random() < awayMatchupFTR * 0.1) pts += Math.random() < 0.72 ? 1 : 0; }
        awayScore += pts * awayScale;
        if (pts === 0 && Math.random() < awayMatchupOR * 0.8) { awayScore += (Math.random() < away2ptMake ? 2 : 0) * awayScale; }
      }
    }

    const margin = homeScore - awayScore;
    if (Math.abs(margin) < 6) {
      const ftEdge = (homeMatchupFTR - awayMatchupFTR) * 2.5;
      const toEdge = (awayMatchupTO - homeMatchupTO) * 10;
      homeScore += (ftEdge + toEdge) * (0.4 + Math.random() * 0.3);
    }
    homeScore = Math.round(Math.max(40, homeScore));
    awayScore = Math.round(Math.max(40, awayScore));
    results.push({ homeScore, awayScore, margin: homeScore - awayScore });
    homeMargins.push(homeScore - awayScore);
    homeTotals.push(homeScore + awayScore);
  }

  const homeWins = results.filter(r => r.margin > 0).length;
  const avgMargin = homeMargins.reduce((a, b) => a + b, 0) / numSims;
  const avgTotal = homeTotals.reduce((a, b) => a + b, 0) / numSims;
  const avgHome = results.reduce((a, r) => a + r.homeScore, 0) / numSims;
  const avgAway = results.reduce((a, r) => a + r.awayScore, 0) / numSims;
  const marginBuckets = {};
  homeMargins.forEach(m => { const b = Math.round(m / 3) * 3; marginBuckets[b] = (marginBuckets[b] || 0) + 1; });
  const coverProbs = [-15, -10, -7, -5, -3, -1, 1, 3, 5, 7, 10, 15].map(s => ({
    spread: s, coverPct: Math.round((results.filter(r => r.margin > s).length / numSims) * 100)
  }));
  const sorted = [...homeMargins].sort((a, b) => a - b);
  const pctile = (p) => sorted[Math.floor(numSims * p)];
  const stdDev = Math.sqrt(homeMargins.reduce((s, m) => s + (m - avgMargin) ** 2, 0) / numSims);
  const closeGames = results.filter(r => Math.abs(r.margin) <= 5).length;
  const dataFlags = [];
  if (Math.abs(home.adjOE - 105) < 1 && Math.abs(home.adjDE - 105) < 1) dataFlags.push("Limited data for home team — results may be less accurate");
  if (Math.abs(away.adjOE - 105) < 1 && Math.abs(away.adjDE - 105) < 1) dataFlags.push("Limited data for away team — results may be less accurate");
  if (Math.abs(avgMargin - theoreticalSpread) > 3) dataFlags.push("Sim spread diverges from theoretical by " + Math.round(Math.abs(avgMargin - theoreticalSpread) * 10) / 10 + " pts");

  return {
    homeWinPct: Math.round((homeWins / numSims) * 100),
    awayWinPct: Math.round(((numSims - homeWins) / numSims) * 100),
    avgMargin: Math.round(avgMargin * 10) / 10,
    avgTotal: Math.round(avgTotal * 10) / 10,
    avgHome: Math.round(avgHome * 10) / 10,
    avgAway: Math.round(avgAway * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    percentiles: { p10: pctile(0.1), p25: pctile(0.25), p50: pctile(0.5), p75: pctile(0.75), p90: pctile(0.9) },
    marginBuckets, coverProbs, numSims,
    homeExpPPP: Math.round(homeExpPPP * 1000) / 10,
    awayExpPPP: Math.round(awayExpPPP * 1000) / 10,
    closeGamePct: Math.round((closeGames / numSims) * 100),
    paceControl: Math.round(baseTempo * 10) / 10,
    theoreticalSpread: Math.round(theoreticalSpread * 10) / 10,
    dataFlags,
    rawInput: {
      homeAdjOE: home.adjOE, homeAdjDE: home.adjDE, homeTempo: home.adjTempo,
      awayAdjOE: away.adjOE, awayAdjDE: away.adjDE, awayTempo: away.adjTempo,
      homeEFG: home.eFG, awayEFG: away.eFG
    },
    engine: {
      homeInjDrag: Math.round(homeInjDrag * 1000) / 1000,
      awayInjDrag: Math.round(awayInjDrag * 1000) / 1000,
      homeMatchupTO: Math.round(homeMatchupTO * 1000) / 10,
      awayMatchupTO: Math.round(awayMatchupTO * 1000) / 10,
      homeMatchupOR: Math.round(homeMatchupOR * 1000) / 10,
      awayMatchupOR: Math.round(awayMatchupOR * 1000) / 10,
      homeMatchupFTR: Math.round(homeMatchupFTR * 1000) / 10,
      awayMatchupFTR: Math.round(awayMatchupFTR * 1000) / 10,
      home3ptMake: Math.round(home3ptMake * 1000) / 10,
      away3ptMake: Math.round(away3ptMake * 1000) / 10,
      home2ptMake: Math.round(home2ptMake * 1000) / 10,
      away2ptMake: Math.round(away2ptMake * 1000) / 10,
      home3ptRate: Math.round(home3ptRate * 100),
      away3ptRate: Math.round(away3ptRate * 100),
      homeScale: Math.round(homeScale * 1000) / 1000,
      awayScale: Math.round(awayScale * 1000) / 1000,
      tempoWeight: Math.round(homeDefQ / defSum * 100) + "% H / " + Math.round(awayDefQ / defSum * 100) + "% A",
      homeFormAdj: Math.round(parseFormBoost(home.recentForm) * 10000) / 100,
      awayFormAdj: Math.round(parseFormBoost(away.recentForm) * 10000) / 100,
    },
  };
}

const ALL_TEAMS = ["Abilene Christian","Air Force","Akron","Alabama","Alabama A&M","Alabama St","Albany","Alcorn St","American","Appalachian St","Arizona","Arizona St","Arkansas","Arkansas Pine Bluff","Arkansas St","Army","Auburn","Austin Peay","Ball St","Baylor","Bellarmine","Belmont","Bethune Cookman","Binghamton","Boise St","Boston College","Boston University","Bowling Green","Bradley","Brown","Bryant","Bucknell","Buffalo","Butler","BYU","Cal Baptist","Cal Poly","Cal St Bakersfield","Cal St Fullerton","Cal St Northridge","Campbell","Canisius","Central Arkansas","Central Connecticut","Central Michigan","Charleston","Charleston Southern","Charlotte","Chattanooga","Chicago St","Cincinnati","Citadel","Clemson","Cleveland St","Coastal Carolina","Colgate","Colorado","Colorado St","Columbia","Connecticut","Coppin St","Cornell","Creighton","CSU Sacramento","Dartmouth","Davidson","Dayton","Delaware","Delaware St","Denver","DePaul","Detroit Mercy","Drake","Drexel","Duke","Duquesne","East Carolina","East Tennessee St","Eastern Illinois","Eastern Kentucky","Eastern Michigan","Eastern Washington","Elon","Evansville","Fairfield","Fairleigh Dickinson","Florida","Florida A&M","Florida Atlantic","Florida Gulf Coast","Florida International","Florida St","Fordham","Fresno St","Furman","Gardner Webb","George Mason","George Washington","Georgetown","Georgia","Georgia Southern","Georgia St","Georgia Tech","Gonzaga","Grambling","Grand Canyon","Green Bay","Hampton","Hartford","Harvard","Hawaii","High Point","Hofstra","Holy Cross","Houston","Houston Christian","Howard","Idaho","Idaho St","Illinois","Illinois Chicago","Illinois St","Incarnate Word","Indiana","Indiana St","Iona","Iowa","Iowa St","IUPUI","Jackson St","Jacksonville","Jacksonville St","James Madison","Kansas","Kansas City","Kansas St","Kennesaw St","Kent St","Kentucky","La Salle","Lafayette","Lamar","Le Moyne","Lehigh","Liberty","Lindenwood","Lipscomb","Little Rock","Long Beach St","Long Island","Longwood","Louisiana","Louisiana Monroe","Louisiana Tech","Louisville","Loyola Chicago","Loyola Maryland","Loyola Marymount","LSU","Maine","Manhattan","Marist","Marquette","Marshall","Maryland","Maryland Eastern Shore","Massachusetts","McNeese","Memphis","Mercer","Merrimack","Miami FL","Miami OH","Michigan","Michigan St","Middle Tennessee","Milwaukee","Minnesota","Mississippi St","Mississippi Valley St","Missouri","Missouri Kansas City","Missouri St","Monmouth","Montana","Montana St","Morehead St","Morgan St","Mount St Marys","Murray St","Navy","NC A&T","NC Central","NC St","Nebraska","Nevada","New Hampshire","New Mexico","New Mexico St","New Orleans","Niagara","Nicholls St","NJIT","Norfolk St","North Alabama","North Carolina","North Dakota","North Dakota St","North Florida","North Texas","Northeastern","Northern Arizona","Northern Colorado","Northern Illinois","Northern Iowa","Northern Kentucky","Northwestern","Northwestern St","Notre Dame","Oakland","Ohio","Ohio St","Oklahoma","Oklahoma St","Old Dominion","Ole Miss","Omaha","Oral Roberts","Oregon","Oregon St","Pacific","Penn","Penn St","Pepperdine","Pittsburgh","Portland","Portland St","Prairie View A&M","Presbyterian","Princeton","Providence","Purdue","Purdue Fort Wayne","Quinnipiac","Radford","Rhode Island","Rice","Richmond","Rider","Robert Morris","Rutgers","Sacred Heart","Sam Houston St","Samford","San Diego","San Diego St","San Francisco","San Jose St","Santa Clara","Seattle","Seton Hall","Siena","SIU Edwardsville","SMU","South Alabama","South Carolina","South Carolina St","South Carolina Upstate","South Dakota","South Dakota St","South Florida","Southeast Missouri St","Southeastern Louisiana","Southern","Southern Illinois","Southern Indiana","Southern Miss","Southern Utah","St Bonaventure","St Francis Brooklyn","St Francis PA","St Johns","St Josephs","St Louis","St Marys","St Peters","St Thomas","Stanford","Stetson","Stonehill","Stony Brook","Syracuse","Tarleton St","TCU","Temple","Tennessee","Tennessee Martin","Tennessee St","Tennessee Tech","Texas","Texas A&M","Texas A&M CC","Texas Southern","Texas St","Texas Tech","The Citadel","Toledo","Towson","Troy","Tulane","Tulsa","UAB","UC Davis","UC Irvine","UC Riverside","UC San Diego","UC Santa Barbara","UCF","UCLA","UConn","UMass Lowell","UMBC","UNC Asheville","UNC Greensboro","UNC Wilmington","UNLV","USC","UT Arlington","UT Rio Grande Valley","Utah","Utah St","Utah Tech","Utah Valley","UTEP","UTSA","Valparaiso","Vanderbilt","VCU","Vermont","Villanova","Virginia","Virginia Tech","VMI","Wagner","Wake Forest","Washington","Washington St","Weber St","West Virginia","Western Carolina","Western Illinois","Western Kentucky","Western Michigan","Wichita St","William & Mary","Winthrop","Wisconsin","Wofford","Wright St","Wyoming","Xavier","Yale","Youngstown St"];

// ============================================================
// DESIGN TOKENS
// ============================================================
const C = {
  home: "#ff6b35", away: "#00d4aa", pos: "#4ade80", neg: "#ef4444",
  warn: "#f59e0b", ext: "#a78bfa",
  t1: "#e0e0e0", t2: "#8a8a9a", t3: "#4a4a5e",
  bg: "#08080f", card: "#0e0e1a", raised: "#14142a", border: "#1e1e3a",
};
const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, x2: 32, x3: 48 };
const R = { sm: 8, md: 12, lg: 16 };
const F = { mono: "'JetBrains Mono',monospace", body: "'DM Sans',sans-serif", display: "'Instrument Serif',serif" };

// ============================================================
// SMALL COMPONENTS
// ============================================================
function FadeIn({ children, delay = 0, style = {} }) {
  const [v, setV] = useState(false);
  useEffect(() => { const t = setTimeout(() => setV(true), delay); return () => clearTimeout(t); }, [delay]);
  return <div style={{ opacity: v ? 1 : 0, transform: v ? "translateY(0)" : "translateY(10px)", transition: "opacity 300ms ease-out, transform 300ms ease-out", ...style }}>{children}</div>;
}

function TeamInput({ label, color, value, onChange }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  const sug = value ? ALL_TEAMS.filter(t => t.toLowerCase().includes(value.toLowerCase())).slice(0, 8) : [];
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setShow(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} style={{ flex: 1, minWidth: 140, position: "relative" }}>
      <label style={{ display: "block", fontSize: 10, letterSpacing: 3, color, fontFamily: F.mono, marginBottom: S.sm, textTransform: "uppercase", fontWeight: 500 }}>{label}</label>
      <input value={value} onChange={e => { onChange(e.target.value); setShow(true); }} onFocus={() => setShow(true)} placeholder="Search teams..."
        style={{ width: "100%", padding: "12px 16px", fontSize: 14, background: C.bg, border: "1px solid " + (value ? color + "40" : C.border), borderRadius: R.md, color: "#fff", outline: "none", fontFamily: F.body, transition: "border-color 150ms ease" }} />
      {show && sug.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.raised, border: "1px solid " + C.border, borderRadius: R.md, marginTop: S.xs, zIndex: 10, maxHeight: 240, overflowY: "auto", boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>
          {sug.map(t => <div key={t} onClick={() => { onChange(t); setShow(false); }} style={{ padding: "10px 16px", cursor: "pointer", fontSize: 14, fontFamily: F.body, color: C.t1, borderBottom: "1px solid " + C.border, transition: "background 150ms ease" }} onMouseEnter={e => e.target.style.background = "#1e1e4a"} onMouseLeave={e => e.target.style.background = "transparent"}>{t}</div>)}
        </div>
      )}
    </div>
  );
}

function StatRow({ label, home, away, higherIsBetter = true, suffix = "" }) {
  const h = typeof home === "number" ? home : parseFloat(home) || 0;
  const a = typeof away === "number" ? away : parseFloat(away) || 0;
  const hB = higherIsBetter ? h > a : h < a, aB = higherIsBetter ? a > h : a < h;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", alignItems: "center", padding: S.sm + "px " + S.md + "px", borderBottom: "1px solid " + C.border + "20" }}>
      <div style={{ textAlign: "left", fontFamily: F.mono, fontSize: 14, fontWeight: hB ? 600 : 400, color: hB ? C.home : C.t2 }}>{h.toFixed(1)}{suffix}</div>
      <div style={{ textAlign: "center", fontSize: 10, letterSpacing: 1.5, color: C.t3, fontFamily: F.mono, textTransform: "uppercase" }}>{label}</div>
      <div style={{ textAlign: "right", fontFamily: F.mono, fontSize: 14, fontWeight: aB ? 600 : 400, color: aB ? C.away : C.t2 }}>{a.toFixed(1)}{suffix}</div>
    </div>
  );
}

function Histogram({ buckets, homeTeam, awayTeam }) {
  const entries = Object.entries(buckets).map(([k, v]) => [parseInt(k), v]).sort((a, b) => a[0] - b[0]);
  const maxC = Math.max(...entries.map(e => e[1]));
  const [hov, setHov] = useState(null);
  const zeroIdx = entries.findIndex(([m]) => m >= 0);
  return (
    <div>
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 100, padding: "0 " + S.xs + "px" }}>
          {entries.map(([margin, count], i) => (
            <div key={margin} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
              style={{ flex: 1, minWidth: 4, height: (count / maxC) * 100 + "%", background: margin > 0 ? C.home : margin < 0 ? C.away : C.t3, borderRadius: "3px 3px 0 0", opacity: hov === i ? 1 : 0.7, transition: "opacity 150ms ease, height 800ms ease-out", cursor: "crosshair", position: "relative" }}>
              {hov === i && <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: C.raised, border: "1px solid " + C.border, borderRadius: R.sm, padding: "4px 8px", whiteSpace: "nowrap", fontSize: 10, fontFamily: F.mono, color: C.t1, zIndex: 5, boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>{margin > 0 ? homeTeam : awayTeam} by {Math.abs(margin)} — {count} sims</div>}
            </div>
          ))}
        </div>
        {zeroIdx >= 0 && <div style={{ position: "absolute", left: (zeroIdx / entries.length * 100) + "%", top: 0, bottom: 0, width: 1, background: C.t3 + "40", pointerEvents: "none" }} />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.t3, fontFamily: F.mono, marginTop: S.sm, padding: "0 " + S.xs + "px" }}>
        <span style={{ color: C.away + "90" }}>{awayTeam} wins</span>
        <span style={{ color: C.home + "90" }}>{homeTeam} wins</span>
      </div>
    </div>
  );
}

function TrendTable({ title, rows, hasAts }) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) return null;
  return (
    <div style={{ marginBottom: S.lg }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.t3, fontFamily: F.mono, marginBottom: S.sm, textTransform: "uppercase" }}>{title}</div>
      <div style={{ fontSize: 10, fontFamily: F.mono, color: C.t3, display: "grid", gridTemplateColumns: hasAts ? "2fr 1fr 1fr 1fr 1fr" : "2fr 1fr 1fr 1fr", padding: "4px " + S.sm + "px", borderBottom: "1px solid " + C.border, letterSpacing: 0.5, textTransform: "uppercase" }}>
        <span>Situation</span><span style={{ textAlign: "center" }}>Record</span><span style={{ textAlign: "center" }}>{hasAts ? "Cov%" : "Win%"}</span><span style={{ textAlign: "center" }}>MOV</span>{hasAts && <span style={{ textAlign: "center" }}>ATS+/-</span>}
      </div>
      {rows.map((row, i) => {
        const pct = parseFloat(row.coverPct || row.winPct || "0");
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: hasAts ? "2fr 1fr 1fr 1fr 1fr" : "2fr 1fr 1fr 1fr", padding: "4px " + S.sm + "px", fontSize: 12, fontFamily: F.mono, background: i % 2 === 0 ? C.bg : "transparent", borderRadius: R.sm, alignItems: "center" }}>
            <span style={{ color: C.t2, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.situation}</span>
            <span style={{ textAlign: "center", color: C.t1, fontWeight: 600 }}>{row.record || "\u2014"}</span>
            <span style={{ textAlign: "center", color: pct >= 55 ? C.pos : pct > 0 && pct <= 40 ? C.neg : C.t2, fontWeight: 600 }}>{row.coverPct || row.winPct || "\u2014"}</span>
            <span style={{ textAlign: "center", color: C.t2 }}>{row.mov || "\u2014"}</span>
            {hasAts && <span style={{ textAlign: "center", color: parseFloat(row.atsPlusMinus || "0") > 0 ? C.pos : parseFloat(row.atsPlusMinus || "0") < 0 ? C.neg : C.t2 }}>{row.atsPlusMinus || "\u2014"}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function CBBEdge() {
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [simResults, setSimResults] = useState(null);
  const [error, setError] = useState("");
  const [debugInfo, setDebugInfo] = useState("");
  const [activeTab, setActiveTab] = useState("sim");
  const [showEngine, setShowEngine] = useState(false);

  const extractJSON = (text) => {
    if (!text || typeof text !== "string") throw new Error("Empty response");
    try { return JSON.parse(text); } catch (e) { /* continue */ }
    let cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    try { return JSON.parse(cleaned); } catch (e) { /* continue */ }
    let bestParsed = null, bestLen = 0, depth = 0, start = -1;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === "{") { if (depth === 0) start = i; depth++; }
      else if (cleaned[i] === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            const p = JSON.parse(cleaned.substring(start, i + 1));
            if (i + 1 - start > bestLen) { bestParsed = p; bestLen = i + 1 - start; }
          } catch (e) { /* continue */ }
          start = -1;
        }
      }
    }
    if (bestParsed) return bestParsed;
    if (depth > 0 && start !== -1) {
      let truncated = cleaned.substring(start);
      truncated = truncated.replace(/,\s*"[^"]*"?\s*:?\s*[^{}[\]]*$/, "");
      for (let d = 0; d < depth; d++) truncated += "}";
      try { return JSON.parse(truncated); } catch (e) { /* continue */ }
    }
    throw new Error("Could not parse JSON. Try again.");
  };

  const callAPI = async (messages, system) => {
    let currentMessages = [...messages];
    const startTime = Date.now();
    for (let turn = 0; turn < 8; turn++) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      setLoadingStatus(turn === 0 ? "Searching stats and injuries" : turn === 1 ? "Pulling trends (" + elapsed + "s)" : turn === 2 ? "Compiling game logs (" + elapsed + "s)" : "Finalizing (" + elapsed + "s)");
      let response;
      try {
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 16000,
            system,
            messages: currentMessages,
            tools: [{ type: "web_search_20250305", name: "web_search" }]
          })
        });
      } catch (fetchErr) { throw new Error("Network error: " + fetchErr.message); }
      if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown");
        throw new Error("API " + response.status + ": " + errText.slice(0, 400));
      }
      let data;
      try { data = await response.json(); } catch (e) { throw new Error("Invalid response format. Try again."); }
      if (data.error) throw new Error("API: " + (data.error.message || JSON.stringify(data.error)));
      const hasToolUse = data.content && data.content.some(b => b.type === "tool_use");
      const isEndTurn = data.stop_reason === "end_turn" || data.stop_reason === "stop" || !hasToolUse;
      if (isEndTurn) {
        const textBlocks = (data.content || []).filter(b => b.type === "text").map(b => b.text);
        if (textBlocks.length === 0) throw new Error("No text content. Try again.");
        return textBlocks.join("\n");
      }
      currentMessages.push({ role: "assistant", content: data.content });
      currentMessages.push({
        role: "user",
        content: data.content.filter(b => b.type === "tool_use").map(b => ({
          type: "tool_result", tool_use_id: b.id, content: "Search completed. Continue."
        }))
      });
    }
    throw new Error("Too many iterations — try simpler team names");
  };

  const runAnalysis = async () => {
    if (!homeTeam.trim() || !awayTeam.trim()) { setError("Enter both teams"); return; }
    if (homeTeam.trim().toLowerCase() === awayTeam.trim().toLowerCase()) { setError("Pick two different teams"); return; }
    setError(""); setDebugInfo(""); setLoading(true); setAnalysis(null); setSimResults(null);
    const h = homeTeam.trim(), a = awayTeam.trim(), dateStr = new Date().toISOString().slice(0, 10);
    try {
      const coreSystem = `You are an NCAA basketball data researcher. Search the web for REAL, CURRENT 2025-26 season data. Today is ${dateStr}. SEARCH PLAN (batch 3-5 searches per turn, finish in 3-4 turns): Turn 1: "${h} basketball 2025-26 Torvik stats" AND "${a} basketball 2025-26 Torvik stats" AND "${h} vs ${a} odds spread 2026" AND "${h} ${a} injury report today" Turn 2: "${h} schedule results 2025-26 last 10" AND "${a} schedule results 2025-26 last 10" AND any injury follow-ups Turn 3: Output JSON Return ONLY this compact JSON (no markdown, no backticks): {"home":{"record":"W-L","ranking":null,"adjOE":num,"adjDE":num,"adjTempo":num,"eFG":num,"toRate":num,"orRate":num,"ftRate":num,"threePtPct":num,"twoPtPct":num,"blockPct":num,"stealPct":num,"assistRate":num,"sos":num,"threePtRate":num,"defEFG":num,"defToRate":num,"defRebRate":num,"defFTRate":num,"def3ptPct":num,"def2ptPct":num,"recentForm":"W W L W W","topPlayers":[{"name":"str","pos":"str","ppg":num,"status":"ACTIVE/OUT/GTD"}],"injuries":[{"name":"str","status":"OUT/DOUBTFUL/GTD","reason":"str","ppg":num,"role":"Starter/Bench"}],"coach":"name"},"away":{SAME},"vegasSpread":num,"vegasTotal":num,"last10":{"home":[{"date":"M/D","opp":"str","ha":"H/A","res":"W/L","score":"XX-XX","oppRk":num}],"away":[SAME]},"intangibles":{"homeRest":num,"awayRest":num,"rivalry":false,"travel":"regional","homeMot":"medium","awayMot":"medium","homeCoach":0,"awayCoach":0},"keyMatchup":"1 sentence","dataSources":"what you found"} RULES: Use REAL Torvik/KenPom numbers. AdjOE:95-130, AdjDE:85-115(lower=better), Tempo:62-75. For injuries: GTD=game-time decision. last10: max 10 games. Output JSON ONLY.`;
      setLoadingStatus("Searching stats and injuries");
      const coreText = await callAPI([{ role: "user", content: h + " (HOME) vs " + a + " (AWAY). " + dateStr + ". Batch searches. JSON only." }], coreSystem);
      setLoadingStatus("Processing data"); setDebugInfo("Core: " + coreText.length + " chars");
      let core;
      try { core = extractJSON(coreText); } catch (e) { setDebugInfo("Parse fail: " + coreText.slice(0, 600)); throw new Error("Data parse failed. Try again."); }
      if (!core.home || !core.away) throw new Error("Missing team data");
      const d = { record: "N/A", ranking: null, adjOE: 105, adjDE: 105, adjTempo: 67, eFG: 50, toRate: 18, orRate: 28, ftRate: 30, threePtPct: 34, twoPtPct: 50, blockPct: 8, stealPct: 9, assistRate: 52, sos: 9, threePtRate: 37, defEFG: 50, defToRate: 18, defRebRate: 72, defFTRate: 30, def3ptPct: 34, def2ptPct: 50, recentForm: "", topPlayers: [], injuries: [], coach: "Unknown" };
      core.home = { ...d, ...core.home };
      core.away = { ...d, ...core.away };
      const intangibles = {
        homeRestDays: core.intangibles?.homeRest || 2,
        awayRestDays: core.intangibles?.awayRest || 2,
        rivalry: core.intangibles?.rivalry || false,
        awayTravel: core.intangibles?.travel || "regional",
        homeMotivation: core.intangibles?.homeMot || "medium",
        awayMotivation: core.intangibles?.awayMot || "medium",
        homeCoachAdj: core.intangibles?.homeCoach || 0,
        awayCoachAdj: core.intangibles?.awayCoach || 0
      };
      setLoadingStatus("Simulating 2,000 games");
      await new Promise(r => setTimeout(r, 200));
      const sim = runMonteCarloSim(core.home, core.away, intangibles, 2000);
      setAnalysis(core); setSimResults(sim); setActiveTab("sim");

      setLoadingStatus("Loading trends");
      try {
        const trendsSystem = `You are an NCAA basketball betting trends analyst. Search TeamRankings for trends data. Today is ${dateStr}. Search: "teamrankings ${h} ats trends" AND "teamrankings ${a} ats trends" AND "teamrankings ${h} over under trends" AND "teamrankings ${a} over under trends" Return ONLY JSON: {"trends":{"home":{"ats":[{"s":"All Games","r":"W-L-P","c":"XX%","m":"+/-X.X","a":"+/-X.X"}],"ou":[{"s":"All Games","r":"O-U-P","c":"XX%","m":"+/-X.X"}],"su":[{"s":"All Games","r":"W-L","c":"XX%","m":"+/-X.X"}],"key":"trend"},"away":{SAME},"matchup":"analysis"},"narrative":"2 paragraphs using: ${h} AdjOE ${core.home.adjOE} AdjDE ${core.home.adjDE} vs ${a} AdjOE ${core.away.adjOE} AdjDE ${core.away.adjDE}. Vegas: ${core.vegasSpread}. Sim: ${sim.avgMargin}.","bettingAnalysis":"2 sentences on value vs Vegas ${core.vegasSpread}"} RULES: 5-8 rows per table. REAL records only. JSON ONLY.`;
        const trendsText = await callAPI([{ role: "user", content: "Trends for " + h + " vs " + a + ". JSON only." }], trendsSystem);
        const td = extractJSON(trendsText);
        if (td.trends) {
          const xr = (rows) => (rows || []).map(r => ({ situation: r.s || r.situation, record: r.r || r.record, coverPct: r.c || r.coverPct, mov: r.m || r.mov, atsPlusMinus: r.a || r.atsPlusMinus, winPct: r.c || r.winPct }));
          const xt = (t) => t ? { ats: xr(t.ats), ou: xr(t.ou), su: xr(t.su), keyTrend: t.key || t.keyTrend } : null;
          core.trends = { home: xt(td.trends.home), away: xt(td.trends.away), matchupTrends: td.trends.matchup || td.trends.matchupTrends };
        }
        if (td.narrative) core.narrative = td.narrative;
        if (td.bettingAnalysis) core.bettingAnalysis = td.bettingAnalysis;
        setAnalysis({ ...core });
      } catch (e) { console.warn("Trends failed:", e.message); }
    } catch (err) {
      console.error(err);
      if (!debugInfo) setDebugInfo(err.message);
      setError(err.message);
    } finally {
      setLoading(false); setLoadingStatus("");
    }
  };

  const tabs = [{ id: "sim", label: "Sim" }, { id: "matchup", label: "Matchup" }, { id: "form", label: "Form" }, { id: "trends", label: "Trends" }, { id: "edge", label: "Edge" }];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.t1, fontFamily: F.body, padding: "0 16px 48px", maxWidth: 600, margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Instrument+Serif&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');*{box-sizing:border-box;margin:0;padding:0}::selection{background:${C.home}30;color:#fff}input::placeholder{color:${C.t3}}::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>

      {/* HEADER */}
      <div style={{ textAlign: "center", padding: S.x2 + "px 0 " + S.xl + "px" }}>
        <h1 style={{ fontFamily: F.display, fontSize: "clamp(36px,7vw,48px)", fontWeight: 400, background: "linear-gradient(135deg," + C.home + ",#ffb088," + C.away + ")", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1, letterSpacing: -0.5 }}>CBB EDGE</h1>
        <div style={{ fontSize: 10, letterSpacing: 3, color: C.t3, fontFamily: F.mono, marginTop: S.sm, textTransform: "uppercase" }}>2,000 Game Monte Carlo Simulation</div>
      </div>

      {/* INPUT */}
      <div style={{ background: C.card, borderRadius: R.lg, padding: S.xl, marginBottom: S.xl }}>
        <div style={{ display: "flex", gap: S.lg, flexWrap: "wrap" }}>
          <TeamInput label="Home" color={C.home} value={homeTeam} onChange={setHomeTeam} />
          <TeamInput label="Away" color={C.away} value={awayTeam} onChange={setAwayTeam} />
        </div>
        {error && <div style={{ marginTop: S.md, textAlign: "center" }}><div style={{ color: C.neg, fontSize: 12 }}>{error}</div>{debugInfo && <details style={{ marginTop: S.xs }}><summary style={{ fontSize: 10, color: C.t3, cursor: "pointer" }}>Debug</summary><div style={{ fontSize: 10, color: C.t3, background: C.bg, borderRadius: R.sm, padding: S.sm, marginTop: S.xs, wordBreak: "break-all", maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap" }}>{debugInfo}</div></details>}</div>}
        <button onClick={runAnalysis} disabled={loading} style={{ width: "100%", marginTop: S.lg, padding: "13px", background: loading ? C.raised : C.home, border: "none", borderRadius: R.md, color: "#fff", fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: F.mono, letterSpacing: 2, textTransform: "uppercase", opacity: loading ? 0.5 : 1, transition: "all 150ms ease" }}>{loading ? "Running..." : "Simulate"}</button>
      </div>

      {/* LOADING */}
      {loading && !simResults && <FadeIn><div style={{ textAlign: "center", padding: S.x3 + "px 0" }}><div style={{ width: 32, height: 32, border: "2px solid " + C.border, borderTop: "2px solid " + C.home, borderRadius: "50%", margin: "0 auto", animation: "spin 1s linear infinite" }} /><div style={{ fontSize: 12, color: C.t2, fontFamily: F.mono, marginTop: S.lg, animation: "pulse 2s ease-in-out infinite" }}>{loadingStatus}</div></div></FadeIn>}

      {/* EMPTY STATE */}
      {!loading && !analysis && !error && <FadeIn delay={200}><div style={{ textAlign: "center", padding: S.x3 + "px " + S.xl + "px" }}><div style={{ fontSize: 14, color: C.t3, lineHeight: 1.8 }}>Enter two teams to simulate 2,000 games</div><div style={{ marginTop: S.x2, opacity: 0.12, pointerEvents: "none" }}><div style={{ display: "flex", justifyContent: "center", gap: S.x3, marginBottom: S.lg }}><div><div style={{ width: 48, height: 6, background: C.home, borderRadius: 3, margin: "0 auto 8px" }} /><div style={{ width: 64, height: 32, background: C.home, borderRadius: R.sm, margin: "0 auto" }} /></div><div><div style={{ width: 48, height: 6, background: C.away, borderRadius: 3, margin: "0 auto 8px" }} /><div style={{ width: 64, height: 32, background: C.away, borderRadius: R.sm, margin: "0 auto" }} /></div></div><div style={{ width: "80%", height: 8, background: C.t3, borderRadius: 4, margin: "0 auto 12px" }} /><div style={{ display: "flex", justifyContent: "center", gap: S.sm }}>{[1, 2, 3, 4].map(i => <div key={i} style={{ width: 60, height: 36, background: C.border, borderRadius: R.sm }} />)}</div></div></div></FadeIn>}

      {/* RESULTS */}
      {analysis && simResults && <div>
        {/* Data warnings */}
        {simResults.dataFlags && simResults.dataFlags.length > 0 && <FadeIn><div style={{ background: C.warn + "08", border: "1px solid " + C.warn + "20", borderRadius: R.sm, padding: S.sm + "px " + S.md + "px", marginBottom: S.md }}>{simResults.dataFlags.map((f, i) => <div key={i} style={{ fontSize: 10, color: C.warn, fontFamily: F.mono }}>{f}</div>)}</div></FadeIn>}

        {/* HERO CARD */}
        <FadeIn delay={0}><div style={{ background: C.card, borderRadius: R.lg, padding: S.xl, marginBottom: S.lg }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: S.xl }}>
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.home, fontFamily: F.mono, textTransform: "uppercase", marginBottom: S.xs }}>Home</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 2 }}>{homeTeam}</div>
              <div style={{ fontSize: 12, color: C.t3 }}>{analysis.home.ranking ? "#" + analysis.home.ranking + " \u00b7 " : ""}{analysis.home.record}</div>
              <div style={{ fontSize: 40, fontFamily: F.display, color: C.home, lineHeight: 1.1, marginTop: S.sm }}>{simResults.avgHome}</div>
            </div>
            <div style={{ width: 1, height: 80, background: C.border, flexShrink: 0 }} />
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.away, fontFamily: F.mono, textTransform: "uppercase", marginBottom: S.xs }}>Away</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 2 }}>{awayTeam}</div>
              <div style={{ fontSize: 12, color: C.t3 }}>{analysis.away.ranking ? "#" + analysis.away.ranking + " \u00b7 " : ""}{analysis.away.record}</div>
              <div style={{ fontSize: 40, fontFamily: F.display, color: C.away, lineHeight: 1.1, marginTop: S.sm }}>{simResults.avgAway}</div>
            </div>
          </div>
          {/* Win Prob */}
          <div style={{ marginTop: S.xl }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: F.mono, marginBottom: S.sm }}>
              <span style={{ color: C.home, fontWeight: 600 }}>{simResults.homeWinPct}%</span>
              <span style={{ color: C.away, fontWeight: 600 }}>{simResults.awayWinPct}%</span>
            </div>
            <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 2 }}>
              <div style={{ width: simResults.homeWinPct + "%", background: C.home, borderRadius: 3, transition: "width 600ms ease-out" }} />
              <div style={{ width: simResults.awayWinPct + "%", background: C.away, borderRadius: 3, transition: "width 600ms ease-out" }} />
            </div>
          </div>
          {/* Spread + O/U */}
          <div style={{ display: "grid", gridTemplateColumns: analysis.vegasSpread != null ? "1fr 1fr" : "1fr", gap: S.sm, marginTop: S.lg }}>
            <div style={{ background: C.bg, borderRadius: R.sm, padding: S.sm + "px " + S.md + "px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.t3, fontFamily: F.mono }}>SPREAD</span>
              <span style={{ fontSize: 14, fontWeight: 600, fontFamily: F.mono }}>{simResults.avgMargin > 0 ? homeTeam + " -" + simResults.avgMargin : simResults.avgMargin < 0 ? awayTeam + " -" + Math.abs(simResults.avgMargin) : "Pick'em"}</span>
            </div>
            {analysis.vegasSpread != null && <div style={{ background: C.ext + "08", border: "1px solid " + C.ext + "15", borderRadius: R.sm, padding: S.sm + "px " + S.md + "px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.ext, fontFamily: F.mono }}>VEGAS</span>
              <span style={{ fontSize: 14, fontWeight: 600, fontFamily: F.mono, color: C.ext }}>{analysis.vegasSpread > 0 ? homeTeam + " -" + analysis.vegasSpread : analysis.vegasSpread < 0 ? awayTeam + " -" + Math.abs(analysis.vegasSpread) : "PK"}</span>
            </div>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: analysis.vegasTotal != null ? "1fr 1fr" : "1fr", gap: S.sm, marginTop: S.sm }}>
            <div style={{ background: C.bg, borderRadius: R.sm, padding: S.sm + "px " + S.md + "px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.t3, fontFamily: F.mono }}>O/U</span>
              <span style={{ fontSize: 14, fontWeight: 600, fontFamily: F.mono }}>{simResults.avgTotal}</span>
            </div>
            {analysis.vegasTotal != null && <div style={{ background: C.ext + "08", border: "1px solid " + C.ext + "15", borderRadius: R.sm, padding: S.sm + "px " + S.md + "px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.ext, fontFamily: F.mono }}>VEGAS O/U</span>
              <span style={{ fontSize: 14, fontWeight: 600, fontFamily: F.mono, color: C.ext }}>{analysis.vegasTotal}</span>
            </div>}
          </div>
        </div></FadeIn>

        {/* TABS */}
        <FadeIn delay={100}><div style={{ display: "flex", gap: S.xs, marginBottom: S.lg, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none" }}>
          {tabs.map(tab => <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: S.sm + "px " + S.lg + "px", fontSize: 12, fontFamily: F.mono, fontWeight: activeTab === tab.id ? 600 : 400, textTransform: "uppercase", letterSpacing: 1, background: activeTab === tab.id ? C.raised : "transparent", border: "1px solid " + (activeTab === tab.id ? C.border : "transparent"), borderRadius: R.sm, color: activeTab === tab.id ? C.t1 : C.t3, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, minHeight: 44, transition: "all 150ms ease" }}>{tab.label}</button>)}
        </div></FadeIn>

        {/* TAB CONTENT */}
        <FadeIn delay={150} key={activeTab}><div style={{ background: C.card, borderRadius: R.lg, padding: S.xl }}>

          {/* SIM TAB */}
          {activeTab === "sim" && <div>
            <Histogram buckets={simResults.marginBuckets} homeTeam={homeTeam} awayTeam={awayTeam} />
            <div style={{ marginTop: S.xl, padding: S.lg, background: C.bg, borderRadius: R.md }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.t3, fontFamily: F.mono, marginBottom: S.md, textTransform: "uppercase" }}>Margin Percentiles</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                {[["10th", simResults.percentiles.p10], ["25th", simResults.percentiles.p25], ["MED", simResults.percentiles.p50], ["75th", simResults.percentiles.p75], ["90th", simResults.percentiles.p90]].map(([l, v]) => <div key={l} style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: C.t3, fontFamily: F.mono, marginBottom: S.xs }}>{l}</div><div style={{ fontSize: 14, fontFamily: F.mono, fontWeight: l === "MED" ? 700 : 400, color: v > 0 ? C.home : v < 0 ? C.away : C.t2 }}>{v > 0 ? "+" : ""}{v}</div></div>)}
              </div>
            </div>
            <div style={{ marginTop: S.lg }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.t3, fontFamily: F.mono, marginBottom: S.md, textTransform: "uppercase" }}>Cover Probability</div>
              <div style={{ display: "flex", gap: S.xs, overflowX: "auto", paddingBottom: S.xs, WebkitOverflowScrolling: "touch" }}>
                {simResults.coverProbs.filter(c => c.spread >= -15 && c.spread <= 15).map(c => <div key={c.spread} style={{ background: C.bg, borderRadius: R.sm, padding: S.sm + "px " + S.md + "px", textAlign: "center", minWidth: 56, flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: C.t3, fontFamily: F.mono }}>{c.spread > 0 ? "-" + c.spread : "+" + Math.abs(c.spread)}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: F.mono, color: c.coverPct > 55 ? C.pos : c.coverPct < 45 ? C.neg : C.t2 }}>{c.coverPct}%</div>
                </div>)}
              </div>
            </div>
            <div style={{ marginTop: S.lg, fontSize: 10, color: C.t3, fontFamily: F.mono, lineHeight: 1.8 }}>{simResults.stdDev} pt std dev · {simResults.closeGamePct}% within 5 pts · {simResults.paceControl} possessions</div>
            {simResults.engine && <div style={{ marginTop: S.lg }}>
              <button onClick={() => setShowEngine(!showEngine)} style={{ background: "none", border: "none", color: C.t3, fontSize: 10, fontFamily: F.mono, cursor: "pointer", letterSpacing: 1.5, textTransform: "uppercase", padding: 0 }}>{showEngine ? "Hide" : "Show"} engine details</button>
              {showEngine && <FadeIn><div style={{ marginTop: S.md }}>
                {[{ t: "Efficiency", r: [["Exp PPP", simResults.homeExpPPP, simResults.awayExpPPP], ["Inj Drag", "-" + simResults.engine.homeInjDrag, "-" + simResults.engine.awayInjDrag], ["Scale", simResults.engine.homeScale, simResults.engine.awayScale]] }, { t: "Events", r: [["TO%", simResults.engine.homeMatchupTO + "%", simResults.engine.awayMatchupTO + "%"], ["OR%", simResults.engine.homeMatchupOR + "%", simResults.engine.awayMatchupOR + "%"], ["FTR", simResults.engine.homeMatchupFTR + "%", simResults.engine.awayMatchupFTR + "%"]] }, { t: "Shooting", r: [["3PT%", simResults.engine.home3ptMake + "%", simResults.engine.away3ptMake + "%"], ["2PT%", simResults.engine.home2ptMake + "%", simResults.engine.away2ptMake + "%"], ["3PT Rate", simResults.engine.home3ptRate + "%", simResults.engine.away3ptRate + "%"]] }].map(({ t, r }) => <div key={t} style={{ marginBottom: S.md }}><div style={{ fontSize: 10, color: C.t3, fontFamily: F.mono, letterSpacing: 1, marginBottom: S.xs, textTransform: "uppercase" }}>{t}</div>{r.map(([l, hV, aV], i) => <div key={l} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", padding: "3px " + S.sm + "px", fontSize: 12, fontFamily: F.mono, background: i % 2 === 0 ? C.bg : "transparent", borderRadius: R.sm }}><span style={{ color: C.t3 }}>{l}</span><span style={{ textAlign: "center", color: C.home }}>{hV}</span><span style={{ textAlign: "center", color: C.away }}>{aV}</span></div>)}</div>)}
              </div></FadeIn>}
            </div>}
          </div>}

          {/* MATCHUP TAB */}
          {activeTab === "matchup" && <div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: C.t3, fontFamily: F.mono, marginBottom: S.lg, textTransform: "uppercase" }}>Efficiency</div>
            <StatRow label="Adj Off" home={analysis.home.adjOE} away={analysis.away.adjOE} />
            <StatRow label="Adj Def" home={analysis.home.adjDE} away={analysis.away.adjDE} higherIsBetter={false} />
            <StatRow label="Tempo" home={analysis.home.adjTempo} away={analysis.away.adjTempo} />
            <StatRow label="SOS" home={analysis.home.sos} away={analysis.away.sos} />
            <div style={{ fontSize: 10, letterSpacing: 2, color: C.t3, fontFamily: F.mono, margin: S.xl + "px 0 " + S.lg + "px", textTransform: "uppercase" }}>Four Factors</div>
            <StatRow label="eFG%" home={analysis.home.eFG} away={analysis.away.eFG} suffix="%" />
            <StatRow label="TO Rate" home={analysis.home.toRate} away={analysis.away.toRate} higherIsBetter={false} suffix="%" />
            <StatRow label="OR%" home={analysis.home.orRate} away={analysis.away.orRate} suffix="%" />
            <StatRow label="FT Rate" home={analysis.home.ftRate} away={analysis.away.ftRate} />
            <div style={{ fontSize: 10, letterSpacing: 2, color: C.t3, fontFamily: F.mono, margin: S.xl + "px 0 " + S.lg + "px", textTransform: "uppercase" }}>Shooting</div>
            <StatRow label="3PT%" home={analysis.home.threePtPct} away={analysis.away.threePtPct} suffix="%" />
            <StatRow label="2PT%" home={analysis.home.twoPtPct} away={analysis.away.twoPtPct} suffix="%" />
            <StatRow label="Blk%" home={analysis.home.blockPct} away={analysis.away.blockPct} />
            <StatRow label="Stl%" home={analysis.home.stealPct} away={analysis.away.stealPct} />
            {analysis.keyMatchup && <div style={{ marginTop: S.xl, padding: S.lg, background: C.bg, borderRadius: R.md, fontSize: 14, color: C.t2, lineHeight: 1.6 }}>{analysis.keyMatchup}</div>}
            {/* Players */}
            {[{ team: homeTeam, color: C.home, data: analysis.home }, { team: awayTeam, color: C.away, data: analysis.away }].map(({ team, color, data }) => <div key={team} style={{ marginTop: S.xl }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color, fontFamily: F.mono, marginBottom: S.md, textTransform: "uppercase" }}>{team}</div>
              {data.topPlayers?.map((p, i) => { const out = p.status === "OUT"; return <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: S.sm + "px 0", borderBottom: "1px solid " + C.border + "20", opacity: out ? 0.4 : 1 }}>
                <div><span style={{ fontSize: 14, fontWeight: 600, color: out ? C.t3 : C.t1, textDecoration: out ? "line-through" : "none" }}>{p.name}</span><span style={{ fontSize: 12, color: C.t3, marginLeft: S.sm }}>{p.pos}</span>{p.status && p.status !== "ACTIVE" && <span style={{ fontSize: 10, marginLeft: S.sm, padding: "1px 6px", borderRadius: 3, background: (p.status === "OUT" ? C.neg : C.warn) + "15", color: p.status === "OUT" ? C.neg : C.warn, fontFamily: F.mono, fontWeight: 600 }}>{p.status}</span>}</div>
                <span style={{ fontSize: 14, fontFamily: F.mono, color, fontWeight: 600 }}>{p.ppg}</span>
              </div>; })}
              {data.injuries && Array.isArray(data.injuries) && data.injuries.length > 0 && <div style={{ marginTop: S.md, padding: S.md, background: C.neg + "06", border: "1px solid " + C.neg + "15", borderRadius: R.sm }}>
                {data.injuries.map((inj, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: S.sm, padding: S.xs + "px 0", fontSize: 12 }}>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: (inj.status === "OUT" ? C.neg : C.warn) + "20", color: inj.status === "OUT" ? C.neg : C.warn, fontFamily: F.mono, fontWeight: 600, flexShrink: 0 }}>{inj.status}</span>
                  <span style={{ color: C.t2 }}>{inj.name}{inj.ppg && <span style={{ color: C.t3, marginLeft: S.xs }}>{inj.ppg} PPG</span>}{inj.reason && <span style={{ color: C.t3, marginLeft: S.xs }}>&middot; {inj.reason}</span>}</span>
                </div>)}
              </div>}
            </div>)}
          </div>}

          {/* FORM TAB */}
          {activeTab === "form" && <div>
            {analysis.last10 ? [{ team: homeTeam, color: C.home, games: analysis.last10.home }, { team: awayTeam, color: C.away, games: analysis.last10.away }].map(({ team, color, games }) => <div key={team} style={{ marginBottom: S.xl }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color, fontFamily: F.mono, marginBottom: S.md, textTransform: "uppercase" }}>{team} — Last {games?.length || 10}</div>
              {(games || []).map((g, i) => { const isW = g.res === "W"; const elite = g.oppRk && g.oppRk <= 50; return <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 1fr 50px", gap: S.sm, padding: S.sm + "px 0", fontSize: 12, fontFamily: F.mono, borderBottom: "1px solid " + C.border + "15", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: C.t3 }}>{g.date}</span>
                <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}><span style={{ color: C.t1 }}>{g.ha === "A" ? "@ " : ""}{g.opp}</span>{g.oppRk && <span style={{ fontSize: 10, marginLeft: S.xs, padding: "1px 4px", borderRadius: 3, background: elite ? C.pos + "15" : C.bg, color: elite ? C.pos : C.t3 }}>#{g.oppRk}</span>}</div>
                <span style={{ color: isW ? C.pos : C.neg, fontWeight: 600, textAlign: "right" }}>{g.res} {g.score}</span>
              </div>; })}
              {games && games.length > 0 && (() => { const withRk = games.filter(g => g.oppRk); const elite = withRk.filter(g => g.oppRk <= 50); const mid = withRk.filter(g => g.oppRk > 50 && g.oppRk <= 150); const eW = elite.filter(g => g.res === "W").length; const mW = mid.filter(g => g.res === "W").length; return <div style={{ marginTop: S.sm, display: "flex", gap: S.sm, flexWrap: "wrap" }}>{elite.length > 0 && <div style={{ background: C.bg, borderRadius: R.sm, padding: S.xs + "px " + S.sm + "px", fontSize: 10, fontFamily: F.mono }}><span style={{ color: C.t3 }}>vs Top 50: </span><span style={{ color: eW / elite.length > 0.5 ? C.pos : C.neg, fontWeight: 700 }}>{eW}-{elite.length - eW}</span></div>}{mid.length > 0 && <div style={{ background: C.bg, borderRadius: R.sm, padding: S.xs + "px " + S.sm + "px", fontSize: 10, fontFamily: F.mono }}><span style={{ color: C.t3 }}>vs 50-150: </span><span style={{ color: mW / mid.length > 0.5 ? C.pos : C.neg, fontWeight: 700 }}>{mW}-{mid.length - mW}</span></div>}</div>; })()}
            </div>) : <div style={{ textAlign: "center", padding: S.xl + "px", color: C.t3, fontSize: 14 }}>Recent game data not available</div>}
          </div>}

          {/* TRENDS TAB */}
          {activeTab === "trends" && <div>
            {analysis.trends ? <div>
              {[{ team: homeTeam, color: C.home, data: analysis.trends.home, label: "HOME" }, { team: awayTeam, color: C.away, data: analysis.trends.away, label: "AWAY" }].map(({ team, color, data, label }) => {
                if (!data) return null;
                return <div key={label} style={{ marginBottom: S.xl }}>
                  <div style={{ fontSize: 10, letterSpacing: 2, color, fontFamily: F.mono, marginBottom: S.md, textTransform: "uppercase", borderBottom: "2px solid " + color + "30", paddingBottom: S.xs }}>{team} ({label})</div>
                  <TrendTable title="Against the Spread" rows={data.ats} hasAts={true} />
                  <TrendTable title="Over / Under" rows={data.ou} hasAts={false} />
                  <TrendTable title="Straight Up" rows={data.su} hasAts={false} />
                  {data.keyTrend && <div style={{ padding: S.sm + "px " + S.md + "px", background: color + "08", border: "1px solid " + color + "20", borderRadius: R.sm, fontSize: 12, color: C.t1 }}><strong style={{ color }}>Key:</strong> {data.keyTrend}</div>}
                </div>;
              })}
              {analysis.trends.matchupTrends && <div style={{ padding: S.lg, background: C.bg, borderRadius: R.md }}><div style={{ fontSize: 10, letterSpacing: 2, color: C.ext, fontFamily: F.mono, marginBottom: S.sm, textTransform: "uppercase" }}>Matchup Analysis</div><div style={{ fontSize: 14, color: C.t2, lineHeight: 1.6 }}>{analysis.trends.matchupTrends}</div></div>}
            </div> : <div style={{ textAlign: "center", padding: S.xl + "px", color: C.t3, fontSize: 14 }}>Trends data not available</div>}
          </div>}

          {/* EDGE TAB */}
          {activeTab === "edge" && <div>
            {analysis.narrative ? <div style={{ fontSize: 14, lineHeight: 1.8, color: C.t2, whiteSpace: "pre-wrap" }}>{analysis.narrative}</div> : <div style={{ fontSize: 14, color: C.t3, lineHeight: 1.8 }}>Narrative analysis will appear after trends data loads.</div>}
            {analysis.bettingAnalysis && <div style={{ marginTop: S.xl, padding: S.lg, background: C.home + "06", border: "1px solid " + C.home + "15", borderRadius: R.md }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.home, fontFamily: F.mono, marginBottom: S.sm, textTransform: "uppercase" }}>Model vs Vegas</div>
              <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.6 }}>{analysis.bettingAnalysis}</div>
            </div>}
            {/* Methodology */}
            <div style={{ marginTop: S.xl }}>
              <details>
                <summary style={{ fontSize: 10, color: C.t3, fontFamily: F.mono, cursor: "pointer", letterSpacing: 1.5, textTransform: "uppercase" }}>How this works</summary>
                <div style={{ marginTop: S.md, fontSize: 12, color: C.t3, lineHeight: 1.8 }}>
                  Real Torvik efficiency ratings are pulled via live web search, validated for the current season, then fed into a possession-by-possession Monte Carlo simulation. Each of 2,000 games resolves discrete basketball events — turnovers, offensive rebounds, shot selection, free throws — calibrated to matchup-adjusted rates. Intangibles like home court advantage, rest differential, travel fatigue, and coaching adjustments are layered on top. The result is a probability distribution, not a single prediction.
                </div>
              </details>
            </div>
          </div>}

        </div></FadeIn>

        <div style={{ textAlign: "center", marginTop: S.lg, fontSize: 10, color: C.border, fontFamily: F.mono }}>Powered by Torvik data · 2,000 simulations</div>
      </div>}
    </div>
  );
}
