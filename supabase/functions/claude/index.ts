// Rafiq — Claude prépare les activités et les changements de lobby, avec la clé API de la personne qui demande.
// Actions : "cle" (connecter sa clé + adresse d'API + modèle), "activite" (description → objectif), "changement" (demande → opérations).
// L'adresse peut être l'API Anthropic (par défaut) ou toute API compatible avec le format Messages d'Anthropic.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODELE = "claude-sonnet-5-5"; // modèle par défaut, chacun peut en choisir un autre

// Adresse d'API fournie par la personne : https uniquement, jamais vers le réseau interne
function adresseApi(brut: unknown): string | null {
  const t = String(brut || "").trim();
  if (!t) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : "https://" + t); } catch { throw new Error("Adresse d'API invalide."); }
  if (u.protocol !== "https:") throw new Error("L'adresse d'API doit commencer par https://");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost") || h === "metadata.google.internal" ||
      /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /^(::1?|f[cd][0-9a-f]{2}:|fe80:)/.test(h) || /^\d+$/.test(h))
    throw new Error("Cette adresse d'API n'est pas autorisée.");
  // Le SDK ajoute lui-même /v1/messages : on retire ce que la personne a pu coller en trop
  const chemin = u.pathname.replace(/\/+$/, "").replace(/\/v1(\/messages)?$/, "");
  if (u.hostname === "api.anthropic.com" && !chemin) return null;
  return `${u.origin}${chemin}`;
}
type Connexion = { cle: string; endpoint: string | null; modele: string | null; bearer: boolean };
const client = (k: Connexion) => new Anthropic({
  ...(k.bearer ? { apiKey: null, authToken: k.cle } : { apiKey: k.cle }),
  ...(k.endpoint ? { baseURL: k.endpoint } : {}),
  maxRetries: 1,
});
const PRIERES = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const nul = (t: unknown) => ({ anyOf: [t, { type: "null" }] });

// Un objectif tel que l'appli le stocke
const OBJECTIF = {
  type: "object",
  additionalProperties: false,
  required: ["titre", "emoji", "type", "priere", "heure_debut", "heure_fin", "pts_temps", "pts_retard"],
  properties: {
    titre: { type: "string", description: "Court, en français, 40 caractères max" },
    emoji: { type: "string", description: "Un seul emoji" },
    type: { type: "string", enum: ["journee", "horaire", "priere"] },
    priere: nul({ type: "string", enum: PRIERES }),
    heure_debut: nul({ type: "string", description: "HH:MM" }),
    heure_fin: nul({ type: "string", description: "HH:MM" }),
    pts_temps: { type: "integer" },
    pts_retard: { type: "integer" },
  },
};
const SCHEMA_ACTIVITE = {
  type: "object",
  additionalProperties: false,
  required: ["objectif", "explication"],
  properties: {
    objectif: OBJECTIF,
    explication: { type: "string", description: "Une phrase : comment ce sera compté (quand, quelle preuve photo)" },
  },
};
const SCHEMA_CHANGEMENT = {
  type: "object",
  additionalProperties: false,
  required: ["resume", "operations"],
  properties: {
    resume: { type: "string", description: "Une ou deux phrases qui résument le changement pour les membres" },
    operations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "id", "objectif", "champs"],
        properties: {
          op: { type: "string", enum: ["ajouter", "modifier", "retirer", "lobby"] },
          id: nul({ type: "string", description: "id de l'objectif visé (modifier, retirer)" }),
          objectif: nul(OBJECTIF),
          champs: nul({
            type: "object",
            additionalProperties: false,
            required: ["nom", "enjeu", "date_fin", "nb_perso", "perso_pts_temps", "perso_pts_retard", "fin_journee"],
            properties: {
              nom: nul({ type: "string" }), enjeu: nul({ type: "string" }),
              date_fin: nul({ type: "string", description: "AAAA-MM-JJ" }), nb_perso: nul({ type: "integer" }),
              perso_pts_temps: nul({ type: "integer" }), perso_pts_retard: nul({ type: "integer" }),
              fin_journee: nul({ type: "string", description: "HH:MM" }),
            },
          }),
        },
      },
    },
  },
};

const REGLES = `Tu aides les membres de Rafiq, une appli où des amis tiennent des objectifs ensemble. Chaque objectif se prouve par une photo prise dans l'appli, l'heure vient du serveur.
Types d'objectif :
- "journee" : à faire n'importe quand dans la journée. pts_retard = 0, heure_debut et heure_fin = null.
- "horaire" : à faire entre heure_debut et heure_fin (HH:MM, 24 h). Une photo avant heure_debut est refusée ; après heure_fin elle compte « en retard » (pts_retard). Une seule des deux heures peut suffire ; pour « avant 7h » mets heure_debut 04:00 et heure_fin 07:00. Les plages qui passent minuit marchent (20:00 → 02:00).
- "priere" : une des 5 prières (priere = fajr, dhuhr, asr, maghrib ou isha), horaires donnés par la mosquée de chacun. Une seule prière par objectif. heure_debut et heure_fin = null.
La journée se termine à l'heure de fin de journée du lobby (souvent 04:00) : une photo à 1 h du matin compte pour la veille.
Points : entiers entre 0 et 20, pts_retard ≤ pts_temps. Habituellement 3 à temps / 1 en retard pour un objectif commun, 2 / 0 pour un objectif « journee » simple.
Titres courts et concrets en français, un seul emoji parlant. Réponds toujours en français, sans rien inventer que la personne n'a pas demandé.`;

const hhmm = (s: unknown) => {
  const m = /^(\d{1,2}):?(\d{2})/.exec(String(s ?? ""));
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
};
const borne = (n: unknown, def: number) => Math.max(0, Math.min(20, Number.isFinite(+n!) ? Math.round(+n!) : def));
// Remet un objectif proposé par Claude dans les règles de l'appli
function propre(o: any) {
  const type = ["journee", "horaire", "priere"].includes(o?.type) ? o.type : "journee";
  const r: any = {
    titre: String(o?.titre || "Objectif").trim().slice(0, 60),
    emoji: String(o?.emoji || "✅").trim().slice(0, 8) || "✅",
    type, priere: null, heure_debut: null, heure_fin: null,
    pts_temps: borne(o?.pts_temps, 2), pts_retard: 0,
  };
  if (type === "priere") r.priere = PRIERES.includes(o?.priere) ? o.priere : "fajr";
  if (type === "horaire") {
    r.heure_debut = hhmm(o?.heure_debut); r.heure_fin = hhmm(o?.heure_fin);
    if (!r.heure_debut && !r.heure_fin) { r.type = "journee"; }
  }
  if (r.type !== "journee") r.pts_retard = Math.min(r.pts_temps, borne(o?.pts_retard, 1));
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    const user = u?.user;
    if (!user) return json({ erreur: "Reconnecte-toi." }, 401);
    const corps = await req.json();

    // ---------- Connecter son compte : on vérifie la clé auprès d'Anthropic avant de l'enregistrer ----------
    if (corps.action === "cle") {
      const cle = String(corps.cle || "").trim();
      let endpoint: string | null;
      try { endpoint = adresseApi(corps.endpoint); } catch (e) { return json({ erreur: (e as Error).message }, 400); }
      const modele = String(corps.modele || "").trim() || MODELE;
      if (!/^[\w.:@\/-]{1,100}$/.test(modele)) return json({ erreur: "Nom de modèle invalide." }, 400);
      if (cle.length < 8) return json({ erreur: "Colle ta clé." }, 400);
      if (!endpoint && !/^sk-ant-/.test(cle)) return json({ erreur: "Ce n'est pas une clé Anthropic (elle commence par sk-ant-). Pour un autre service, remplis aussi l'adresse de l'API." }, 400);
      // Petit essai réel : vérifie la clé, l'adresse et le modèle. Clé en x-api-key, sinon en Bearer.
      const essai = (bearer: boolean) => client({ cle, endpoint, modele, bearer }).messages.create({
        model: modele, max_tokens: 64, messages: [{ role: "user", content: "Réponds juste : OK" }],
      });
      let bearer = false;
      try { await essai(false); } catch (e) {
        if (!(e instanceof Anthropic.AuthenticationError) || !endpoint) return json({ erreur: erreurClaude(e) }, 400);
        try { await essai(true); bearer = true; } catch (e2) { return json({ erreur: erreurClaude(e2) }, 400); }
      }
      const { error } = await admin.from("cles_claude").upsert({ user_id: user.id, cle, endpoint, modele, bearer, maj: new Date().toISOString() });
      if (error) return json({ erreur: error.message }, 500);
      return json({ ok: true, endpoint, modele });
    }

    const { data: k } = await admin.from("cles_claude").select("cle, endpoint, modele, bearer").eq("user_id", user.id).maybeSingle();
    if (!k) return json({ erreur: "Connecte d'abord ton compte Claude (Réglages).", sans_cle: true }, 400);
    const claude = client(k as Connexion), modele = k.modele || MODELE;

    // Contexte du lobby (seulement celui-ci, jamais les autres lobbies de la personne)
    let lobby: any = null, objectifs: any[] = [], membres: any[] = [];
    if (corps.lobby_id) {
      const { data: mb } = await admin.from("membres").select("user_id, profils(prenom)").eq("lobby_id", corps.lobby_id);
      if (!mb?.some((m: any) => m.user_id === user.id)) return json({ erreur: "Tu n'es pas dans ce lobby." }, 403);
      membres = mb;
      lobby = (await admin.from("lobbies").select("*").eq("id", corps.lobby_id).single()).data;
      objectifs = (await admin.from("objectifs").select("*").eq("lobby_id", corps.lobby_id).is("retire_le", null).order("ordre")).data || [];
    }
    const prenom = (id: string) => membres.find((m: any) => m.user_id === id)?.profils?.prenom || "?";
    const decrire = (o: any) => ({ id: o.id, pour: o.owner ? `objectif perso de ${prenom(o.owner)}` : "commun", titre: o.titre, emoji: o.emoji,
      type: o.type, priere: o.priere, heure_debut: o.heure_debut?.slice(0, 5) ?? null, heure_fin: o.heure_fin?.slice(0, 5) ?? null,
      pts_temps: o.pts_temps, pts_retard: o.pts_retard });
    const contexte = lobby ? `Lobby « ${lobby.nom} » du ${lobby.date_debut} au ${lobby.date_fin}, enjeu : ${lobby.enjeu || "aucun"}, fin de journée ${String(lobby.fin_journee).slice(0, 5)}, ` +
      `${lobby.nb_perso} objectifs perso chacun (par défaut ${lobby.perso_pts_temps} pts à temps / ${lobby.perso_pts_retard} en retard).\n` +
      `Objectifs actuels :\n${JSON.stringify(objectifs.map(decrire), null, 1)}` : "Lobby en cours de création.";
    const suite = corps.brouillon ? `\n\nTa proposition précédente :\n${JSON.stringify(corps.brouillon)}\n\nRemarques de la personne, à prendre en compte :\n${String(corps.remarques || "").slice(0, 2000)}` : "";

    const lireJson = (r: any) => {
      if (r.stop_reason === "refusal") throw new Error("Claude n'a pas voulu traiter cette demande.");
      const t = (r.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      const m = t.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Claude n'a pas répondu comme prévu, réessaie.");
      return JSON.parse(m[0]);
    };
    const demander = async (consigne: string, schema: unknown) => {
      const base = { model: modele, max_tokens: 16000, system: REGLES, messages: [{ role: "user", content: consigne }] };
      if (!k.endpoint) {
        // API Anthropic : sortie structurée garantie + repli automatique si le modèle refuse
        return lireJson(await claude.beta.messages.create({
          ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
          output_config: { effort: "low", format: { type: "json_schema", schema } },
        } as any));
      }
      // Autre adresse : on tente la sortie structurée, sinon on demande le JSON dans la consigne
      try {
        return lireJson(await claude.messages.create({ ...base, output_config: { format: { type: "json_schema", schema } } } as any));
      } catch (e) {
        if (!(e instanceof Anthropic.BadRequestError)) throw e;
        return lireJson(await claude.messages.create({
          ...base, system: `${REGLES}\n\nRéponds uniquement avec un objet JSON valide (sans texte autour) qui respecte ce schéma JSON :\n${JSON.stringify(schema)}`,
        } as any));
      }
    };

    if (corps.action === "activite") {
      const desc = String(corps.description || "").trim().slice(0, 2000);
      if (!desc && !corps.brouillon) return json({ erreur: "Décris ton activité." }, 400);
      const pour = corps.perso && lobby
        ? `C'est un objectif perso de ${prenom(user.id)}. Propose une pondération juste par rapport aux objectifs existants (par défaut ${lobby.perso_pts_temps} / ${lobby.perso_pts_retard}) : les autres membres voteront.`
        : "C'est un objectif commun pour tous les membres.";
      const r = await demander(`${contexte}\n\n${pour}\n\nCrée l'objectif décrit par la personne : « ${desc} »${suite}`, SCHEMA_ACTIVITE);
      return json({ ok: true, objectif: propre(r.objectif), explication: String(r.explication || "") });
    }

    if (corps.action === "changement") {
      if (!lobby) return json({ erreur: "Lobby manquant." }, 400);
      const demande = String(corps.demande || "").trim().slice(0, 2000);
      if (!demande) return json({ erreur: "Écris le changement que tu veux." }, 400);
      const r = await demander(`${contexte}\n\nAujourd'hui : ${new Date().toISOString().slice(0, 10)}.\n` +
        `Un membre propose ce changement pour le lobby (il sera soumis au vote de tous) : « ${demande} »\n` +
        `Traduis-le en opérations : "ajouter" (objectif commun, champ objectif), "modifier" (id + objectif complet dans sa nouvelle version), ` +
        `"retirer" (id ; les anciennes preuves gardent leurs points), "lobby" (champs du lobby à changer, null = inchangé). ` +
        `Les champs non utilisés d'une opération valent null. Ne fais que ce qui est demandé.${suite}`, SCHEMA_CHANGEMENT);
      const ids = new Set(objectifs.map((o) => o.id));
      const operations = (r.operations || []).flatMap((op: any) => {
        if (op.op === "ajouter" && op.objectif) return [{ op: "ajouter", objectif: propre(op.objectif) }];
        if (op.op === "modifier" && ids.has(op.id) && op.objectif) return [{ op: "modifier", id: op.id, objectif: propre(op.objectif) }];
        if (op.op === "retirer" && ids.has(op.id)) return [{ op: "retirer", id: op.id }];
        if (op.op === "lobby" && op.champs) {
          const c: any = {}, ch = op.champs;
          if (ch.nom) c.nom = String(ch.nom).slice(0, 60);
          if (ch.enjeu != null) c.enjeu = String(ch.enjeu).slice(0, 200);
          if (/^\d{4}-\d{2}-\d{2}$/.test(ch.date_fin || "") && ch.date_fin >= lobby.date_debut) c.date_fin = ch.date_fin;
          if (Number.isInteger(ch.nb_perso)) c.nb_perso = Math.max(0, Math.min(10, ch.nb_perso));
          if (Number.isInteger(ch.perso_pts_temps)) c.perso_pts_temps = borne(ch.perso_pts_temps, lobby.perso_pts_temps);
          if (Number.isInteger(ch.perso_pts_retard)) c.perso_pts_retard = borne(ch.perso_pts_retard, lobby.perso_pts_retard);
          if (hhmm(ch.fin_journee)) c.fin_journee = hhmm(ch.fin_journee);
          return Object.keys(c).length ? [{ op: "lobby", champs: c }] : [];
        }
        return [];
      });
      if (!operations.length) return json({ erreur: "Claude n'a pas compris quoi changer. Reformule ta demande." }, 400);
      return json({ ok: true, resume: String(r.resume || ""), operations });
    }

    return json({ erreur: "Action inconnue." }, 400);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ erreur: "Ta clé ne marche plus. Reconnecte ton compte Claude (Réglages).", sans_cle: true }, 400);
    if (e instanceof Anthropic.APIError) return json({ erreur: erreurClaude(e) }, 502);
    return json({ erreur: (e as Error).message }, 500);
  }
});

function erreurClaude(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Clé refusée par le service.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Cette clé n'a pas accès à ce modèle.";
  if (e instanceof Anthropic.NotFoundError) return "Modèle ou adresse d'API introuvable (vérifie le nom du modèle et l'adresse).";
  if (e instanceof Anthropic.RateLimitError) return "Claude est saturé ou la limite est atteinte, réessaie dans un moment.";
  if (e instanceof Anthropic.APIConnectionError) return "Impossible de joindre l'adresse d'API.";
  if (e instanceof Anthropic.APIError) {
    if ((e as any).type === "billing_error" || e.status === 402) return "Plus de crédit sur ce compte.";
    return "Claude : " + e.message;
  }
  return (e as Error)?.message || String(e);
}
