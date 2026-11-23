/* Rafiq — appli d'objectifs à plusieurs avec preuves photo. JS sans build. */
"use strict";

const sb = supabase.createClient(RAFIQ.url, RAFIQ.anon, { auth: { persistSession: true, autoRefreshToken: true } });
const app = document.getElementById("app");
const PRIERES = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const NOMS = { fajr: "Fajr", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" };
const IDX = { fajr: 0, dhuhr: 2, asr: 3, maghrib: 4, isha: 5 }; // dans [fajr, chourouq, dhuhr, asr, maghrib, isha]

const E = {
  session: null, moi: null, lobbies: [], lobby: null, membres: [], objectifs: [], preuves: [],
  calendrier: null, urls: {}, canal: null, lobbyCharge: null, brouillon: null, onglet: "jour",
  propositions: [], votes: [], ed: {}, edOpts: {}, edition: null, cleClaude: false,
};

// ---------- Petits outils ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (min) => { const x = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
const enMin = (s) => { const [h, m] = String(s).slice(0, 5).split(":").map(Number); return h * 60 + m; };
const versDate = (j) => new Date(j * 864e5).toISOString().slice(0, 10);
const depuisDate = (s) => Math.round(Date.parse(s + "T00:00:00Z") / 864e5);
const fuseau = () => E.moi?.fuseau || "Europe/Paris";
function local(date = new Date(), tz = fuseau()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const y = +p.year, m = +p.month, d = +p.day;
  return { y, m, d, jourNum: Math.round(Date.UTC(y, m - 1, d) / 864e5), minutes: +p.hour * 60 + +p.minute };
}
const dateLongue = (j) => new Date(j * 864e5).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dateCourte = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const heureDe = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: fuseau() });
const initiale = (s) => (s || "?").trim().charAt(0).toUpperCase();
const prenomDe = (uid) => E.membres.find((m) => m.user_id === uid)?.profils?.prenom || "?";
const pts = (n) => `${n} pt${Math.abs(n) > 1 ? "s" : ""}`;

let toastT;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("vu");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("vu"), 3200);
}
function traduire(e) {
  const m = e?.message || String(e);
  if (/Invalid login/i.test(m)) return "Identifiant ou mot de passe faux.";
  if (/already registered|saving new user/i.test(m)) return "Cet identifiant est déjà pris.";
  if (/Password should be/i.test(m)) return "Mot de passe trop court (6 caractères minimum).";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Pas de connexion internet.";
  return m.charAt(0).toUpperCase() + m.slice(1);
}
const nettoyerPseudo = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9._-]/g, "");

const ICONES = {
  jour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  fil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
  classement: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  reglages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  photo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  tourner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>',
  fermer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// ---------- Horaires de prière ----------
function horairesJour(jourNum) {
  const d = new Date(jourNum * 864e5);
  const t = E.calendrier?.[d.getUTCMonth()]?.[String(d.getUTCDate())];
  if (t?.length >= 6) return t.slice(0, 6).map(enMin);
  if (E.moi?.lat != null && E.moi?.lon != null && window.adhan) {
    const p = adhan.CalculationMethod.Other(); p.fajrAngle = 12; p.ishaAngle = 12;
    const pt = new adhan.PrayerTimes(new adhan.Coordinates(E.moi.lat, E.moi.lon), new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12), p);
    return [pt.fajr, pt.sunrise, pt.dhuhr, pt.asr, pt.maghrib, pt.isha].map((x) => local(x).minutes);
  }
  return null;
}
function fenetrePriere(p, jourNum) {
  const h = horairesJour(jourNum); if (!h) return null;
  const debut = h[IDX[p]];
  const fin = p === "isha" ? (horairesJour(jourNum + 1)?.[0] ?? h[0]) : h[IDX[p] + 1];
  return { debut, fin };
}

// ---------- Jour courant d'un objectif ----------
function jourObjectif(o) {
  const t = local(); const tAbs = t.jourNum * 1440 + t.minutes;
  if (o.type === "priere") {
    const f = fenetrePriere(o.priere, t.jourNum);
    if (!f || tAbs >= t.jourNum * 1440 + f.debut) return t.jourNum;
    const hier = E.preuves.find((p) => p.objectif_id === o.id && p.user_id === E.moi.id && p.jour === versDate(t.jourNum - 1));
    return hier ? t.jourNum : t.jourNum - 1;
  }
  const F = enMin(E.lobby?.fin_journee || "04:00");
  return Math.floor((tAbs - F) / 1440);
}
function preuveDe(o, uid, jourNum) {
  return E.preuves.find((p) => p.objectif_id === o.id && p.user_id === uid && p.jour === versDate(jourNum));
}
function sousTitre(o) {
  if (o.type === "priere") {
    const f = fenetrePriere(o.priere, local().jourNum);
    return f ? `${hhmm(f.debut)} → ${hhmm(f.fin)}` : "horaires : choisis ta mosquée";
  }
  if (o.type === "horaire") {
    if (o.heure_debut && o.heure_fin) return `entre ${o.heure_debut.slice(0, 5)} et ${o.heure_fin.slice(0, 5)}`;
    if (o.heure_fin) return `avant ${o.heure_fin.slice(0, 5)}`;
    if (o.heure_debut) return `à partir de ${o.heure_debut.slice(0, 5)}`;
    return "avec horaire";
  }
  return "dans la journée";
}
const jourDe = (iso) => versDate(local(new Date(iso)).jourNum);
// Objectifs actifs (sans jour) ou qui existaient ce jour-là (ajoutés en cours de lobby, retirés après un vote)
const existeLe = (o, jour) => (jour ? jourDe(o.created_at) <= jour && (!o.retire_le || jourDe(o.retire_le) > jour) : !o.retire_le);
const objectifsDe = (uid, jour) => E.objectifs.filter((o) => (!o.owner || o.owner === uid) && existeLe(o, jour)).sort((a, b) => (!!a.owner - !!b.owner) || a.ordre - b.ordre);
const estAdmin = () => E.lobby?.admin === E.moi?.id;

// ---------- Scores ----------
function scores() {
  const debut = E.lobby.date_debut, fin = E.lobby.date_fin;
  const auj = versDate(local().jourNum);
  const r = {};
  for (const m of E.membres) r[m.user_id] = { total: 0, aujourdhui: 0, parJour: {} };
  for (const p of E.preuves) {
    if (p.refusee || !r[p.user_id] || p.jour < debut || p.jour > fin) continue;
    r[p.user_id].total += p.points;
    r[p.user_id].parJour[p.jour] = (r[p.user_id].parJour[p.jour] || 0) + p.points;
    if (p.jour === auj) r[p.user_id].aujourdhui += p.points;
  }
  return r;
}
function etatLobby() {
  const auj = versDate(local().jourNum);
  if (auj < E.lobby.date_debut) return "avant";
  if (auj > E.lobby.date_fin) return "fini";
  return "encours";
}

// ---------- Données ----------
async function chargerMoi() {
  const { data } = await sb.from("profils").select("*").eq("id", E.session.user.id).single();
  E.moi = data;
  const { data: tr } = await sb.from("triche").select("user_id").eq("user_id", E.session.user.id).maybeSingle();
  E.triche = !!tr;
  const { data: ic } = await sb.rpc("infos_claude");
  E.infosClaude = ic || null; E.cleClaude = !!ic;
  E.calendrier = null;
  if (data?.mosquee_url) {
    const { data: h } = await sb.from("horaires_mosquee").select("calendrier").eq("url", data.mosquee_url).maybeSingle();
    E.calendrier = h?.calendrier || null;
  }
}
async function chargerLobbies() {
  const { data } = await sb.from("membres").select("lobby_id, lobbies(*)").eq("user_id", E.session.user.id);
  E.lobbies = (data || []).map((x) => x.lobbies).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async function chargerLobby(id) {
  const [l, m, o, p] = await Promise.all([
    sb.from("lobbies").select("*").eq("id", id).maybeSingle(),
    sb.from("membres").select("user_id, joined_at, profils(id, prenom, pseudo)").eq("lobby_id", id),
    sb.from("objectifs").select("*").eq("lobby_id", id).order("ordre"),
    sb.from("preuves").select("*").eq("lobby_id", id).order("pris_le", { ascending: false }).limit(1000),
  ]);
  if (!l.data) throw new Error("Lobby introuvable.");
  E.lobby = l.data; E.membres = (m.data || []).sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  E.objectifs = o.data || []; E.preuves = p.data || [];
  await chargerPropositions(id);
  E.lobbyCharge = id; E.jourFil = null;
  try { localStorage.setItem("rafiq-lobby", id); } catch {}
  ecouter(id);
}
async function urlsPhotos(chemins) {
  const manquants = [...new Set(chemins.filter((c) => c && !E.urls[c]))];
  if (manquants.length) {
    const { data } = await sb.storage.from("preuves").createSignedUrls(manquants, 3600 * 6);
    for (const x of data || []) if (x.signedUrl) E.urls[x.path] = x.signedUrl;
  }
}
async function chargerPropositions(id) {
  const { data: pr } = await sb.from("propositions").select("*").eq("lobby_id", id).eq("statut", "ouverte").order("created_at");
  E.propositions = pr || [];
  const ids = E.propositions.map((x) => x.id);
  E.votes = ids.length ? (await sb.from("votes").select("*").in("proposition_id", ids)).data || [] : [];
}
// Une proposition appliquée peut changer les objectifs et le lobby : on recharge tout
async function rechargerVotes() {
  if (!E.lobbyCharge) return;
  const id = E.lobbyCharge;
  const [l, o] = await Promise.all([sb.from("lobbies").select("*").eq("id", id).maybeSingle(), sb.from("objectifs").select("*").eq("lobby_id", id).order("ordre")]);
  await chargerPropositions(id);
  if (E.lobbyCharge !== id) return;
  if (l.data) E.lobby = l.data;
  E.objectifs = o.data || E.objectifs;
  if (location.hash.startsWith("#/lobby/") && !document.querySelector(".camera, .visio") && !document.activeElement?.matches("input,select,textarea")) rendre();
}
let voteT;
function ecouter(id) {
  if (E.canal?.lobbyId === id) return;
  if (E.canal) sb.removeChannel(E.canal);
  const plusTard = () => { clearTimeout(voteT); voteT = setTimeout(rechargerVotes, 300); };
  E.canal = sb.channel("lobby-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "preuves", filter: `lobby_id=eq.${id}` }, () => rafraichir())
    .on("postgres_changes", { event: "*", schema: "public", table: "propositions", filter: `lobby_id=eq.${id}` }, plusTard)
    .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, plusTard)
    .subscribe();
  E.canal.lobbyId = id;
}
let rafraichEnCours = false;
async function rafraichir() {
  if (!E.lobbyCharge || rafraichEnCours) return;
  rafraichEnCours = true;
  try {
    const { data } = await sb.from("preuves").select("*").eq("lobby_id", E.lobbyCharge).order("pris_le", { ascending: false }).limit(1000);
    E.preuves = data || [];
    if (location.hash.startsWith("#/lobby/") && !document.querySelector(".camera") && !document.activeElement?.matches("input,select,textarea")) { await rendre(); E.visio?.maj(); }
  } finally { rafraichEnCours = false; }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) rafraichir(); });

// ---------- Routeur ----------
// Navigation explicite (pushState ne déclenche pas hashchange : un seul rendu, toujours)
function allerA(h, remplacer = false) {
  if (location.hash === h) return rendre();
  history[remplacer ? "replaceState" : "pushState"](null, "", h);
  return rendre();
}
window.addEventListener("hashchange", () => rendre());
window.addEventListener("popstate", () => rendre());
async function rendre() {
  if (!/\/fil/.test(location.hash)) E.visio?.fermer(true);
  const h = location.hash.replace(/^#\/?/, "").split("/");
  if (!E.session) return ecranConnexion();
  if (!E.moi) await chargerMoi();
  // Code d'invitation gardé pendant la connexion : on le consomme une seule fois
  let codeGarde = null; try { codeGarde = sessionStorage.getItem("rafiq-code"); sessionStorage.removeItem("rafiq-code"); } catch {}
  if (h[0] === "rejoindre" && h[1]) return rejoindre(h[1]);
  if (codeGarde) return rejoindre(codeGarde);
  if (h[0] === "creer") return ecranCreer();
  if (h[0] === "lobby" && h[1]) {
    try {
      if (E.lobbyCharge !== h[1]) { app.innerHTML = '<div class="chargement">Chargement…</div>'; await chargerLobby(h[1]); }
    } catch (e) { toast(traduire(e)); allerA("#/"); return; }
    const ong = ["jour", "fil", "classement", "reglages"].includes(h[2]) ? h[2] : "jour";
    if (ong === "fil" && E.onglet !== "fil") E.jourFil = null;
    E.onglet = ong;
    const focus = h[3] === "preuve" ? h[4] : null;
    if (ong === "reglages") E.sousR = ["objectifs", "lobby", "moi"].includes(h[3]) ? h[3] : E.sousR || "objectifs";
    if (focus) E.onglet = "fil";
    return ecranLobby(focus);
  }
  return ecranAccueil();
}

function onglets() {
  const id = E.lobby.id;
  const o = [["jour", "Aujourd'hui"], ["fil", "Preuves"], ["classement", "Classement"], ["reglages", "Réglages"]];
  return `<nav class="onglets">${o.map(([k, t]) => `<a href="#/lobby/${id}/${k}" class="${E.onglet === k ? "actif" : ""}">${ICONES[k]}${t}</a>`).join("")}</nav>`;
}

// ---------- Connexion ----------
// Motifs du fond : icônes au trait (réussite, effort, prière…) répétées en tuile
const MOTIFS = {
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  trophee: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  cerveau: '<path d="M12 5.5a3 3 0 0 0-5.5-1.6A3 3 0 0 0 4 8.5a3 3 0 0 0 .5 4.8A3.2 3.2 0 0 0 7.5 18a3 3 0 0 0 4.5 1.5z"/><path d="M12 5.5a3 3 0 0 1 5.5-1.6A3 3 0 0 1 20 8.5a3 3 0 0 1-.5 4.8 3.2 3.2 0 0 1-3 4.7 3 3 0 0 1-4.5 1.5"/><path d="M8.5 9.5c1.2 0 2 .8 2 2M15.5 9.5c-1.2 0-2 .8-2 2M8 14.5c1 0 1.8-.4 2.3-1M16 14.5c-1 0-1.8-.4-2.3-1"/>',
  etoile: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/>',
  cible: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  progres: '<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>',
  lune: '<path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z"/>',
  flamme: '<path d="M12 3c.5 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.8 2.3-5.5.9 1 1.4 2 1.6 3.3C12.4 8.5 12.3 5.6 12 3z"/>',
  drapeau: '<path d="M5 21V4M5 4.5h11.5l-2.3 4 2.3 4H5"/>',
  reveil: '<circle cx="12" cy="13" r="7"/><path d="M12 10v3.2l2 1.6M4.5 5.5l3-2.5M19.5 5.5l-3-2.5"/>',
  halteres: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  etincelle: '<path d="M12 3.5l1.6 5 5 1.6-5 1.6-1.6 5-1.6-5-5-1.6 5-1.6z"/>',
  medaille: '<circle cx="12" cy="15" r="5"/><path d="M8.5 11.5L6 3h4l2 5 2-5h4l-2.5 8.5"/>',
};
const PLACES = [
  ["check", 14, 18, 1.7, -12], ["trophee", 112, 6, 1.9, 8], ["cerveau", 214, 30, 1.8, -6], ["etincelle", 176, 104, 0.9, 0],
  ["etoile", 62, 104, 1.3, 14], ["cible", 252, 122, 1.4, 0], ["progres", 126, 150, 1.6, -8], ["lune", 14, 186, 1.4, -18],
  ["flamme", 206, 200, 1.5, 6], ["drapeau", 96, 232, 1.4, 10], ["reveil", 20, 262, 1.2, -8], ["medaille", 262, 252, 1.3, 12],
  ["halteres", 160, 268, 1.2, 20],
];
function motifsSVG() {
  const g = PLACES.map(([n, x, y, s, r]) => `<g transform="translate(${x} ${y}) rotate(${r} ${12 * s} ${12 * s}) scale(${s})" stroke-width="${(1.5 / s).toFixed(2)}">${MOTIFS[n]}</g>`).join("");
  return `<svg class="motifs" aria-hidden="true"><defs><pattern id="tuile-motifs" width="310" height="310" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${g}</g></pattern></defs><rect width="100%" height="100%" fill="url(#tuile-motifs)"/></svg>
  <svg class="vagues" viewBox="0 0 400 320" preserveAspectRatio="none" aria-hidden="true">
    <path d="M-20 250C60 190 120 300 210 240S350 130 430 170"/><path class="v2" d="M-20 290C80 240 150 320 240 275S360 200 430 225"/><path class="v3" d="M-20 70C70 30 130 120 220 80S340 10 430 40"/>
  </svg>`;
}
const ANNEAUX = '<svg class="anneaux" viewBox="0 0 64 64" aria-hidden="true"><circle class="a1" cx="24" cy="32" r="11"/><circle class="a2" cx="40" cy="32" r="11"/></svg>';
const IC = {
  user: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  prenom: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/></svg>',
  cadenas: '<svg class="ic" viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  oeil: '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  oeilBarre: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.5 6.9C4 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  fleche: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};
const TEXTES_AUTH = {
  connexion: { titre: "Content de te revoir", sous: "Connecte-toi pour retrouver ton lobby.", bouton: "Se connecter" },
  inscription: { titre: "Bienvenue 👋", sous: "Crée ton compte en quelques secondes.", bouton: "Créer mon compte" },
};
function ecranConnexion(mode = "connexion") {
  const h = location.hash.replace(/^#\/?/, "").split("/");
  if (h[0] === "rejoindre" && h[1]) { try { sessionStorage.setItem("rafiq-code", h[1]); } catch {} }
  const invite = h[0] === "rejoindre" && h[1];
  app.innerHTML = `
  <main class="auth">
    <section class="auth-hero">
      ${motifsSVG()}
      <div class="auth-marque">
        ${ANNEAUX}
        <h1>Rafiq</h1>
        <p>Tenez vos objectifs ensemble.<br>Chaque réussite se prouve en photo.</p>
      </div>
    </section>
    <form id="f" class="auth-feuille" autocomplete="on" novalidate>
      ${invite ? `<div class="auth-invite">🤝 Tu es invité dans un lobby : connecte-toi ou crée ton compte pour le rejoindre.</div>` : ""}
      <div class="bascule" data-mode="${mode}" role="tablist">
        <button type="button" role="tab" data-mode="connexion">Se connecter</button>
        <button type="button" role="tab" data-mode="inscription">Créer un compte</button>
      </div>
      <div class="auth-titre"><h2 id="a-titre"></h2><p id="a-sous"></p></div>
      <div class="champs">
      <label class="flottant">${IC.user}<input name="pseudo" placeholder=" " autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username"><span>Identifiant</span></label>
      <div class="repli" id="r-prenom"><div><label class="flottant">${IC.prenom}<input name="prenom" placeholder=" " autocomplete="given-name"><span>Prénom affiché</span></label></div></div>
      <label class="flottant">${IC.cadenas}<input name="mdp" type="password" placeholder=" " autocomplete="current-password"><span>Mot de passe</span>
        <button type="button" class="oeil" aria-label="Afficher le mot de passe">${IC.oeil}</button></label>
      <p class="aide" id="a-aide"></p>
      </div>
      <p class="erreur" id="err" role="alert"></p>
      <button class="btn auth-btn" type="submit"><span id="a-bouton"></span>${IC.fleche}</button>
    </form>
  </main>`;
  const f = app.querySelector("#f"), err = app.querySelector("#err");
  const appliquer = (m) => {
    mode = m;
    const t = TEXTES_AUTH[m], inscr = m === "inscription";
    f.querySelector(".bascule").dataset.mode = m;
    f.querySelectorAll(".bascule button").forEach((b) => b.setAttribute("aria-selected", b.dataset.mode === m));
    app.querySelector("#a-titre").textContent = t.titre; app.querySelector("#a-sous").textContent = t.sous;
    app.querySelector("#a-bouton").textContent = t.bouton;
    app.querySelector("#r-prenom").classList.toggle("ouvert", inscr);
    f.prenom.tabIndex = inscr ? 0 : -1;
    f.mdp.autocomplete = inscr ? "new-password" : "current-password";
    app.querySelector("#a-aide").textContent = inscr ? "Identifiant : lettres et chiffres, sans espace. Mot de passe : 6 caractères minimum." : "";
    err.textContent = "";
  };
  appliquer(mode);
  f.querySelectorAll(".bascule button").forEach((b) => b.onclick = () => appliquer(b.dataset.mode));
  const oeil = f.querySelector(".oeil");
  oeil.onclick = () => {
    const vu = f.mdp.type === "password"; f.mdp.type = vu ? "text" : "password";
    oeil.innerHTML = vu ? IC.oeilBarre : IC.oeil; oeil.setAttribute("aria-label", vu ? "Masquer le mot de passe" : "Afficher le mot de passe");
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const inscr = mode === "inscription", btn = f.querySelector(".auth-btn");
    const pseudo = nettoyerPseudo(String(f.pseudo.value)), password = String(f.mdp.value), prenom = String(f.prenom.value).trim();
    const secouer = (msg, champ) => { err.textContent = msg; champ?.focus(); const c = f.querySelector(".champs"); c.classList.remove("secoue"); void c.offsetWidth; c.classList.add("secoue"); };
    if (pseudo.length < 2) return secouer("Identifiant trop court (lettres et chiffres).", f.pseudo);
    if (inscr && !prenom) return secouer("Indique le prénom que les autres verront.", f.prenom);
    if (password.length < 6) return secouer("Mot de passe trop court (6 caractères minimum).", f.mdp);
    btn.disabled = true; btn.classList.add("charge"); err.textContent = "";
    const email = `${pseudo}@rafiq.invalid`;
    const r = inscr
      ? await sb.auth.signUp({ email, password, options: { data: { pseudo, prenom } } })
      : await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.classList.remove("charge");
    if (r.error) secouer(traduire(r.error));
  };
}

// ---------- Accueil ----------
async function ecranAccueil() {
  await chargerLobbies();
  let dernier = null; try { dernier = localStorage.getItem("rafiq-lobby"); } catch {}
  if (dernier && E.lobbies.some((l) => l.id === dernier) && !sessionStorage.getItem("rafiq-accueil")) {
    allerA(`#/lobby/${dernier}/jour`, true); return;
  }
  app.innerHTML = `
  <main class="page sans-onglets pile-l">
    <div class="entete"><div><h1>Salam ${esc(E.moi?.prenom)}</h1><div class="sous">Tes lobbies</div></div></div>
    ${E.lobbies.length ? `<div class="pile">${E.lobbies.map((l) => `
      <a href="#/lobby/${l.id}/jour" class="carte ligne entre" style="text-decoration:none;color:inherit">
        <div><b>${esc(l.nom)}</b><div class="doux petit">${dateCourte(l.date_debut)} → ${dateCourte(l.date_fin)}${l.enjeu ? " · " + esc(l.enjeu) : ""}</div></div>
        <span class="doux">›</span>
      </a>`).join("")}</div>` : `<div class="carte plate centre doux">Pas encore de lobby. Crée-en un ou rejoins celui d'un ami avec son code.</div>`}
    <div class="pile">
      <a href="#/creer" class="btn" style="text-decoration:none">Créer un lobby</a>
      <form id="j" class="carte pile">
        <label class="champ"><span>Rejoindre avec un code</span><input name="code" maxlength="5" placeholder="ABCDE" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.2em;font-weight:700"></label>
        <button class="btn second" type="submit">Rejoindre</button>
      </form>
    </div>
    <button class="lien" data-a="deco">Se déconnecter</button>
  </main>`;
  app.querySelector("#j").onsubmit = (ev) => { ev.preventDefault(); const c = new FormData(ev.target).get("code"); if (c) rejoindre(String(c)); };
}
// Un seul appel à la fois (le lien d'invitation peut déclencher deux rendus d'affilée)
let rejoindreEnCours = null;
function rejoindre(code) {
  if (!rejoindreEnCours) rejoindreEnCours = rejoindreVraiment(code).finally(() => { rejoindreEnCours = null; });
  return rejoindreEnCours;
}
async function rejoindreVraiment(code) {
  const { data, error } = await sb.rpc("rejoindre_lobby", { p_code: code.toUpperCase() });
  if (error) { toast(traduire(error)); try { sessionStorage.setItem("rafiq-accueil", "1"); } catch {} return allerA("#/", true); }
  toast("Bienvenue dans le lobby 🤝");
  E.lobbyCharge = null;
  allerA(`#/lobby/${data}/reglages`, true);
}

// ---------- Création de lobby ----------
const MODELES = {
  reveil: { titre: "Réveil avant 7h", emoji: "⏰", type: "horaire", heure_debut: "04:00", heure_fin: "07:00", pts_temps: 3, pts_retard: 1 },
  prieres: { titre: "5 prières à l'heure", emoji: "🕌", type: "prieres", pts_temps: 3, pts_retard: 1 },
  rangee: { titre: "Maison rangée avant de dormir", emoji: "🏠", type: "horaire", heure_debut: "20:00", heure_fin: "03:00", pts_temps: 3, pts_retard: 1 },
  libre: { titre: "", emoji: "✅", type: "journee", heure_debut: "", heure_fin: "", pts_temps: 2, pts_retard: 1 },
};
function ecranCreer() {
  const auj = local().jourNum;
  if (!E.brouillon) E.brouillon = {
    nom: "", enjeu: "Le perdant paie le buffet à volonté", date_debut: versDate(auj + 1), date_fin: versDate(auj + 30),
    nb_perso: 3, perso_pts_temps: 2, perso_pts_retard: 1, max_membres: 2,
    objectifs: [{ ...MODELES.reveil }, { ...MODELES.prieres }, { ...MODELES.rangee }],
  };
  const b = E.brouillon;
  E.edOpts.creation = {
    lobbyId: null, pts: 3, bouton: () => "Ajouter aux objectifs communs",
    action: async (d) => { lire(); b.objectifs.push({ ...d.objectif, heure_debut: d.objectif.heure_debut || "", heure_fin: d.objectif.heure_fin || "" }); viderEd("creation"); ecranCreer(); },
  };
  const ligneObj = (o, i) => `
    <div class="edit-obj" data-i="${i}">
      <div class="ligne">
        <input data-k="emoji" value="${esc(o.emoji)}" style="width:56px;text-align:center;flex:none" aria-label="Emoji">
        <input data-k="titre" value="${esc(o.titre)}" placeholder="Nom de l'objectif" ${o.type === "prieres" ? "readonly" : ""}>
        <button type="button" class="btn rond second" data-a="suppr-obj" data-i="${i}" aria-label="Retirer">${ICONES.fermer.replace("<svg", '<svg width="18" height="18"')}</button>
      </div>
      ${o.type === "prieres" ? `<p class="doux petit" style="margin:8px 0 0">Fajr, Dhuhr, Asr, Maghrib, Isha · à temps = entre l'adhan et la prière suivante (Fajr : jusqu'au lever du soleil). Horaires de la mosquée de chacun.</p>` : `
      <div class="grille-3">
        <label class="champ"><span>Type</span><select data-k="type">
          <option value="horaire" ${o.type === "horaire" ? "selected" : ""}>Avec horaire</option>
          <option value="journee" ${o.type === "journee" ? "selected" : ""}>Dans la journée</option>
          <option value="priere" ${o.type === "priere" ? "selected" : ""}>Une prière</option></select></label>
        ${o.type === "priere" ? `<label class="champ"><span>Prière</span><select data-k="priere">${PRIERES.map((p) => `<option value="${p}" ${o.priere === p ? "selected" : ""}>${NOMS[p]}</option>`).join("")}</select></label>` : ""}
        ${o.type === "horaire" ? `<label class="champ"><span>Pas avant</span><input type="time" data-k="heure_debut" value="${esc(o.heure_debut)}"></label>
        <label class="champ"><span>À faire avant</span><input type="time" data-k="heure_fin" value="${esc(o.heure_fin)}"></label>` : ""}
      </div>`}
      <div class="grille-3">
        <label class="champ"><span>${o.type === "prieres" ? "Par prière à temps" : "Points à temps"}</span><input type="number" min="0" max="20" data-k="pts_temps" value="${o.pts_temps}"></label>
        ${o.type === "journee" ? "" : `<label class="champ"><span>Points en retard</span><input type="number" min="0" max="20" data-k="pts_retard" value="${o.pts_retard}"></label>`}
      </div>
    </div>`;
  app.innerHTML = `
  <main class="page sans-onglets pile-l">
    <div class="entete"><div><a href="#/" class="lien">‹ Retour</a><h1>Nouveau lobby</h1></div></div>
    <form id="c" class="pile-l">
      <section class="carte pile">
        <label class="champ"><span>Nom du lobby</span><input name="nom" required value="${esc(b.nom)}" placeholder="ex. Défi hiver"></label>
        <label class="champ"><span>Enjeu</span><input name="enjeu" value="${esc(b.enjeu)}"></label>
        <div class="grille-2">
          <label class="champ"><span>Début</span><input type="date" name="date_debut" value="${b.date_debut}" required></label>
          <label class="champ"><span>Fin (jour de l'enjeu)</span><input type="date" name="date_fin" value="${b.date_fin}" required></label>
        </div>
        <label class="champ"><span>Nombre de personnes</span><input type="number" name="max_membres" min="2" max="10" value="${b.max_membres}"></label>
      </section>
      <section class="pile">
        <h3>Objectifs communs · verrouillés après création</h3>
        ${b.objectifs.map(ligneObj).join("")}
        <div class="choix">
          ${b.objectifs.some((o) => o.type === "prieres") ? "" : '<button type="button" data-a="ajout-modele" data-m="prieres">+ 5 prières</button>'}
          <button type="button" data-a="ajout-modele" data-m="reveil">+ Réveil</button>
          <button type="button" data-a="ajout-modele" data-m="rangee">+ Maison rangée</button>
          <button type="button" data-a="ajout-modele" data-m="libre">+ Autre</button>
        </div>
        ${E.cleClaude ? `<div class="carte pile"><h3>✨ Décrire une activité</h3>${editeurHTML("creation")}</div>` : `<p class="doux petit" style="margin:0">Astuce : connecte ton compte Claude (Réglages d'un lobby) pour créer une activité juste en la décrivant.</p>`}
      </section>
      <section class="carte pile">
        <h3>Objectifs perso</h3>
        <label class="champ"><span>Nombre d'objectifs que chacun choisit</span><input type="number" name="nb_perso" min="0" max="10" value="${b.nb_perso}"></label>
        <div class="grille-2">
          <label class="champ"><span>Points à temps</span><input type="number" name="perso_pts_temps" min="0" max="20" value="${b.perso_pts_temps}"></label>
          <label class="champ"><span>Points en retard</span><input type="number" name="perso_pts_retard" min="0" max="20" value="${b.perso_pts_retard}"></label>
        </div>
        <p class="doux petit" style="margin:0">Chacun choisit les siens avant la date de début, ensuite tout est figé. Pas de preuve = 0 point.</p>
      </section>
      <p class="erreur" id="err"></p>
      <button class="btn" type="submit">Créer le lobby</button>
    </form>
  </main>`;
  const form = app.querySelector("#c");
  const lire = () => {
    const f = new FormData(form);
    for (const k of ["nom", "enjeu", "date_debut", "date_fin"]) b[k] = String(f.get(k) || "");
    for (const k of ["nb_perso", "perso_pts_temps", "perso_pts_retard", "max_membres"]) b[k] = +f.get(k);
    form.querySelectorAll(".edit-obj").forEach((el) => {
      const o = b.objectifs[+el.dataset.i];
      el.querySelectorAll("[data-k]").forEach((inp) => { o[inp.dataset.k] = inp.type === "number" ? +inp.value : inp.value; });
    });
  };
  form.addEventListener("change", (ev) => { if (ev.target.dataset.k === "type") { lire(); const o = b.objectifs[+ev.target.closest(".edit-obj").dataset.i]; if (o.type === "priere" && !o.priere) o.priere = "fajr"; ecranCreer(); } });
  form.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-a]"); if (!a) return;
    lire();
    if (a.dataset.a === "suppr-obj") b.objectifs.splice(+a.dataset.i, 1);
    if (a.dataset.a === "ajout-modele") b.objectifs.push({ ...MODELES[a.dataset.m] });
    ecranCreer();
  });
  form.onsubmit = async (ev) => {
    ev.preventDefault(); lire();
    const err = app.querySelector("#err");
    if (b.date_fin < b.date_debut) { err.textContent = "La fin est avant le début."; return; }
    const objs = [];
    for (const o of b.objectifs) {
      if (o.type === "prieres") { for (const p of PRIERES) objs.push({ titre: NOMS[p], emoji: "🕌", type: "priere", priere: p, pts_temps: o.pts_temps, pts_retard: o.pts_retard }); continue; }
      if (!o.titre.trim()) { err.textContent = "Donne un nom à chaque objectif."; return; }
      if (o.type === "horaire" && !o.heure_fin && !o.heure_debut) { err.textContent = `Mets une heure pour « ${o.titre} ».`; return; }
      objs.push({ ...o, titre: o.titre.trim(), pts_retard: o.type === "journee" ? 0 : o.pts_retard });
    }
    const btn = form.querySelector(".btn[type=submit]"); btn.disabled = true;
    const { data, error } = await sb.rpc("creer_lobby", {
      p_nom: b.nom.trim(), p_enjeu: b.enjeu.trim(), p_date_debut: b.date_debut, p_date_fin: b.date_fin,
      p_nb_perso: b.nb_perso, p_perso_pts_temps: b.perso_pts_temps, p_perso_pts_retard: b.perso_pts_retard,
      p_max_membres: b.max_membres, p_objectifs: objs,
    });
    btn.disabled = false;
    if (error) { err.textContent = traduire(error); return; }
    E.brouillon = null; E.lobbyCharge = null;
    allerA(`#/lobby/${data}/reglages`);
  };
}

// ---------- Lobby ----------
async function ecranLobby(focus) {
  const ec = { jour: vueJour, fil: vueFil, classement: vueClassement, reglages: vueReglages }[E.onglet];
  await ec(focus);
}

function enteteLobby(sous) {
  return `<div class="entete"><div><a href="#/" class="lien" data-a="accueil">‹ Lobbies</a><h1>${esc(E.lobby.nom)}</h1><div class="sous">${sous}</div></div></div>`;
}
function texteJour() {
  const s = etatLobby(), auj = local().jourNum;
  if (s === "avant") return `Commence ${dateLongue(depuisDate(E.lobby.date_debut))}`;
  if (s === "fini") return "Terminé";
  const n = auj - depuisDate(E.lobby.date_debut) + 1, tot = depuisDate(E.lobby.date_fin) - depuisDate(E.lobby.date_debut) + 1;
  return `Jour ${n} sur ${tot} · ${dateLongue(auj)}`;
}

function ligneObjectif(o, uid, cliquable) {
  const j = jourObjectif(o), p = preuveDe(o, uid, j);
  let badge;
  if (p?.refusee) badge = `<span class="badge refus">refusée</span>`;
  else if (p?.contestee) badge = `<span class="badge conteste">contestée</span>`;
  else if (p) badge = `<span class="badge ${p.statut === "a_temps" ? "ok" : "retard"}">${p.statut === "a_temps" ? "✓" : "retard"} +${p.points}</span>`;
  else badge = cliquable ? `<button class="btn petit" data-a="preuve" data-id="${o.id}">${ICONES.photo}Preuve</button>` : `<span class="badge neutre">à faire</span>`;
  const pt = o.type === "journee" ? pts(o.pts_temps) : `${o.pts_temps} / ${o.pts_retard} pts`;
  return `<div class="objectif ${p && !p.refusee ? "fait" : ""}">
    <div class="emoji">${esc(o.emoji)}</div>
    <div class="txt"><b>${esc(o.titre)}</b><small>${esc(sousTitre(o))} · ${pt}</small></div>
    ${badge}</div>`;
}

async function vueJour() {
  const moi = E.moi.id, autres = E.membres.filter((m) => m.user_id !== moi);
  const dernieres = autres.map((m) => ({ m, p: E.preuves.find((p) => p.user_id === m.user_id && !p.refusee) }));
  await urlsPhotos(dernieres.map((d) => d.p?.photo_path));
  const sc = scores();
  const communs = E.objectifs.filter((o) => !o.owner && !o.retire_le).sort((a, b) => a.ordre - b.ordre);
  const miens = E.objectifs.filter((o) => o.owner === moi && !o.retire_le);
  const aPriere = communs.some((o) => o.type === "priere") || miens.some((o) => o.type === "priere");
  const t = local(), h = aPriere ? horairesJour(t.jourNum) : null;
  let encours = null;
  if (h) { const now = t.minutes; PRIERES.forEach((p) => { const f = fenetrePriere(p, t.jourNum); const fin = p === "isha" ? f.fin + 1440 : f.fin; if (now >= f.debut && now < fin) encours = p; }); if (!encours && t.minutes < h[0]) encours = "isha"; }
  const avant = etatLobby() === "avant", manque = E.lobby.nb_perso - miens.length;
  const aVoter = E.propositions.filter(attendMonVote).length, aAppliquer = E.propositions.filter(pretAAppliquer).length;
  const aTrancher = estAdmin() ? E.preuves.filter((p) => p.contestee) : [];
  const bandeau = (href, titre, sous) => `<a href="${href}" class="carte enjeu ligne entre" style="text-decoration:none;color:inherit"><div><b>${titre}</b><div class="doux petit">${sous}</div></div><span>›</span></a>`;

  app.innerHTML = `
  <main class="page pile-l">
    ${enteteLobby(texteJour())}
    ${avant && manque > 0 ? `<a href="#/lobby/${E.lobby.id}/reglages" class="carte enjeu ligne entre" style="text-decoration:none;color:inherit"><div><b>Choisis tes objectifs perso</b><div class="doux petit">${miens.length} sur ${E.lobby.nb_perso} · avant le ${dateCourte(E.lobby.date_debut)}</div></div><span>›</span></a>` : ""}
    ${aTrancher.length ? bandeau(`#/lobby/${E.lobby.id}/fil/preuve/${aTrancher[0].id}`, `⚖️ ${aTrancher.length} preuve${aTrancher.length > 1 ? "s" : ""} contestée${aTrancher.length > 1 ? "s" : ""}`, "Tu es l'admin : à toi de trancher") : ""}
    ${aVoter ? bandeau(`#/lobby/${E.lobby.id}/reglages`, `🗳️ ${aVoter} proposition${aVoter > 1 ? "s" : ""} à voter`, "Dans Réglages") : aAppliquer ? bandeau(`#/lobby/${E.lobby.id}/reglages`, `✅ ${aAppliquer} proposition${aAppliquer > 1 ? "s" : ""} validée${aAppliquer > 1 ? "s" : ""}`, "Tout le monde est d'accord : il reste à appliquer") : ""}
    ${autres.length ? `<div class="defile">${dernieres.map(({ m, p }) => {
      const o = p && E.objectifs.find((x) => x.id === p.objectif_id);
      return p && E.urls[p.photo_path] ? `<a class="post" href="#/lobby/${E.lobby.id}/fil/preuve/${p.id}" style="text-decoration:none;color:inherit">
        <img src="${E.urls[p.photo_path]}" alt="Dernière preuve de ${esc(m.profils?.prenom)}">
        <div class="pied"><b>${esc(m.profils?.prenom)}</b><span class="badge ${p.statut === "a_temps" ? "ok" : "retard"}">${esc(o?.emoji || "")} ${p.statut === "a_temps" ? "à temps" : "en retard"}</span></div></a>`
        : `<div class="partenaire"><div class="vide"><div><b>${esc(m.profils?.prenom)}</b><br>n'a pas encore envoyé de preuve</div></div></div>`;
    }).join("")}</div>` : `<a href="#/lobby/${E.lobby.id}/reglages" class="carte plate centre" style="text-decoration:none;color:inherit;display:block"><b>Invite tes proches</b><div class="doux petit">Code du lobby : <b>${E.lobby.code}</b></div></a>`}

    ${E.membres.length > 2 ? `<section class="carte pile">
      <div class="podium">${[...E.membres].sort((a, b) => sc[b.user_id].total - sc[a.user_id].total).map((m, i) => `
        <div class="ligne entre${m.user_id === moi ? " moi" : ""}"><span><span class="doux">${i + 1}.</span> <b>${m.user_id === moi ? "Toi" : esc(m.profils?.prenom)}</b></span><span><b class="chiffre">${pts(sc[m.user_id].total)}</b> <span class="doux petit">+${sc[m.user_id].aujourdhui} auj.</span></span></div>`).join("")}</div>
      ${E.lobby.enjeu ? `<p class="doux petit centre" style="margin:0">${esc(E.lobby.enjeu)} · ${dateCourte(E.lobby.date_fin)}</p>` : ""}
    </section>` : `<section class="carte pile">
      <div class="duel">${E.membres.slice(0, 2).map((m, i) => `
        <div class="${i ? "centre" : "centre"}"><div class="qui">${m.user_id === moi ? "Toi" : esc(m.profils?.prenom)}</div><div class="pts chiffre">${sc[m.user_id].total}</div><div class="doux petit">+${sc[m.user_id].aujourdhui} aujourd'hui</div></div>
        ${i === 0 && E.membres.length > 1 ? '<div class="vs">pts</div>' : ""}`).join("")}</div>
      ${E.lobby.enjeu ? `<p class="doux petit centre" style="margin:0">${esc(E.lobby.enjeu)} · ${dateCourte(E.lobby.date_fin)}</p>` : ""}
    </section>`}

    ${aPriere ? (h ? `<section class="pile"><h3>Prières · ${esc(E.moi.mosquee_nom || "ta position")}</h3><div class="prieres">${PRIERES.map((p) => `<div class="${p === encours ? "maintenant" : ""}"><span>${NOMS[p]}</span><b>${hhmm(h[IDX[p]])}</b></div>`).join("")}</div></section>`
      : `<a href="#/lobby/${E.lobby.id}/reglages" class="carte enjeu" style="text-decoration:none;color:inherit;display:block"><b>Choisis ta mosquée</b><div class="doux petit">Il faut les horaires de prière pour savoir si c'est à temps.</div></a>`) : ""}

    <section class="pile"><h3>Communs</h3><div class="carte" style="padding-block:4px">${communs.map((o) => ligneObjectif(o, moi, true)).join("") || '<p class="doux">Aucun</p>'}</div></section>
    ${E.lobby.nb_perso ? `<section class="pile"><h3>Mes objectifs</h3><div class="carte" style="padding-block:4px">${miens.map((o) => ligneObjectif(o, moi, true)).join("") || `<p class="doux petit">Pas encore choisis. <a href="#/lobby/${E.lobby.id}/reglages" class="lien">Les choisir</a></p>`}</div></section>` : ""}

    ${autres.map((m) => `<section class="pile"><h3>${esc(m.profils?.prenom)} aujourd'hui</h3><div class="carte"><div class="mini-suivi">${objectifsDe(m.user_id).map((o) => {
      const p = preuveDe(o, m.user_id, jourObjectif(o)); const c = p && !p.refusee ? (p.statut === "a_temps" ? "ok" : "retard") : "";
      return `<span class="${c}" title="${esc(o.titre)}">${esc(o.emoji)}</span>`; }).join("")}</div></div></section>`).join("")}
  </main>${onglets()}`;
}

// ---------- Preuves : galerie par jour ----------
const jourCourant = () => { const t = local(); return Math.floor((t.jourNum * 1440 + t.minutes - enMin(E.lobby?.fin_journee || "04:00")) / 1440); };
const TEINTES = ["vert", "or", "bleu", "prune"];
const teinte = (uid) => TEINTES[Math.max(0, E.membres.findIndex((m) => m.user_id === uid)) % TEINTES.length];
const quiEst = (uid) => (uid === E.moi.id ? "Toi" : prenomDe(uid));
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const compteDansLobby = (p) => p.jour >= E.lobby.date_debut && p.jour <= E.lobby.date_fin;
function statutDe(p) {
  if (p.refusee) return ["refus", "refusée"];
  if (p.contestee) return ["conteste", "contestée"];
  if (p.jour < E.lobby.date_debut) return ["neutre", "essai"];
  return p.statut === "a_temps" ? ["ok", "à temps"] : ["retard", "en retard"];
}
function bornesFil() {
  const auj = jourCourant();
  let debut = depuisDate(E.lobby.date_debut), fin = Math.min(auj, depuisDate(E.lobby.date_fin));
  for (const p of E.preuves) { const j = depuisDate(p.jour); if (j < debut) debut = j; if (j > fin) fin = j; }
  if (fin < debut) debut = fin = auj;
  if (E.jourFil) { const j = depuisDate(E.jourFil); debut = Math.min(debut, j); fin = Math.max(fin, j); }
  return { debut, fin, auj };
}
// Pour un membre et un jour : une case par objectif (photo ou vide), dans l'ordre des objectifs
function bilanJour(uid, jour) {
  const pr = E.preuves.filter((p) => p.user_id === uid && p.jour === jour);
  const cases = objectifsDe(uid, jour).map((o) => ({ o, p: pr.find((p) => p.objectif_id === o.id) }));
  const ok = cases.filter((c) => c.p && !c.p.refusee);
  return { cases, faits: ok.length, points: ok.reduce((s, c) => s + (compteDansLobby(c.p) ? c.p.points : 0), 0) };
}
function friseHTML() {
  const { debut, fin, auj } = bornesFil();
  const faits = {};
  for (const p of E.preuves) if (!p.refusee) faits[p.jour] = (faits[p.jour] || 0) + 1;
  const total = E.membres.reduce((s, m) => s + objectifsDe(m.user_id).length, 0) || 1;
  let h = "";
  for (let j = debut; j <= fin; j++) {
    const d = versDate(j), dt = new Date(j * 864e5);
    const js = dt.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
    const pct = Math.min(100, Math.round(((faits[d] || 0) / total) * 100));
    h += `<button class="jour-f ${d === E.jourFil ? "on" : ""}" data-j="${d}" style="--p:${pct}" title="${esc(dateLongue(j))}" aria-pressed="${d === E.jourFil}">
      <span class="js">${js}</span><span class="anneau"><b>${dt.getUTCDate()}</b></span></button>`;
  }
  return h;
}
function centrerFrise(doux) {
  const f = app.querySelector("#frise"), b = f?.querySelector(".on"); if (!b) return;
  f.scrollTo({ left: b.offsetLeft - f.clientWidth / 2 + b.offsetWidth / 2, behavior: doux ? "smooth" : "auto" });
}
function choisirJour(d) {
  const { debut, fin } = bornesFil(), j = depuisDate(d);
  if (j < debut || j > fin || d === E.jourFil) return;
  E.jourFil = d;
  app.querySelectorAll(".jour-f").forEach((b) => { const on = b.dataset.j === d; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  centrerFrise(true);
  const g = app.querySelector("#galerie"), z = app.querySelector(".frise-zone");
  if (g && z && g.getBoundingClientRect().top < z.offsetHeight) window.scrollTo({ top: window.scrollY + g.getBoundingClientRect().top - z.offsetHeight - 8, behavior: "smooth" });
  rendreGalerie();
}

async function vueFil(focus) {
  const cible = focus && E.preuves.find((p) => p.id === focus);
  if (cible) E.jourFil = cible.jour;
  if (!E.jourFil) E.jourFil = versDate(jourCourant());
  app.innerHTML = `
  <main class="page fil">
    ${enteteLobby("Les preuves, jour par jour")}
    ${bornesFil().fin > bornesFil().debut ? `<div class="frise-zone"><div class="frise" id="frise" aria-label="Choisir le jour">${friseHTML()}</div></div>` : ""}
    <div id="galerie"></div>
  </main>${onglets()}`;
  centrerFrise(false);
  app.querySelector("#frise")?.addEventListener("click", (ev) => { const b = ev.target.closest("[data-j]"); if (b) choisirJour(b.dataset.j); });
  app.querySelector("#galerie").addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-v]"); if (t) return ouvrirVisio(t.dataset.v, t);
    const n = ev.target.closest("[data-nav]"); if (n) choisirJour(versDate(depuisDate(E.jourFil) + +n.dataset.nav));
  });
  await rendreGalerie();
  if (cible && !E.visio) {
    history.replaceState(null, "", `#/lobby/${E.lobby.id}/fil`);
    ouvrirVisio(cible.id, app.querySelector(`[data-v="${cible.id}"]`));
  }
}

async function rendreGalerie() {
  const g = app.querySelector("#galerie"); if (!g) return;
  const jour = E.jourFil, jn = depuisDate(jour), { debut, fin, auj } = bornesFil();
  const essai = jour < E.lobby.date_debut;
  const ordre = [...E.membres.filter((m) => m.user_id !== E.moi.id), ...E.membres.filter((m) => m.user_id === E.moi.id)];
  const murs = ordre.map((m) => ({ m, ...bilanJour(m.user_id, jour) }));
  const photos = murs.flatMap((w) => w.cases.filter((c) => c.p).map((c) => c.p));
  await urlsPhotos(photos.map((p) => p.photo_path));
  if (E.jourFil !== jour || !g.isConnected) return;
  const anim = E.jourAnime !== jour; E.jourAnime = jour;
  E.listeVisio = photos.map((p) => p.id);
  const titre = jn === auj ? "Aujourd'hui" : jn === auj - 1 ? "Hier" : majuscule(new Date(jn * 864e5).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" }));
  const sous = new Date(jn * 864e5).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
  g.innerHTML = `
    <div class="jour-titre">
      <button class="btn rond second" data-nav="-1" ${jn <= debut ? "disabled" : ""} aria-label="Jour précédent">‹</button>
      <div><h2>${titre}</h2><div class="doux petit">${sous}${essai ? " · essai, avant le début" : ""}</div></div>
      <button class="btn rond second" data-nav="1" ${jn >= fin ? "disabled" : ""} aria-label="Jour suivant">›</button>
    </div>
    ${murs.map((w) => murHTML(w, jn, auj, essai, anim)).join("")}`;
}

function murHTML(w, jn, auj, essai, anim) {
  const uid = w.m.user_id, tot = w.cases.length, pct = tot ? Math.round((w.faits / tot) * 100) : 0;
  const a = anim ? "apparait" : "";
  return `<section class="mur t-${teinte(uid)}">
    <header class="mur-tete">
      <div class="av">${esc(initiale(prenomDe(uid)))}</div>
      <div class="txt"><b>${esc(quiEst(uid))}</b><small>${w.faits} sur ${tot}${essai ? " · essai" : ` · +${pts(w.points)}`}</small></div>
      <div class="anneau-m ${a}" style="--p:${pct}" aria-label="${pct} % fait"><span>${pct}%</span></div>
    </header>
    ${tot ? `<div class="grille-p">${w.cases.map(({ o, p }, i) => {
      if (p) {
        const [c, t] = statutDe(p), h = heureDe(p.pris_le);
        return `<button class="tuile ${a} ${p.refusee ? "refusee" : ""}" style="--i:${i}" data-v="${p.id}" aria-label="${esc(o.titre)}, ${t}, ${h}">
          <img src="${E.urls[p.photo_path] || ""}" alt="" loading="lazy" onload="this.classList.add('ok')" onerror="this.classList.add('ok')">
          <span class="tag-e">${esc(o.emoji)}</span>
          <span class="tag-h">${h}</span>
          ${p.refusee ? "" : `<span class="tag-s ${c}">${c === "ok" ? "✓ " : ""}${t}</span>`}
          ${p.refusee ? '<span class="tampon">refusée</span>' : ""}
        </button>`;
      }
      const etat = jn < auj ? (essai ? "" : "raté") : "à faire";
      return `<div class="tuile vide ${a} ${etat === "raté" ? "rate" : ""}" style="--i:${i}">
        <span class="e">${esc(o.emoji)}</span><small>${esc(o.titre)}</small>${etat ? `<em>${etat}</em>` : ""}</div>`;
    }).join("")}</div>` : '<p class="doux petit">Pas d\'objectif.</p>'}
  </section>`;
}

// ---------- Visionneuse plein écran (glisser pour défiler, vers le bas pour fermer) ----------
const sansAnim = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function ouvrirVisio(id, tuile) {
  E.visio?.fermer(true);
  const ids = (E.listeVisio || []).slice(); let i = ids.indexOf(id);
  if (i < 0) return;
  const trouve = (pid) => E.preuves.find((p) => p.id === pid);
  const ui = document.createElement("div");
  ui.className = "visio"; ui.setAttribute("role", "dialog"); ui.setAttribute("aria-modal", "true"); ui.setAttribute("aria-label", "Photos du jour");
  ui.innerHTML = `
    <div class="visio-fond"></div><div class="visio-ambiance"></div>
    <div class="visio-piste">${ids.map((pid) => { const p = trouve(pid); return `<figure class="visio-diapo"><img src="${E.urls[p?.photo_path] || ""}" alt="" draggable="false"></figure>`; }).join("")}</div>
    <div class="visio-haut">
      <div class="visio-barres">${ids.map(() => "<i></i>").join("")}</div>
      <div class="ligne"><div class="av"></div><div class="txt"><b></b><small></small></div><span class="visio-compte chiffre"></span><button class="cercle" data-x="fermer" aria-label="Fermer">${ICONES.fermer}</button></div>
    </div>
    <button class="visio-nav prec" data-x="prec" aria-label="Photo précédente">‹</button>
    <button class="visio-nav suiv" data-x="suiv" aria-label="Photo suivante">›</button>
    <div class="visio-bas"></div>`;
  document.body.appendChild(ui);
  document.documentElement.classList.add("fige");
  const piste = ui.querySelector(".visio-piste"), imgs = [...ui.querySelectorAll(".visio-diapo img")];
  const fond = ui.querySelector(".visio-fond"), amb = ui.querySelector(".visio-ambiance");
  const larg = () => piste.clientWidth || 1;
  piste.scrollLeft = i * larg();

  const maj = () => {
    const p = trouve(ids[i]); if (!p) return;
    const o = E.objectifs.find((x) => x.id === p.objectif_id), [c, t] = statutDe(p), moi = p.user_id === E.moi.id;
    const av = ui.querySelector(".visio-haut .av");
    av.className = `av t-${teinte(p.user_id)}`; av.textContent = initiale(prenomDe(p.user_id));
    ui.querySelector(".visio-haut b").textContent = quiEst(p.user_id);
    ui.querySelector(".visio-haut small").textContent = `${o?.emoji || ""} ${o?.titre || ""}`;
    ui.querySelector(".visio-compte").textContent = `${i + 1}/${ids.length}`;
    ui.querySelectorAll(".visio-barres i").forEach((b, k) => { b.className = k === i ? "on" : k < i ? "vu" : ""; });
    amb.style.backgroundImage = E.urls[p.photo_path] ? `url("${E.urls[p.photo_path]}")` : "";
    ui.querySelector(".visio-nav.prec").disabled = i === 0;
    ui.querySelector(".visio-nav.suiv").disabled = i === ids.length - 1;
    ui.querySelector(".visio-bas").innerHTML = `
      <div class="visio-heure">${heureDe(p.pris_le)}</div>
      <div class="doux-b">${esc(majuscule(dateLongue(depuisDate(p.jour))))}</div>
      <div class="ligne">
        <span class="badge ${c}">${t}${!p.refusee && compteDansLobby(p) ? ` · +${pts(p.points)}` : ""}</span>
        <span style="flex:1"></span>
        ${!moi && !p.refusee && !p.contestee ? `<button class="btn petit danger" data-a="contester" data-id="${p.id}">${estAdmin() ? "Refuser" : "Contester"}</button>` : ""}
        ${p.contestee && estAdmin() ? `<button class="btn petit second" data-a="trancher" data-r="0" data-id="${p.id}">Valider</button><button class="btn petit danger" data-a="trancher" data-r="1" data-id="${p.id}">Refuser</button>` : ""}
        ${p.refusee && estAdmin() ? `<button class="btn petit second" data-a="trancher" data-r="0" data-id="${p.id}">Annuler le refus</button>` : ""}
      </div>
      ${p.refusee ? `<p class="visio-motif">Refusée par ${esc(quiEst(p.refusee_par))}${p.motif ? ` : « ${esc(p.motif)} »` : ""}</p>` : ""}
      ${p.contestee ? `<p class="visio-motif">Contestée par ${esc(quiEst(p.contestee_par))}${p.motif ? ` : « ${esc(p.motif)} »` : ""} · ${estAdmin() ? "à toi de trancher" : `${esc(quiEst(E.lobby.admin))} (admin) va trancher`}</p>` : ""}`;
  };
  const aller = (n) => { n = Math.max(0, Math.min(ids.length - 1, n)); piste.scrollTo({ left: n * larg(), behavior: sansAnim() ? "auto" : "smooth" }); };
  piste.addEventListener("scroll", () => { const n = Math.round(piste.scrollLeft / larg()); if (n !== i && n >= 0 && n < ids.length) { i = n; maj(); } }, { passive: true });

  // Animation « la vignette grandit » (FLIP)
  const versTuile = (img, t) => {
    const cur = img.style.transform; img.style.transform = "";
    const r = img.getBoundingClientRect(), a = t.getBoundingClientRect(); img.style.transform = cur;
    const s = a.width / r.width;
    return { transform: `translate(${a.left + a.width / 2 - (r.left + r.width / 2)}px, ${a.top + a.height / 2 - (r.top + r.height / 2)}px) scale(${s})`, borderRadius: `${14 / s}px` };
  };
  if (tuile && !sansAnim()) imgs[i].animate([versTuile(imgs[i], tuile), { transform: "none", borderRadius: "18px" }], { duration: 380, easing: "cubic-bezier(.2,.85,.25,1)" });

  const clavier = (ev) => {
    if (ev.key === "Escape") fermer();
    if (ev.key === "ArrowRight") aller(i + 1);
    if (ev.key === "ArrowLeft") aller(i - 1);
  };
  document.addEventListener("keydown", clavier);

  const fermer = (instant) => {
    if (E.visio !== api) return;
    E.visio = null;
    document.removeEventListener("keydown", clavier);
    document.documentElement.classList.remove("fige");
    if (instant === true || sansAnim()) return ui.remove();
    ui.classList.add("sort");
    const t = document.querySelector(`.tuile[data-v="${ids[i]}"]`), img = imgs[i];
    if (t) {
      t.scrollIntoView({ block: "nearest" });
      img.animate([{ transform: img.style.transform || "none", borderRadius: "18px" }, versTuile(img, t)], { duration: 300, easing: "cubic-bezier(.3,.7,.2,1)", fill: "forwards" })
        .finished.then(() => ui.remove(), () => ui.remove());
    } else ui.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).finished.then(() => ui.remove(), () => ui.remove());
  };

  // Glisser vers le bas pour fermer
  let y0 = null, x0 = 0, dy = 0, vertical = null;
  piste.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) { y0 = null; return; } y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; vertical = null; }, { passive: true });
  piste.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    const ddy = e.touches[0].clientY - y0, ddx = e.touches[0].clientX - x0;
    if (vertical === null && Math.hypot(ddx, ddy) > 8) vertical = Math.abs(ddy) > Math.abs(ddx);
    if (!vertical) return;
    dy = Math.max(0, ddy);
    imgs[i].style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 400) / 1400})`;
    const o = String(Math.max(0, 1 - dy / 380));
    fond.style.opacity = o; amb.style.opacity = o; ui.style.setProperty("--chrome", o);
  }, { passive: true });
  piste.addEventListener("touchend", () => {
    if (vertical && dy > 110) fermer();
    else if (vertical) {
      const img = imgs[i]; img.style.transition = "transform .25s"; img.style.transform = "";
      fond.style.opacity = amb.style.opacity = ""; ui.style.removeProperty("--chrome");
      setTimeout(() => { img.style.transition = ""; }, 260);
    }
    y0 = null; vertical = null;
  });

  ui.addEventListener("click", (ev) => {
    const x = ev.target.closest("[data-x]")?.dataset.x;
    if (x === "fermer") fermer();
    if (x === "prec") aller(i - 1);
    if (x === "suiv") aller(i + 1);
  });

  const api = { fermer, maj };
  E.visio = api;
  maj();
  ui.querySelector("[data-x=fermer]").focus({ preventScroll: true });
}

async function vueClassement() {
  const sc = scores(), s = etatLobby();
  const rang = [...E.membres].sort((a, b) => sc[b.user_id].total - sc[a.user_id].total);
  const max = Math.max(1, ...rang.map((m) => sc[m.user_id].total));
  const fin = depuisDate(E.lobby.date_fin), auj = local().jourNum, reste = fin - auj;
  const dernier = rang[rang.length - 1], premier = rang[0];
  const egalite = rang.length > 1 && sc[premier.user_id].total === sc[dernier.user_id].total;
  const jours = []; for (let j = Math.min(auj, fin); j >= Math.max(depuisDate(E.lobby.date_debut), Math.min(auj, fin) - 6); j--) jours.push(versDate(j));
  let phrase = "";
  if (rang.length > 1) {
    const ecart = sc[premier.user_id].total - sc[rang[1].user_id].total;
    phrase = egalite ? "Égalité parfaite" : s === "fini" ? `${esc(dernier.profils?.prenom)} paie 😄` : `${premier.user_id === E.moi.id ? "Tu mènes" : esc(premier.profils?.prenom) + " mène"} de ${pts(ecart)}`;
  }
  app.innerHTML = `
  <main class="page pile-l">
    ${enteteLobby(texteJour())}
    <section class="carte enjeu pile">
      <h3>Enjeu</h3>
      <h2>${esc(E.lobby.enjeu || "Pas d'enjeu")}</h2>
      <div class="doux petit">${s === "fini" ? "Terminé le " : "Verdict le "}${dateLongue(fin)}${s !== "fini" ? ` · J-${Math.max(0, reste)}` : ""}</div>
      ${phrase ? `<b>${phrase}</b>` : ""}
    </section>
    <section class="carte pile">
      ${rang.map((m, i) => `<div class="pile" style="margin-top:${i ? 14 : 0}px">
        <div class="ligne entre"><b>${i + 1}. ${m.user_id === E.moi.id ? "Toi" : esc(m.profils?.prenom)}</b><b class="chiffre">${pts(sc[m.user_id].total)}</b></div>
        <div class="barre"><i style="width:${(sc[m.user_id].total / max) * 100}%"></i></div></div>`).join("")}
    </section>
    ${jours.length ? `<section class="pile"><h3>7 derniers jours</h3><div class="carte" style="overflow-x:auto"><table class="tableau">
      <thead><tr><th>Jour</th>${E.membres.map((m) => `<th>${m.user_id === E.moi.id ? "Toi" : esc(m.profils?.prenom)}</th>`).join("")}</tr></thead>
      <tbody>${jours.map((j) => `<tr><td>${dateCourte(j)}</td>${E.membres.map((m) => `<td>${sc[m.user_id].parJour[j] || 0}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>` : ""}
    <section class="pile"><h3>Barème</h3><div class="carte petit">${E.objectifs.filter((o) => !o.owner && !o.retire_le).map((o) => `<div class="ligne entre" style="padding:4px 0"><span>${esc(o.emoji)} ${esc(o.titre)}</span><span class="doux chiffre">${o.pts_temps} / ${o.pts_retard} / 0</span></div>`).join("")}
      ${E.lobby.nb_perso ? `<div class="sep"></div><div class="ligne entre" style="padding:4px 0"><span>🎯 Objectifs perso (×${E.lobby.nb_perso})</span><span class="doux chiffre">${E.lobby.perso_pts_temps} / ${E.lobby.perso_pts_retard} / 0</span></div>` : ""}
      <p class="doux" style="margin:8px 0 0">à temps / en retard / pas fait</p></div></section>
  </main>${onglets()}`;
}

async function vueReglages() {
  const miens = E.objectifs.filter((o) => o.owner === E.moi.id && !o.retire_le), avant = etatLobby() === "avant";
  const communs = E.objectifs.filter((o) => !o.owner && !o.retire_le).sort((a, b) => a.ordre - b.ordre);
  const lien = `${location.origin}${location.pathname}#/rejoindre/${E.lobby.code}`;
  const sous = E.sousR || "objectifs", base = `#/lobby/${E.lobby.id}/reglages`;
  const clePerso = "perso-" + E.lobby.id, cleChg = "chg-" + E.lobby.id, cleRegles = "regles-" + E.lobby.id;
  const ouvert = (cle) => (E.edition?.cle === cle || E.ed[cle]?.description || E.ed[cle]?.demande || E.ed[cle]?.objectif && E.ed[cle]?.parClaude ? "open" : "");
  const directOk = (o) => E.edition?.cle !== clePerso && avant && miens.length < E.lobby.nb_perso && o.pts_temps === E.lobby.perso_pts_temps && (o.type === "journee" || o.pts_retard === E.lobby.perso_pts_retard);
  E.edOpts[clePerso] = {
    perso: true, lobbyId: E.lobby.id, pts: E.lobby.perso_pts_temps,
    bouton: (o) => (E.edition?.cle === clePerso ? "Mettre à jour la proposition" : directOk(o) ? "Ajouter à mes objectifs" : "Proposer au vote du lobby"),
    action: async (d) => {
      const o = d.objectif;
      if (E.edition?.cle === clePerso) { await modifierProposition(E.edition.id, d.description, o); toast("Proposition mise à jour, on revote 🗳️"); }
      else if (directOk(o)) {
        const { error } = await sb.rpc("ajouter_objectif_perso", { p_lobby: E.lobby.id, p_titre: o.titre.trim(), p_emoji: o.emoji, p_type: o.type, p_priere: o.priere || "", p_heure_debut: o.heure_debut || "", p_heure_fin: o.heure_fin || "" });
        if (error) throw error;
        await rechargerObjectifs(); toast("Objectif ajouté");
      } else { await proposer("objectif_perso", d.description, o); toast(E.membres.length > 1 ? "Proposé au vote du lobby 🗳️" : "Proposé : tu es seul, applique-le en haut"); }
      viderEd(clePerso); rendre();
    },
  };
  for (const [cle, portee] of [[cleChg, "objectifs"], [cleRegles, "regles"]]) E.edOpts[cle] = {
    mode: "changement", portee, lobbyId: E.lobby.id,
    exemple: portee === "objectifs" ? "ex. passer le réveil à 6h30 pour tout le monde, ajouter 10 min de Coran" : "ex. finir le 31 décembre, enjeu : le perdant paie le resto",
    action: async (d) => {
      const contenu = { ...d.resultat, portee };
      if (E.edition?.cle === cle) { await modifierProposition(E.edition.id, d.demande, contenu); toast("Proposition mise à jour, on revote 🗳️"); }
      else { await proposer("changement", d.demande, contenu); toast("Proposé au vote 🗳️"); }
      viderEd(cle); rendre();
    },
  };
  const ligneO = (o, retirer) => `<div class="objectif"><div class="emoji">${esc(o.emoji)}</div><div class="txt"><b>${esc(o.titre)}</b><small>${esc(sousTitre(o))} · ${ptsDe(o)}</small></div>${retirer ? `<button class="btn petit second" data-a="suppr-perso" data-id="${o.id}">Retirer</button>` : ""}</div>`;
  const seg = [["objectifs", "Objectifs"], ["lobby", "Lobby"], ["moi", "Moi"]];

  let corps = "";
  if (sous === "objectifs") {
    const triche = E.triche ? await sectionTriche().catch(() => "") : "";
    corps = `
    <section class="pile" id="ed-perso"><h3>Mes objectifs perso${E.lobby.nb_perso ? ` · ${miens.length}/${E.lobby.nb_perso}` : ""}</h3>
      <div class="carte pile">
        <p class="doux petit" style="margin:0">Rien que pour toi : seul toi dois les faire.</p>
        <div>${miens.map((o) => ligneO(o, avant)).join("") || '<p class="doux petit" style="margin:0">Aucun pour l\'instant.</p>'}</div>
        <details class="ajout" ${ouvert(clePerso)}><summary class="btn second">＋ Ajouter un objectif perso</summary>
          <p class="doux petit">${avant && miens.length < E.lobby.nb_perso ? `Avec les points par défaut (${E.lobby.perso_pts_temps} à temps, ${E.lobby.perso_pts_retard} en retard), il s'ajoute tout de suite. Avec d'autres points, les autres membres votent.` : "Les autres membres votent sur ton objectif et ses points avant qu'il compte."}</p>
          ${editeurHTML(clePerso)}</details>
      </div>
    </section>
    <section class="pile" id="ed-chg"><h3>Objectifs communs</h3>
      <div class="carte pile">
        <p class="doux petit" style="margin:0">Pour tout le monde : chaque membre doit les faire.</p>
        <div>${communs.map((o) => ligneO(o, false)).join("") || '<p class="doux petit" style="margin:0">Aucun.</p>'}</div>
        <details class="ajout" ${ouvert(cleChg)}><summary class="btn second">✏️ Modifier les objectifs communs</summary>
          <p class="doux petit">Ajouter, changer ou retirer un objectif commun. Claude prépare le changement, tout le monde vote, puis on l'applique.</p>
          ${editeurHTML(cleChg)}</details>
      </div>
    </section>
    ${triche}`;
  } else if (sous === "lobby") {
    corps = `
    ${E.membres.length < E.lobby.max_membres ? `<section class="carte pile centre">
      <h3>Inviter</h3><div class="code">${E.lobby.code}</div>
      <button class="btn" data-a="partager" data-lien="${esc(lien)}">Envoyer le lien d'invitation</button>
    </section>` : ""}
    <section class="pile"><h3>Membres</h3><div class="carte">${E.membres.map((m) => `<div class="ligne" style="padding:6px 0"><div class="av" style="width:32px;height:32px;border-radius:50%;background:var(--vert-clair);color:var(--vert);display:grid;place-items:center;font-weight:700">${esc(initiale(m.profils?.prenom))}</div><b>${esc(m.profils?.prenom)}</b>${m.user_id === E.lobby.admin ? '<span class="chip">admin</span>' : ""}<span style="flex:1"></span>${m.user_id !== E.lobby.admin && E.membres.length > 1 && !E.propositions.some((x) => x.type === "admin" && x.contenu?.user_id === m.user_id) ? `<button class="lien petit" data-a="propose-admin" data-id="${m.user_id}">Proposer admin</button>` : ""}</div>`).join("")}
      <p class="doux petit" style="margin:6px 0 0">L'admin tranche quand une preuve est contestée. Changer d'admin passe par un vote de tout le lobby.</p></div></section>
    <section class="pile" id="ed-regles"><h3>Règles du lobby</h3><div class="carte pile">
      <div class="petit pile">
        <div>📅 Du <b>${dateCourte(E.lobby.date_debut)}</b> au <b>${dateCourte(E.lobby.date_fin)}</b> · ${E.lobby.max_membres} personnes max</div>
        <div>🏆 Enjeu : <b>${esc(E.lobby.enjeu || "aucun")}</b></div>
        <div>🎯 ${E.lobby.nb_perso} objectif${E.lobby.nb_perso > 1 ? "s" : ""} perso chacun · ${E.lobby.perso_pts_temps} pts à temps, ${E.lobby.perso_pts_retard} en retard par défaut</div>
        <div>🌙 La journée se termine à ${E.lobby.fin_journee.slice(0, 5)} (une photo à 1h du matin compte pour la veille)</div>
        <div>📸 Chaque preuve est une photo prise dans l'appli, l'heure vient du serveur. Une preuve contestée est tranchée par l'admin (${esc(quiEst(E.lobby.admin))}) ; refusée, elle passe à 0.</div>
        <div>🗳️ Tout changement (objectifs, points, règles, admin) doit être accepté par tous les autres membres.</div>
      </div>
      <details class="ajout" ${ouvert(cleRegles)}><summary class="btn second">✏️ Proposer un changement des règles</summary>
        <p class="doux petit">Dates, enjeu, nombre d'objectifs perso, points par défaut, fin de journée.</p>
        ${editeurHTML(cleRegles)}</details>
    </div></section>
    <button class="btn danger" data-a="quitter">Quitter ce lobby</button>`;
  } else {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), installe = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const pushOk = "PushManager" in window && "serviceWorker" in navigator, perm = "Notification" in window ? Notification.permission : "absent";
    let abonne = false;
    try { const reg = await navigator.serviceWorker?.getRegistration(); abonne = !!(await reg?.pushManager?.getSubscription()); } catch {}
    corps = `
    <section class="pile"><h3>Mon prénom</h3><div class="carte"><div class="ligne"><input id="prenom" value="${esc(E.moi.prenom)}" aria-label="Mon prénom affiché"><button class="btn petit second" data-a="prenom">OK</button></div></div></section>
    <section class="pile"><h3>Mot de passe</h3><details class="carte ajout"><summary class="ligne entre"><span>Changer mon mot de passe</span><span class="doux">›</span></summary>
      <form id="f-mdp" class="pile">
        <label class="champ"><span>Mot de passe actuel</span><input name="actuel" type="password" autocomplete="current-password" required></label>
        <label class="champ"><span>Nouveau mot de passe (6 caractères min.)</span><input name="nouveau" type="password" autocomplete="new-password" minlength="6" required></label>
        <label class="champ"><span>Confirme le nouveau</span><input name="confirme" type="password" autocomplete="new-password" minlength="6" required></label>
        <p class="erreur" id="err-mdp"></p>
        <button class="btn" type="submit">Enregistrer</button>
      </form></details></section>
    <section class="pile"><h3>Ma mosquée (horaires de prière)</h3>
      <div class="carte pile">
        <div><b>${esc(E.moi.mosquee_nom || (E.moi.lat != null ? "Calcul depuis ma position" : "Pas encore choisie"))}</b>${E.moi.mosquee_url ? `<div class="doux petit">Horaires Mawaqit</div>` : ""}</div>
        <form id="mosq" class="pile">
          <label class="champ"><span>Lien Mawaqit de ta mosquée</span><input name="lien" inputmode="url" placeholder="mawaqit.net/fr/nom-de-la-mosquee" autocapitalize="none"></label>
          <p class="doux petit" style="margin:0">Dans l'appli Mawaqit : ta mosquée → Partager → Copier le lien. Ou sur mawaqit.net, cherche ta mosquée et copie l'adresse de la page.</p>
          <button class="btn second" type="submit">Utiliser cette mosquée</button>
        </form>
        <div class="sep"></div>
        <form id="adr" class="pile">
          <label class="champ"><span>Pas sur Mawaqit ? Ton adresse ou ta ville</span><input name="adresse" placeholder="ex. 12 rue de la Paix, Lyon" autocomplete="street-address"></label>
          <button class="btn second" type="submit">Calculer les horaires depuis l'adresse</button>
        </form>
      </div>
    </section>
    <section class="pile"><h3>Notifications</h3><div class="carte pile">
      ${ios && !installe ? `<p style="margin:0"><b>Installe d'abord l'appli :</b> dans Safari, bouton <b>Partager</b> ⬆️ puis <b>Sur l'écran d'accueil</b>. Ouvre Rafiq depuis l'icône, puis reviens ici.</p>`
        : !pushOk ? `<p class="doux" style="margin:0">Ce navigateur ne gère pas les notifications.</p>`
        : abonne && perm === "granted" ? `<p style="margin:0">✅ Activées sur cet appareil.</p><button class="btn second" data-a="test-push">Envoyer une notif de test</button>`
        : perm === "denied" ? `<p class="doux" style="margin:0">Notifications bloquées. Réglages de l'iPhone → Notifications → Rafiq.</p>`
        : `<p class="doux" style="margin:0">Pour savoir quand quelqu'un du lobby envoie une preuve.</p><button class="btn" data-a="activer-push">Activer les notifications</button>`}
    </div></section>
    <section class="pile"><h3>Mon compte Claude</h3><div class="carte pile">
      ${E.cleClaude ? `<p style="margin:0">✅ Connecté · <b>${esc(E.infosClaude?.modele || "claude-sonnet-5-5")}</b></p>
        <p class="doux petit" style="margin:0">${E.infosClaude?.endpoint ? `Via ${esc(E.infosClaude.endpoint)}` : "Via l'API Anthropic"}. Claude crée tes activités et prépare tes propositions.</p>
        <button class="btn second" data-a="oublier-cle">Déconnecter</button>`
        : `<p class="doux petit" style="margin:0">Pour créer une activité juste en la décrivant. Avec l'API Anthropic : <b>console.anthropic.com</b> → <b>API Keys</b> → <b>Create Key</b>. Avec un autre service compatible Anthropic, mets aussi son adresse.</p>
        <label class="champ"><span>Clé API</span><input id="cle-claude" type="password" placeholder="sk-…" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <label class="champ"><span>Adresse de l'API (vide = Anthropic)</span><input id="api-claude" inputmode="url" placeholder="https://api.anthropic.com" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <label class="champ"><span>Modèle</span><input id="modele-claude" value="claude-sonnet-5-5" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <button class="btn" data-a="connecter-cle">Connecter</button>`}
    </div></section>
    <section class="pile">
      <button class="btn second" data-a="accueil">Changer de lobby</button>
      <button class="lien" data-a="deco">Se déconnecter</button>
    </section>`;
  }

  app.innerHTML = `
  <main class="page pile-l">
    ${enteteLobby("Réglages")}
    ${E.propositions.length ? `<section class="pile" id="votes"><h3>🗳️ Votes en cours</h3>${E.propositions.map(carteProposition).join("")}</section>` : ""}
    <nav class="segments" aria-label="Rubriques des réglages">${seg.map(([k, t]) => `<a href="${base}/${k}" class="${sous === k ? "on" : ""}" ${sous === k ? 'aria-current="page"' : ""}>${t}</a>`).join("")}</nav>
    ${corps}
  </main>${onglets()}`;

  app.querySelectorAll("[data-lier]").forEach((sel) => sel.onchange = async () => {
    if (!sel.value) return;
    const { error } = await sb.rpc("lier_objectifs", { p_a: sel.dataset.lier, p_b: sel.value });
    if (error) return toast(traduire(error));
    toast("Objectifs liés 🤫"); rendre();
  });
  const mosq = app.querySelector("#mosq");
  if (mosq) mosq.onsubmit = async (ev) => {
    ev.preventDefault(); const lienM = new FormData(ev.target).get("lien"); const btn = ev.target.querySelector(".btn");
    btn.disabled = true; btn.textContent = "Recherche…";
    const r = await appelFonction("mosquee", JSON.stringify({ lien: lienM }), true);
    btn.disabled = false;
    if (r.erreur) { btn.textContent = "Utiliser cette mosquée"; return toast(r.erreur); }
    await chargerMoi(); toast("Mosquée : " + r.nom); rendre();
  };
  const adr = app.querySelector("#adr");
  if (adr) adr.onsubmit = async (ev) => {
    ev.preventDefault(); const q = String(new FormData(ev.target).get("adresse")).trim(); if (!q) return;
    try {
      const r = await fetch("https://api-adresse.data.gouv.fr/search/?limit=1&q=" + encodeURIComponent(q)).then((x) => x.json());
      const f = r.features?.[0]; if (!f) return toast("Adresse introuvable.");
      const [lon, lat] = f.geometry.coordinates;
      const { error } = await sb.from("profils").update({ lat, lon, mosquee_url: null, mosquee_nom: "Calcul · " + (f.properties.city || f.properties.label) }).eq("id", E.moi.id);
      if (error) return toast(traduire(error));
      await chargerMoi(); toast("Horaires calculés pour " + (f.properties.city || f.properties.label)); rendre();
    } catch (e) { toast(traduire(e)); }
  };
}

// ---------- Éditeur d'activité : on décrit, Claude crée, on fait des remarques, Claude refait ----------
// État gardé dans E.ed[cle] pour survivre aux rendus ; options (mode, bouton, action) dans E.edOpts[cle].
const OBJ_VIDE = (pt = 2) => ({ titre: "", emoji: "🎯", type: "journee", priere: null, heure_debut: null, heure_fin: null, pts_temps: pt, pts_retard: 0 });
const etatEd = (cle) => (E.ed[cle] ||= { description: "", objectif: null, explication: "", remarques: "", demande: "", resultat: null, parClaude: false });
const ptsDe = (o) => (o.type === "journee" ? pts(o.pts_temps) : `${o.pts_temps} / ${o.pts_retard} pts`);
const texteObj = (o) => `${o.emoji} ${o.titre} · ${sousTitre(o)} · ${ptsDe(o)}`;
const titreDe = (id) => { const o = E.objectifs.find((x) => x.id === id); return o ? `${o.emoji} ${o.titre}` : "objectif"; };
function texteOps(c) {
  const L = { nom: "nom", enjeu: "enjeu", date_fin: "fin", nb_perso: "objectifs perso par personne", perso_pts_temps: "points perso à temps", perso_pts_retard: "points perso en retard", fin_journee: "fin de journée" };
  return (c?.operations || []).map((op) => {
    if (op.op === "ajouter") return `➕ Ajouter : ${texteObj(op.objectif)}`;
    if (op.op === "modifier") return `✏️ ${titreDe(op.id)} → ${texteObj(op.objectif)}`;
    if (op.op === "retirer") return `🗑️ Retirer : ${titreDe(op.id)} (les points déjà gagnés restent)`;
    if (op.op === "lobby") return `⚙️ ${Object.entries(op.champs).map(([k, v]) => `${L[k] || k} → ${k === "date_fin" ? dateCourte(v) : v}`).join(", ")}`;
    return "";
  }).filter(Boolean);
}
function champsObjHTML(o) {
  const t = (k) => esc(o[k]?.slice?.(0, 5) || "");
  return `<div class="pile">
    <div class="ligne"><input data-o="emoji" value="${esc(o.emoji)}" style="width:56px;text-align:center;flex:none" aria-label="Emoji"><input data-o="titre" value="${esc(o.titre)}" placeholder="Nom de l'activité" aria-label="Nom"></div>
    <div class="grille-2">
      <label class="champ"><span>Quand</span><select data-o="type">
        <option value="journee" ${o.type === "journee" ? "selected" : ""}>Dans la journée</option>
        <option value="horaire" ${o.type === "horaire" ? "selected" : ""}>Avec horaire</option>
        <option value="priere" ${o.type === "priere" ? "selected" : ""}>Une prière</option></select></label>
      ${o.type === "priere" ? `<label class="champ"><span>Prière</span><select data-o="priere">${PRIERES.map((p) => `<option value="${p}" ${o.priere === p ? "selected" : ""}>${NOMS[p]}</option>`).join("")}</select></label>` : ""}
    </div>
    ${o.type === "horaire" ? `<div class="grille-2"><label class="champ"><span>Pas avant</span><input type="time" data-o="heure_debut" value="${t("heure_debut")}"></label><label class="champ"><span>À faire avant</span><input type="time" data-o="heure_fin" value="${t("heure_fin")}"></label></div>` : ""}
    <div class="grille-2">
      <label class="champ"><span>Points à temps</span><input type="number" min="0" max="20" data-o="pts_temps" value="${o.pts_temps}"></label>
      ${o.type === "journee" ? "" : `<label class="champ"><span>Points en retard</span><input type="number" min="0" max="20" data-o="pts_retard" value="${o.pts_retard}"></label>`}
    </div></div>`;
}
function editeurHTML(cle) {
  const d = etatEd(cle), op = E.edOpts[cle] || {}, occ = d.enCours ? "disabled" : "";
  const sansCle = `<p class="doux petit" style="margin:0">${op.mode === "changement" ? `Connecte ton compte Claude (<a class="lien" href="#/lobby/${E.lobby?.id}/reglages/moi">Réglages → Moi</a>) pour proposer un changement en l'écrivant simplement.` : `Connecte ton compte Claude (<a class="lien" href="#/lobby/${E.lobby?.id}/reglages/moi">Réglages → Moi</a>) pour créer une activité juste en la décrivant. En attendant, remplis les champs :`}</p>`;
  if (op.mode === "changement") {
    if (!E.cleClaude) return `<div class="pile" data-ed="${cle}">${sansCle}</div>`;
    const r = d.resultat;
    return `<div class="pile" data-ed="${cle}">
      <label class="champ"><span>Qu'est-ce que tu veux changer ?</span><textarea rows="2" data-e="demande" placeholder="${esc(op.exemple || "")}">${esc(d.demande)}</textarea></label>
      ${r ? `<div class="carte plate pile"><b>${esc(r.resume)}</b>${texteOps(r).map((t) => `<div class="petit">${esc(t)}</div>`).join("")}</div>
        <label class="champ"><span>Pas tout à fait ça ? Réexplique à Claude</span><textarea rows="2" data-e="remarques" placeholder="ex. non, garde 3 points pour le réveil">${esc(d.remarques)}</textarea></label>
        <div class="grille-2"><button type="button" class="btn second" data-e="claude" ${occ}>${d.enCours ? "Claude réfléchit…" : "✨ Refaire"}</button><button type="button" class="btn" data-e="go" ${occ}>${E.edition?.cle === cle ? "Mettre à jour" : "Proposer au vote"}</button></div>`
      : `<button type="button" class="btn second" data-e="claude" ${occ}>${d.enCours ? "Claude réfléchit…" : "✨ Préparer avec Claude"}</button>`}
      ${E.edition?.cle === cle ? `<button type="button" class="lien" data-e="stop">Annuler la modification</button>` : ""}
      <p class="erreur">${esc(d.erreur || "")}</p></div>`;
  }
  if (!E.cleClaude && !d.objectif) d.objectif = OBJ_VIDE(op.pts);
  const o = d.objectif;
  return `<div class="pile" data-ed="${cle}">
    ${E.cleClaude ? `<label class="champ"><span>Décris ton activité</span><textarea rows="2" data-e="description" placeholder="ex. lire 20 pages avant de dormir">${esc(d.description)}</textarea></label>
      ${!d.parClaude ? `<button type="button" class="btn second" data-e="claude" ${occ}>${d.enCours ? "Claude réfléchit…" : "✨ Créer avec Claude"}</button>` : ""}` : sansCle}
    ${o && d.parClaude ? `<div class="carte plate pile">
        <div class="objectif" style="border:0;padding:0"><div class="emoji">${esc(o.emoji)}</div><div class="txt"><b>${esc(o.titre)}</b><small>${esc(sousTitre(o))} · ${ptsDe(o)}</small></div></div>
        ${d.explication ? `<p class="doux petit" style="margin:0">${esc(d.explication)}</p>` : ""}
        <details><summary class="lien petit">Modifier à la main</summary>${champsObjHTML(o)}</details></div>
      <label class="champ"><span>Une remarque ? Réexplique à Claude</span><textarea rows="2" data-e="remarques" placeholder="ex. plutôt avant 23h, et 3 points">${esc(d.remarques)}</textarea></label>
      <button type="button" class="btn second" data-e="claude" ${occ}>${d.enCours ? "Claude réfléchit…" : "✨ Refaire avec Claude"}</button>` : o ? champsObjHTML(o) : ""}
    ${o && op.bouton ? `<button type="button" class="btn" data-e="go" ${occ}>${esc(op.bouton(o))}</button>` : ""}
    ${E.edition?.cle === cle ? `<button type="button" class="lien" data-e="stop">Annuler la modification</button>` : ""}
    <p class="erreur">${esc(d.erreur || "")}</p></div>`;
}
const majEd = (cle) => { const b = document.querySelector(`[data-ed="${cle}"]`); if (b) b.outerHTML = editeurHTML(cle); };
const viderEd = (cle) => { delete E.ed[cle]; if (E.edition?.cle === cle) E.edition = null; };

async function demanderClaude(cle) {
  const d = etatEd(cle), op = E.edOpts[cle] || {};
  const refaire = op.mode === "changement" ? !!d.resultat : d.parClaude;
  const corps = op.mode === "changement"
    ? { action: "changement", portee: op.portee, lobby_id: op.lobbyId, demande: d.demande, brouillon: refaire ? d.resultat : null, remarques: d.remarques }
    : { action: "activite", lobby_id: op.lobbyId || null, perso: !!op.perso, description: d.description, brouillon: refaire ? d.objectif : null, remarques: d.remarques };
  if (op.mode === "changement" ? !d.demande.trim() : !d.description.trim()) { d.erreur = op.mode === "changement" ? "Écris ce que tu veux changer." : "Décris ton activité."; return majEd(cle); }
  d.enCours = true; d.erreur = ""; majEd(cle);
  const r = await appelFonction("claude", JSON.stringify(corps), true);
  d.enCours = false;
  if (r.erreur) { d.erreur = r.erreur; if (r.sans_cle) { E.cleClaude = false; } return majEd(cle); }
  if (op.mode === "changement") d.resultat = { resume: r.resume, operations: r.operations };
  else { d.objectif = r.objectif; d.explication = r.explication; d.parClaude = true; }
  d.remarques = "";
  majEd(cle);
}
document.addEventListener("input", (ev) => {
  const box = ev.target.closest("[data-ed]"); if (!box) return;
  const d = etatEd(box.dataset.ed), t = ev.target;
  if (t.dataset.e) d[t.dataset.e] = t.value;
  if (t.dataset.o && d.objectif) d.objectif[t.dataset.o] = t.type === "number" ? +t.value : t.value || null;
});
document.addEventListener("change", (ev) => {
  const box = ev.target.closest("[data-ed]"); if (!box || !ev.target.dataset.o) return;
  const d = etatEd(box.dataset.ed), o = d.objectif; if (!o) return;
  if (o.type === "priere" && !o.priere) o.priere = "fajr";
  if (o.type !== "horaire") { o.heure_debut = null; o.heure_fin = null; }
  if (o.type === "horaire" && !o.heure_debut && !o.heure_fin) o.heure_fin = "12:00";
  if (o.type === "journee") o.pts_retard = 0;
  const ouvert = box.querySelector("details")?.open;
  majEd(box.dataset.ed);
  if (ouvert) document.querySelector(`[data-ed="${box.dataset.ed}"] details`)?.setAttribute("open", "");
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("[data-ed] input")) ev.preventDefault(); });
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-ed] [data-e]"); if (!b || b.tagName === "TEXTAREA") return;
  const cle = b.closest("[data-ed]").dataset.ed, d = etatEd(cle), op = E.edOpts[cle] || {};
  if (b.dataset.e === "claude") return demanderClaude(cle);
  if (b.dataset.e === "stop") { viderEd(cle); return rendre(); }
  if (b.dataset.e === "go" && op.action) {
    const o = d.objectif;
    if (o && !String(o.titre || "").trim()) { d.erreur = "Donne un nom à l'activité."; return majEd(cle); }
    if (o?.type === "horaire" && !o.heure_debut && !o.heure_fin) { d.erreur = "Mets au moins une heure."; return majEd(cle); }
    b.disabled = true;
    try { await op.action(d); } catch (e) { d.erreur = traduire(e); b.disabled = false; majEd(cle); }
  }
});

// ---------- Propositions soumises au vote ----------
const votantsDe = (pr) => E.membres.filter((m) => m.user_id !== pr.auteur);
const voteDe = (pr, uid) => E.votes.find((v) => v.proposition_id === pr.id && v.user_id === uid);
const pretAAppliquer = (pr) => votantsDe(pr).every((m) => voteDe(pr, m.user_id)?.accord === true);
const attendMonVote = (pr) => pr.auteur !== E.moi.id && !voteDe(pr, E.moi.id);
async function proposer(type, texte, contenu) {
  const { data, error } = await sb.rpc("proposer", { p_lobby: E.lobby.id, p_type: type, p_texte: texte || "", p_contenu: contenu });
  if (error) throw error;
  const fd = new FormData(); fd.append("action", "proposition"); fd.append("proposition_id", data); appelFonction("preuve", fd, false);
  await chargerPropositions(E.lobby.id);
  return data;
}
async function modifierProposition(id, texte, contenu) {
  const { error } = await sb.rpc("modifier_proposition", { p_id: id, p_texte: texte || "", p_contenu: contenu });
  if (error) throw error;
  const fd = new FormData(); fd.append("action", "proposition"); fd.append("proposition_id", id); appelFonction("preuve", fd, false);
  E.edition = null; await chargerPropositions(E.lobby.id);
}
function carteProposition(pr) {
  const auteur = quiEst(pr.auteur), c = pr.contenu || {};
  let titre, corps = "";
  if (pr.type === "admin") { titre = `${auteur === "Toi" ? "Tu proposes" : esc(auteur) + " propose"} ${esc(quiEst(c.user_id))} comme admin`; corps = `<p class="doux petit" style="margin:0">L'admin tranche les preuves contestées.</p>`; }
  else if (pr.type === "objectif_perso") {
    titre = `${auteur === "Toi" ? "Tu proposes" : esc(auteur) + " propose"} un objectif perso`;
    corps = `<div class="objectif" style="border:0;padding:0"><div class="emoji">${esc(c.emoji)}</div><div class="txt"><b>${esc(c.titre)}</b><small>${esc(sousTitre(c))}</small></div></div>
      <p class="doux petit" style="margin:0">Pondération proposée : <b>${ptsDe(c)}</b> (par défaut ${E.lobby.perso_pts_temps} / ${E.lobby.perso_pts_retard})</p>`;
  } else {
    titre = `${auteur === "Toi" ? "Ta proposition" : esc(auteur) + " propose"}`;
    corps = `${pr.texte ? `<p class="doux petit" style="margin:0">« ${esc(pr.texte)} »</p>` : ""}<b>${esc(c.resume || "")}</b>${texteOps(c).map((t) => `<div class="petit">${esc(t)}</div>`).join("")}`;
  }
  const votes = votantsDe(pr).map((m) => { const v = voteDe(pr, m.user_id); return `<span class="chip ${v ? (v.accord ? "v-oui" : "v-non") : ""}">${v ? (v.accord ? "✓" : "✗") : "…"} ${esc(quiEst(m.user_id))}</span>`; }).join(" ");
  const monVote = voteDe(pr, E.moi.id), pret = pretAAppliquer(pr), moiAuteur = pr.auteur === E.moi.id;
  return `<div class="carte pile" id="prop-${pr.id}">
    <div class="ligne entre"><b>${titre}</b><span class="chip">${pr.type === "admin" ? "admin" : pr.type === "objectif_perso" ? "objectif perso" : c.portee === "regles" ? "règles" : "objectifs communs"}</span></div>
    ${corps}
    <div class="choix">${votes}</div>
    ${!moiAuteur ? `<div class="grille-2"><button class="btn petit ${monVote?.accord === true ? "" : "second"}" data-a="voter" data-v="1" data-id="${pr.id}">D'accord</button><button class="btn petit ${monVote?.accord === false ? "danger" : "second"}" data-a="voter" data-v="0" data-id="${pr.id}">Pas d'accord</button></div>` : ""}
    <button class="btn" data-a="appliquer" data-id="${pr.id}" ${pret ? "" : "disabled"}>${pret ? "Appliquer" : "Appliquer · en attente des votes"}</button>
    ${moiAuteur ? `<div class="ligne">${pr.type !== "admin" ? `<button class="lien" data-a="modif-prop" data-id="${pr.id}">Modifier</button>` : ""}<span style="flex:1"></span><button class="lien" data-a="annuler-prop" data-id="${pr.id}" style="color:var(--rouge)">Retirer la proposition</button></div>` : ""}
  </div>`;
}

// ---------- Mode triche (visible uniquement par les comptes autorisés) ----------
async function sectionTriche() {
  await chargerLobbies();
  const autresL = E.lobbies.filter((l) => l.id !== E.lobby.id && l.date_fin >= versDate(local().jourNum));
  const [{ data: objs }, { data: liens }] = await Promise.all([
    autresL.length ? sb.from("objectifs").select("id, titre, emoji, lobby_id, owner, ordre").in("lobby_id", autresL.map((l) => l.id)).is("retire_le", null) : { data: [] },
    sb.from("liens_triche").select("objectif_id, groupe"),
  ]);
  const ailleurs = (objs || []).filter((o) => !o.owner || o.owner === E.moi.id).sort((a, b) => (!!a.owner - !!b.owner) || a.ordre - b.ordre);
  const groupeDe = Object.fromEntries((liens || []).map((l) => [l.objectif_id, l.groupe]));
  const nomL = (id) => E.lobbies.find((l) => l.id === id)?.nom || "?";
  const miens = objectifsDe(E.moi.id);
  const lignes = miens.map((o) => {
    const g = groupeDe[o.id];
    const lies = g ? ailleurs.filter((x) => groupeDe[x.id] === g) : [];
    const pris = new Set(lies.map((x) => x.lobby_id));
    const choix = autresL.filter((l) => !pris.has(l.id)).map((l) => {
      const os = ailleurs.filter((x) => x.lobby_id === l.id);
      return os.length ? `<optgroup label="${esc(l.nom)}">${os.map((x) => `<option value="${x.id}">${esc(x.emoji)} ${esc(x.titre)}</option>`).join("")}</optgroup>` : "";
    }).join("");
    return `<div class="objectif" style="flex-wrap:wrap">
      <div class="emoji">${esc(o.emoji)}</div>
      <div class="txt"><b>${esc(o.titre)}</b>${lies.length ? `<small>${lies.map((x) => `<span class="chip">${esc(nomL(x.lobby_id))} · ${esc(x.emoji)} ${esc(x.titre)} <button class="lien" data-a="delier" data-id="${x.id}" aria-label="Délier">✕</button></span>`).join(" ")}</small>` : ""}</div>
      ${choix ? `<select data-lier="${o.id}" aria-label="Lier à un objectif d'un autre lobby" style="flex:1 1 100%;margin-top:6px"><option value="">+ Valider aussi dans…</option>${choix}</select>` : ""}
    </div>`;
  }).join("");
  return `<section class="pile"><h3>🤫 Mode triche</h3><div class="carte pile">
    <p class="doux petit" style="margin:0">Lie un objectif d'ici à un objectif d'un autre lobby : une seule photo valide les deux. Personne d'autre ne voit cette section ni tes autres lobbies.</p>
    ${autresL.length ? `<div style="padding-block:4px">${lignes || '<p class="doux petit">Aucun objectif.</p>'}</div>` : '<p class="doux petit" style="margin:0">Rejoins un autre lobby pour pouvoir lier des objectifs.</p>'}
  </div></section>`;
}

async function rechargerObjectifs() {
  const { data } = await sb.from("objectifs").select("*").eq("lobby_id", E.lobby.id).order("ordre"); E.objectifs = data || [];
}

async function appelFonction(nom, corps, estJson) {
  const { data: s } = await sb.auth.getSession();
  try {
    const r = await fetch(`${RAFIQ.url}/functions/v1/${nom}`, {
      method: "POST", body: corps,
      headers: { Authorization: `Bearer ${s.session?.access_token}`, apikey: RAFIQ.anon, ...(estJson ? { "Content-Type": "application/json" } : {}) },
    });
    return await r.json();
  } catch (e) { return { erreur: traduire(e) }; }
}

// ---------- Notifications ----------
const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
async function activerPush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Notifications refusées.");
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(RAFIQ.vapid) });
    const j = sub.toJSON();
    const { error } = await sb.from("abonnements_push").upsert({ user_id: E.moi.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
    if (error) return toast(traduire(error));
    toast("Notifications activées ✅"); rendre();
  } catch (e) { toast(traduire(e)); }
}

// ---------- Caméra + tampon ----------
let flux = null;
function arreterFlux() { flux?.getTracks().forEach((t) => t.stop()); flux = null; }

// Mode triche : objectifs des autres lobbies liés à celui-ci (validés par la même photo)
async function objectifsLies(objectif) {
  if (!E.triche) return [];
  const { data: l } = await sb.from("liens_triche").select("groupe").eq("objectif_id", objectif.id).maybeSingle();
  if (!l) return [];
  const { data } = await sb.from("liens_triche").select("objectifs(id, titre, emoji, lobby_id)").eq("groupe", l.groupe).neq("objectif_id", objectif.id);
  return (data || []).map((x) => x.objectifs).filter(Boolean);
}

async function ouvrirCamera(objectif) {
  const lies = await objectifsLies(objectif).catch(() => []);
  const ui = document.createElement("div");
  ui.className = "camera";
  let face = "environment", intervalle;
  const fermer = () => { arreterFlux(); clearInterval(intervalle); ui.remove(); };
  const vueDirect = () => {
    ui.innerHTML = `
      <div class="vue">
        <video playsinline autoplay muted></video>
        <div class="haut"><button class="cercle" data-c="fermer" aria-label="Fermer">${ICONES.fermer}</button><b>${esc(objectif.emoji)} ${esc(objectif.titre)}</b><button class="cercle" data-c="tourner" aria-label="Changer de caméra">${ICONES.tourner}</button></div>
        <div class="tampon-vif"><div class="h" id="h-vif"></div><div>${esc(dateLongue(local().jourNum))}</div></div>
      </div>
      <div class="bas"><span style="width:48px"></span><button class="declencheur" data-c="photo" aria-label="Prendre la photo"></button><span style="width:48px"></span></div>`;
    const maj = () => { const el = ui.querySelector("#h-vif"); if (el) el.textContent = hhmm(local().minutes); };
    maj(); clearInterval(intervalle); intervalle = setInterval(maj, 1000);
  };
  document.body.appendChild(ui);
  vueDirect();

  const demarrer = async () => {
    arreterFlux();
    try {
      flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: face }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      const v = ui.querySelector("video"); v.srcObject = flux; await v.play().catch(() => {});
      v.style.transform = face === "user" ? "scaleX(-1)" : "";
    } catch (e) {
      // Repli : appareil photo du système (sans galerie grâce à capture)
      ui.querySelector(".vue").innerHTML = `<div class="chargement" style="color:#fff;padding:24px;text-align:center">L'accès direct à la caméra n'est pas autorisé.<br><br><label class="btn" style="width:auto">Ouvrir l'appareil photo<input type="file" accept="image/*" capture="environment" hidden id="repli"></label></div>`;
      ui.querySelector("#repli").onchange = async (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        const img = await createImageBitmap(f); apercu(img, img.width, img.height, false);
      };
    }
  };

  const apercu = (source, w, h, miroir) => {
    const quand = new Date();
    const c = composer(source, w, h, miroir, objectif, quand);
    arreterFlux(); clearInterval(intervalle);
    ui.innerHTML = `<div class="vue"></div><div class="bas" style="gap:12px"><button class="btn second" data-c="reprendre" style="flex:1">Reprendre</button><button class="btn" data-c="envoyer" style="flex:1.4">Envoyer la preuve</button></div>`;
    c.className = "apercu"; ui.querySelector(".vue").appendChild(c);
    ui.dataset.quand = quand.toISOString(); ui._canvas = c;
    // même photo, tamponnée avec le titre de chaque objectif lié
    ui._lies = lies.map((o) => ({ id: o.id, canvas: composer(source, w, h, miroir, o, quand) }));
  };

  ui.addEventListener("click", async (ev) => {
    const a = ev.target.closest("[data-c]")?.dataset.c; if (!a) return;
    if (a === "fermer") fermer();
    if (a === "tourner") { face = face === "environment" ? "user" : "environment"; demarrer(); }
    if (a === "photo") { const v = ui.querySelector("video"); if (v?.videoWidth) apercu(v, v.videoWidth, v.videoHeight, face === "user"); }
    if (a === "reprendre") { vueDirect(); demarrer(); }
    if (a === "envoyer") {
      const btn = ev.target.closest(".btn"); btn.disabled = true; btn.textContent = "Envoi…";
      const blob = await new Promise((r) => ui._canvas.toBlob(r, "image/jpeg", 0.82));
      const fd = new FormData();
      fd.append("objectif_id", objectif.id); fd.append("pris_client", ui.dataset.quand); fd.append("photo", blob, "preuve.jpg");
      for (const l of ui._lies || []) fd.append("photo_" + l.id, await new Promise((r) => l.canvas.toBlob(r, "image/jpeg", 0.82)), "preuve.jpg");
      const r = await appelFonction("preuve", fd, false);
      if (r.erreur) { btn.disabled = false; btn.textContent = "Réessayer"; return toast(r.erreur); }
      E.preuves.unshift(r.preuve);
      fermer();
      const essai = r.preuve.jour < E.lobby.date_debut ? " (essai : le lobby n'a pas commencé)" : "";
      const ailleurs = r.liees ? ` · 🤫 validé aussi dans ${r.liees} autre${r.liees > 1 ? "s" : ""} lobby` : "";
      toast((r.preuve.statut === "a_temps" ? `✅ À temps ! +${pts(r.preuve.points)}` : `⏳ En retard, +${pts(r.preuve.points)}`) + essai + ailleurs);
      rendre();
    }
  });
  demarrer();
}

// Recadre en 4:5, max 1080 px de large, et incruste date/heure/objectif façon Snapchat
function composer(source, w, h, miroir, objectif, quand) {
  const ratio = 4 / 5;
  let sw = w, sh = h;
  if (w / h > ratio) sw = h * ratio; else sh = w / ratio;
  const sx = (w - sw) / 2, sy = (h - sh) / 2;
  const W = Math.min(1080, Math.round(sw)), H = Math.round(W / ratio);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.save();
  if (miroir) { g.translate(W, 0); g.scale(-1, 1); }
  g.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
  g.restore();
  const u = W / 100;
  const grad = g.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(0,0,0,.62)");
  g.fillStyle = grad; g.fillRect(0, H * 0.55, W, H * 0.45);
  const t = local(quand);
  g.fillStyle = "#fff"; g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = u * 1.2;
  g.textBaseline = "alphabetic";
  const police = '-apple-system, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
  g.font = `800 ${u * 19}px ${police}`;
  g.fillText(hhmm(t.minutes), u * 6, H - u * 21);
  g.font = `600 ${u * 4.6}px ${police}`;
  const d = dateLongue(t.jourNum); g.fillText(d.charAt(0).toUpperCase() + d.slice(1), u * 6.5, H - u * 14);
  g.font = `700 ${u * 4.6}px ${police}`;
  g.fillText(`${objectif.emoji} ${objectif.titre} · ${E.moi.prenom}`.slice(0, 48), u * 6.5, H - u * 7);
  // petite marque en haut à droite
  g.font = `700 ${u * 3.6}px ${police}`; g.textAlign = "right";
  g.fillStyle = "rgba(255,255,255,.92)"; g.fillText("Rafiq ✓", W - u * 5, u * 8);
  g.textAlign = "left";
  return c;
}

// ---------- Actions globales ----------
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-a]"); if (!el || el.closest("#c")) return;
  const a = el.dataset.a, id = el.dataset.id;
  if (a === "deco") { await sb.auth.signOut(); try { localStorage.removeItem("rafiq-lobby"); } catch {} allerA("#/"); }
  if (a === "accueil") { ev.preventDefault(); try { sessionStorage.setItem("rafiq-accueil", "1"); } catch {} allerA("#/"); }
  if (a === "preuve") { const o = E.objectifs.find((x) => x.id === id); if (o) ouvrirCamera(o); }
  if (a === "contester") {
    const admin = estAdmin();
    const motif = prompt(admin ? "Pourquoi refuser cette preuve ? (facultatif)" : "Pourquoi tu contestes cette preuve ? L'admin du lobby tranchera. (facultatif)");
    if (motif === null) return;
    const { error } = await sb.rpc("contester_preuve", { p_preuve: id, p_motif: motif });
    if (error) return toast(traduire(error));
    if (!admin) { const fd = new FormData(); fd.append("action", "contestation"); fd.append("preuve_id", id); appelFonction("preuve", fd, false); }
    toast(admin ? "Preuve refusée : 0 point" : "Contestation envoyée à l'admin ⚖️"); rafraichir();
  }
  if (a === "trancher") {
    const { error } = await sb.rpc("trancher_preuve", { p_preuve: id, p_refuser: el.dataset.r === "1" });
    if (error) return toast(traduire(error));
    toast(el.dataset.r === "1" ? "Preuve refusée : 0 point" : "Preuve validée ✓"); rafraichir();
  }
  if (a === "delier") { const { error } = await sb.rpc("delier_objectif", { p_objectif: id }); if (error) return toast(traduire(error)); toast("Lien retiré"); rendre(); }
  if (a === "voter") {
    const { error } = await sb.rpc("voter", { p_id: id, p_accord: el.dataset.v === "1" });
    if (error) return toast(traduire(error));
    await chargerPropositions(E.lobby.id); rendre();
  }
  if (a === "appliquer") {
    el.disabled = true;
    const { error } = await sb.rpc("appliquer_proposition", { p_id: id });
    if (error) { el.disabled = false; return toast(traduire(error)); }
    toast("Changement appliqué ✅"); await rechargerVotes(); rendre();
  }
  if (a === "annuler-prop") {
    if (!confirm("Retirer cette proposition ?")) return;
    const { error } = await sb.rpc("annuler_proposition", { p_id: id });
    if (error) return toast(traduire(error));
    if (E.edition?.id === id) viderEd(E.edition.cle);
    await chargerPropositions(E.lobby.id); rendre();
  }
  if (a === "modif-prop") {
    const pr = E.propositions.find((x) => x.id === id); if (!pr) return;
    const cle = (pr.type === "objectif_perso" ? "perso-" : pr.contenu?.portee === "regles" ? "regles-" : "chg-") + E.lobby.id;
    E.sousR = cle.startsWith("regles") ? "lobby" : "objectifs";
    E.ed[cle] = pr.type === "objectif_perso"
      ? { description: pr.texte || "", objectif: { ...pr.contenu }, explication: "", remarques: "", parClaude: E.cleClaude, demande: "", resultat: null }
      : { demande: pr.texte || "", resultat: pr.contenu, remarques: "", description: "", objectif: null, parClaude: false };
    E.edition = { cle, id };
    await rendre();
    history.replaceState(null, "", `#/lobby/${E.lobby.id}/reglages/${E.sousR}`);
    document.getElementById(cle.startsWith("perso") ? "ed-perso" : cle.startsWith("regles") ? "ed-regles" : "ed-chg")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (a === "propose-admin") {
    if (!confirm(`Proposer ${prenomDe(id)} comme admin du lobby ? Tout le monde doit être d'accord.`)) return;
    try { await proposer("admin", "", { user_id: id }); toast("Proposé au vote 🗳️"); rendre(); } catch (e) { toast(traduire(e)); }
  }
  if (a === "connecter-cle") {
    const cle = app.querySelector("#cle-claude")?.value.trim(); if (!cle) return;
    el.disabled = true; el.textContent = "Vérification…";
    const endpoint = app.querySelector("#api-claude")?.value.trim() || "", modele = app.querySelector("#modele-claude")?.value.trim() || "";
    const r = await appelFonction("claude", JSON.stringify({ action: "cle", cle, endpoint, modele }), true);
    if (r.erreur) { el.disabled = false; el.textContent = "Connecter"; return toast(r.erreur); }
    E.cleClaude = true; E.infosClaude = { endpoint: r.endpoint, modele: r.modele }; toast("Compte Claude connecté ✨"); rendre();
  }
  if (a === "oublier-cle") {
    if (!confirm("Déconnecter ton compte Claude de Rafiq ?")) return;
    await sb.rpc("oublier_cle_claude"); E.cleClaude = false; E.infosClaude = null; toast("Compte Claude déconnecté"); rendre();
  }
  if (a === "suppr-perso") { const { error } = await sb.rpc("supprimer_objectif_perso", { p_objectif: id }); if (error) return toast(traduire(error)); await rechargerObjectifs(); rendre(); }
  if (a === "partager") {
    const lien = el.dataset.lien, texte = `Rejoins mon lobby « ${E.lobby.nom} » sur Rafiq (code ${E.lobby.code})`;
    if (navigator.share) { try { await navigator.share({ title: "Rafiq", text: texte, url: lien }); } catch {} }
    else { try { await navigator.clipboard.writeText(`${texte} : ${lien}`); toast("Lien copié"); } catch { prompt("Copie ce lien :", lien); } }
  }
  if (a === "activer-push") activerPush();
  if (a === "test-push") { const fd = new FormData(); fd.append("action", "test"); const r = await appelFonction("preuve", fd, false); toast(r.erreur || (r.envoyees ? "Notif envoyée" : "Aucun appareil abonné")); }
  if (a === "prenom") {
    const v = app.querySelector("#prenom").value.trim(); if (!v) return;
    const { error } = await sb.from("profils").update({ prenom: v }).eq("id", E.moi.id);
    if (error) return toast(traduire(error));
    E.moi.prenom = v; E.lobbyCharge = null; toast("Prénom changé"); rendre();
  }
  if (a === "quitter") {
    if (!confirm("Quitter ce lobby ? Tes preuves restent visibles pour les autres.")) return;
    await sb.from("membres").delete().eq("lobby_id", E.lobby.id).eq("user_id", E.moi.id);
    try { localStorage.removeItem("rafiq-lobby"); } catch {}
    E.lobbyCharge = null; allerA("#/");
  }
});

// Changer de mot de passe : on revérifie l'actuel avant de le remplacer
document.addEventListener("submit", async (ev) => {
  if (ev.target.id !== "f-mdp") return;
  ev.preventDefault();
  const f = ev.target, err = f.querySelector("#err-mdp"), btn = f.querySelector(".btn");
  const actuel = f.actuel.value, nouveau = f.nouveau.value;
  err.textContent = "";
  if (nouveau.length < 6) { err.textContent = "Nouveau mot de passe trop court (6 caractères minimum)."; return; }
  if (nouveau !== f.confirme.value) { err.textContent = "Les deux nouveaux mots de passe ne sont pas identiques."; return; }
  if (nouveau === actuel) { err.textContent = "C'est le même que l'actuel."; return; }
  btn.disabled = true; btn.textContent = "Vérification…";
  const fin = (msg) => { btn.disabled = false; btn.textContent = "Enregistrer"; if (msg) err.textContent = msg; };
  const { error: e1 } = await sb.auth.signInWithPassword({ email: E.session.user.email, password: actuel });
  if (e1) return fin(/Invalid login/i.test(e1.message) ? "Mot de passe actuel incorrect." : traduire(e1));
  const { error: e2 } = await sb.auth.updateUser({ password: nouveau });
  if (e2) return fin(/different from the old/i.test(e2.message) ? "C'est le même que l'actuel." : traduire(e2));
  fin(); f.reset(); f.closest("details").open = false;
  toast("Mot de passe changé ✅");
});

// ---------- Démarrage ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
// (setTimeout : ne jamais appeler Supabase directement dans ce rappel, sinon blocage)
sb.auth.onAuthStateChange((evt, session) => {
  const avant = E.session?.user?.id;
  E.session = session;
  if (!session) { E.moi = null; E.lobbyCharge = null; }
  if (evt === "INITIAL_SESSION" || avant !== session?.user?.id) { E.moi = null; setTimeout(() => rendre().finally(finSplash), 0); }
});

// Écran d'ouverture : reste au moins le temps de son animation, puis s'efface
function finSplash() {
  const s = document.getElementById("splash");
  if (!s || s.dataset.fin) return;
  s.dataset.fin = "1";
  setTimeout(() => {
    document.documentElement.classList.remove("splash");
    s.classList.add("fin");
    setTimeout(() => s.remove(), 700);
  }, Math.max(0, 1600 - performance.now()));
}
setTimeout(finSplash, 5000);
