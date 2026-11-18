// Rafiq — relie un profil à une mosquée Mawaqit (lien de la page publique de la mosquée).
// Récupère le calendrier annuel des horaires et le garde en cache.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ erreur: "Reconnecte-toi." }, 401);

    const { lien } = await req.json();
    let slug = String(lien || "").trim();
    const m = slug.match(/mawaqit\.net\/(?:[a-z]{2}\/)?(?:m\/)?([a-z0-9-]+)/i);
    if (m) slug = m[1];
    if (!/^[a-z0-9-]{3,120}$/i.test(slug)) return json({ erreur: "Colle le lien de la page Mawaqit de ta mosquée." }, 400);
    const pageUrl = `https://mawaqit.net/fr/${slug.toLowerCase()}`;

    const r = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 (Rafiq)" } });
    if (!r.ok) return json({ erreur: "Mosquée introuvable sur Mawaqit." }, 404);
    const html = await r.text();
    const mc = html.match(/confData\s*=\s*(\{.*?\});\s*\n/s);
    if (!mc) return json({ erreur: "Impossible de lire les horaires de cette mosquée." }, 502);
    const conf = JSON.parse(mc[1]);
    const cal = conf.calendar;
    if (!Array.isArray(cal) || cal.length !== 12) return json({ erreur: "Cette mosquée n'a pas de calendrier annuel." }, 502);

    const nom = conf.name || slug;
    await admin.from("horaires_mosquee").upsert({ url: pageUrl, nom, fuseau: conf.timezone || "Europe/Paris", calendrier: cal, maj: new Date().toISOString() });
    await admin.from("profils").update({
      mosquee_url: pageUrl, mosquee_nom: nom,
      lat: conf.latitude ?? null, lon: conf.longitude ?? null,
      fuseau: conf.timezone || "Europe/Paris",
    }).eq("id", u.user.id);

    return json({ ok: true, nom, url: pageUrl });
  } catch (e) {
    return json({ erreur: (e as Error).message }, 500);
  }
});
