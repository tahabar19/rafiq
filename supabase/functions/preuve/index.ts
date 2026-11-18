// Rafiq — réception d'une preuve photo.
// Vérifie l'heure (serveur), calcule "à temps / en retard", range la photo, prévient les autres membres.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import * as adhan from "npm:adhan@4.4.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PRIERES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
const NOMS: Record<string, string> = { fajr: "Fajr", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" };

// ---------- Heures locales ----------
function local(date: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  const y = +p.year, m = +p.month, d = +p.day, hh = +p.hour, mm = +p.minute;
  return { y, m, d, hh, mm, jourNum: Math.round(Date.UTC(y, m - 1, d) / 864e5), minutes: hh * 60 + mm };
}
const versDate = (jourNum: number) => new Date(jourNum * 864e5).toISOString().slice(0, 10);
const enMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const hhmm = (min: number) => { const x = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

// ---------- Horaires de prière d'un jour : [fajr, chourouq, dhuhr, asr, maghrib, isha] en minutes ----------
type Profil = { mosquee_url: string | null; lat: number | null; lon: number | null; fuseau: string; prenom: string };
async function horairesJour(sb: any, profil: Profil, jourNum: number, cache: Map<string, any>): Promise<number[]> {
  const d = new Date(jourNum * 864e5);
  if (profil.mosquee_url) {
    let cal = cache.get(profil.mosquee_url);
    if (!cal) {
      const { data } = await sb.from("horaires_mosquee").select("calendrier").eq("url", profil.mosquee_url).maybeSingle();
      cal = data?.calendrier; cache.set(profil.mosquee_url, cal);
    }
    const t = cal?.[d.getUTCMonth()]?.[String(d.getUTCDate())];
    if (t?.length >= 6) return t.slice(0, 6).map(enMin);
  }
  if (profil.lat != null && profil.lon != null) {
    const params = adhan.CalculationMethod.Other();
    params.fajrAngle = 12; params.ishaAngle = 12; // UOIF (France)
    const pt = new adhan.PrayerTimes(new adhan.Coordinates(profil.lat, profil.lon),
      new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12), params);
    return [pt.fajr, pt.sunrise, pt.dhuhr, pt.asr, pt.maghrib, pt.isha].map((x: Date) => local(x, profil.fuseau).minutes);
  }
  throw new Error("Choisis d'abord ta mosquée (Réglages) pour les horaires de prière.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    const user = u?.user;
    if (!user) return json({ erreur: "Reconnecte-toi." }, 401);

    const form = await req.formData();
    const action = String(form.get("action") || "preuve");

    if (action === "test") {
      const n = await notifier(admin, [user.id], { title: "Rafiq", body: "Les notifications marchent ✅", url: "./" });
      return json({ ok: true, envoyees: n });
    }

    const objectifId = String(form.get("objectif_id") || "");
    const photo = form.get("photo");
    const prisClient = Date.parse(String(form.get("pris_client") || ""));
    const maintenant = new Date();

    if (!(photo instanceof File) || photo.size < 1000) return json({ erreur: "Photo manquante." }, 400);
    if (photo.size > 3_000_000) return json({ erreur: "Photo trop lourde." }, 400);
    if (!isFinite(prisClient) || Math.abs(prisClient - maintenant.getTime()) > 5 * 60_000)
      return json({ erreur: "L'heure de ton téléphone ne correspond pas à l'heure réelle. Remets-la en automatique." }, 400);

    const { data: obj } = await admin.from("objectifs").select("*").eq("id", objectifId).maybeSingle();
    if (!obj) return json({ erreur: "Objectif introuvable." }, 404);
    if (obj.owner && obj.owner !== user.id) return json({ erreur: "Ce n'est pas ton objectif." }, 403);
    const { data: mb } = await admin.from("membres").select("user_id").eq("lobby_id", obj.lobby_id);
    if (!mb?.some((m: any) => m.user_id === user.id)) return json({ erreur: "Tu n'es pas dans ce lobby." }, 403);
    const { data: lobby } = await admin.from("lobbies").select("*").eq("id", obj.lobby_id).single();
    const { data: profil } = await admin.from("profils").select("*").eq("id", user.id).single();

    const tz = profil.fuseau || "Europe/Paris";
    const t = local(maintenant, tz);
    const tAbs = t.jourNum * 1440 + t.minutes;

    // ---------- Statut ----------
    let jourNum: number, statut: "a_temps" | "retard", detail = "";
    const dejaFait = async (j: number) => {
      const { data } = await admin.from("preuves").select("id").eq("objectif_id", obj.id).eq("user_id", user.id).eq("jour", versDate(j)).maybeSingle();
      return !!data;
    };

    if (obj.type === "priere") {
      const i = PRIERES.indexOf(obj.priere);
      const idx = [0, 2, 3, 4, 5][i]; // position dans [fajr, chourouq, dhuhr, asr, maghrib, isha]
      const cache = new Map();
      const fenetre = async (j: number) => {
        const h = await horairesJour(admin, profil, j, cache);
        const debut = j * 1440 + h[idx];
        const fin = obj.priere === "isha" ? (j + 1) * 1440 + (await horairesJour(admin, profil, j + 1, cache))[0]
          : j * 1440 + h[idx + 1];
        return { debut, fin };
      };
      const auj = await fenetre(t.jourNum);
      if (tAbs >= auj.debut) {
        jourNum = t.jourNum;
        statut = tAbs < auj.fin ? "a_temps" : "retard";
      } else {
        jourNum = t.jourNum - 1;
        if (await dejaFait(jourNum)) return json({ erreur: `Pas encore l'heure : ${NOMS[obj.priere]} à ${hhmm(auj.debut)}.` }, 400);
        const hier = await fenetre(jourNum);
        statut = tAbs < hier.fin ? "a_temps" : "retard";
      }
      detail = NOMS[obj.priere];
    } else {
      const F = enMin(String(lobby.fin_journee).slice(0, 5));
      jourNum = Math.floor((tAbs - F) / 1440);
      const o = tAbs - F - jourNum * 1440;
      const a = obj.heure_debut ? (((enMin(obj.heure_debut) - F) % 1440) + 1440) % 1440 : 0;
      let b = obj.heure_fin ? (((enMin(obj.heure_fin) - F) % 1440) + 1440) % 1440 : 1440;
      if (b === 0) b = 1440;
      if (obj.type === "horaire" && o < a) return json({ erreur: `Trop tôt : à partir de ${obj.heure_debut.slice(0, 5)}.` }, 400);
      statut = obj.type === "journee" || o <= b ? "a_temps" : "retard";
    }

    if (await dejaFait(jourNum)) return json({ erreur: "Déjà fait pour aujourd'hui ✅" }, 400);

    // ---------- Photo + enregistrement ----------
    const id = crypto.randomUUID();
    const chemin = `${obj.lobby_id}/${user.id}/${versDate(jourNum)}_${id}.jpg`;
    const up = await admin.storage.from("preuves").upload(chemin, await photo.arrayBuffer(), { contentType: "image/jpeg" });
    if (up.error) return json({ erreur: "Envoi de la photo raté : " + up.error.message }, 500);

    const points = statut === "a_temps" ? obj.pts_temps : obj.pts_retard;
    const { data: pr, error } = await admin.from("preuves").insert({
      id, lobby_id: obj.lobby_id, objectif_id: obj.id, user_id: user.id, jour: versDate(jourNum),
      photo_path: chemin, statut, points, pris_le: maintenant.toISOString(),
    }).select().single();
    if (error) {
      await admin.storage.from("preuves").remove([chemin]);
      return json({ erreur: error.code === "23505" ? "Déjà fait pour aujourd'hui ✅" : error.message }, 400);
    }

    // ---------- Notification aux autres ----------
    const heure = `${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}`;
    const quoi = obj.type === "priere" ? `a prié ${detail}` : `${obj.emoji} ${obj.titre}`;
    const etat = statut === "a_temps" ? "✅ à temps" : "⏳ en retard";
    const autres = mb.map((m: any) => m.user_id).filter((x: string) => x !== user.id);
    await notifier(admin, autres, {
      title: `${profil.prenom} ${obj.type === "priere" ? "" : "· "}${quoi}`.replace("  ", " "),
      body: `${etat} — ${heure} · +${points} pt${points > 1 ? "s" : ""}`,
      url: `./#/lobby/${obj.lobby_id}/preuve/${id}`,
      tag: id,
    });

    return json({ ok: true, preuve: pr });
  } catch (e) {
    return json({ erreur: (e as Error).message }, 500);
  }
});

async function notifier(admin: any, userIds: string[], payload: Record<string, string>) {
  if (!userIds.length) return 0;
  const pub = Deno.env.get("VAPID_PUBLIC")!, priv = Deno.env.get("VAPID_PRIVATE")!;
  webpush.setVapidDetails("https://tahabar19.github.io/rafiq/", pub, priv);
  const { data: abos } = await admin.from("abonnements_push").select("*").in("user_id", userIds);
  let n = 0;
  await Promise.all((abos || []).map(async (a: any) => {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
        JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      n++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("abonnements_push").delete().eq("id", a.id);
      else console.error("push", e?.statusCode, e?.body);
    }
  }));
  return n;
}
