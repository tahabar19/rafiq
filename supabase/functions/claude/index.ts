// Rafiq — Claude prépare les activités et les changements de lobby, avec la clé API de la personne qui demande.
// Actions : "cle" (connecter sa clé), "activite" (description → objectif), "changement" (demande → opérations).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODELE = "claude-opus-5-5";
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
      if (!/^sk-ant-/.test(cle)) return json({ erreur: "Ce n'est pas une clé Claude (elle commence par sk-ant-)." }, 400);
      try {
        await new Anthropic({ apiKey: cle, maxRetries: 1 }).models.retrieve(MODELE);
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) return json({ erreur: "Anthropic refuse cette clé." }, 400);
        if (e instanceof Anthropic.PermissionDeniedError) return json({ erreur: "Cette clé n'a pas accès à Claude." }, 400);
        throw e;
      }
      const { error } = await admin.from("cles_claude").upsert({ user_id: user.id, cle, maj: new Date().toISOString() });
      if (error) return json({ erreur: error.message }, 500);
      return json({ ok: true });
    }

    const { data: k } = await admin.from("cles_claude").select("cle").eq("user_id", user.id).maybeSingle();
    if (!k) return json({ erreur: "Connecte d'abord ton compte Claude (Réglages).", sans_cle: true }, 400);
    const client = new Anthropic({ apiKey: k.cle });

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

    const demander = async (consigne: string, schema: unknown) => {
      const r: any = await client.beta.messages.create({
        model: MODELE,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        system: REGLES,
        messages: [{ role: "user", content: consigne }],
      } as any);
      if (r.stop_reason === "refusal") throw new Error("Claude n'a pas voulu traiter cette demande.");
      const t = r.content.find((b: any) => b.type === "text")?.text;
      if (!t) throw new Error("Claude n'a rien répondu, réessaie.");
      return JSON.parse(t);
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
    if (e instanceof Anthropic.AuthenticationError) return json({ erreur: "Ta clé Claude ne marche plus. Reconnecte ton compte (Réglages).", sans_cle: true }, 400);
    if (e instanceof Anthropic.RateLimitError) return json({ erreur: "Claude est saturé, réessaie dans un moment." }, 429);
    if (e instanceof Anthropic.APIConnectionError) return json({ erreur: "Impossible de joindre Claude, réessaie." }, 502);
    if (e instanceof Anthropic.APIError) {
      if ((e as any).type === "billing_error" || e.status === 402) return json({ erreur: "Plus de crédit sur ton compte Claude (console.anthropic.com → Billing)." }, 402);
      return json({ erreur: "Claude : " + e.message }, 502);
    }
    return json({ erreur: (e as Error).message }, 500);
  }
});
