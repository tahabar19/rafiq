-- Rafiq : schéma de la base (Supabase / Postgres)
-- Rejouable : tout est en "if not exists" / "or replace".

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists public.profils (
  id uuid primary key references auth.users(id) on delete cascade,
  pseudo text unique not null,
  prenom text not null,
  mosquee_url text,
  mosquee_nom text,
  lat double precision,
  lon double precision,
  fuseau text not null default 'Europe/Paris',
  created_at timestamptz not null default now()
);

create table if not exists public.lobbies (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  nom text not null,
  enjeu text,
  date_debut date not null,
  date_fin date not null,
  nb_perso int not null default 3 check (nb_perso between 0 and 10),
  perso_pts_temps int not null default 2,
  perso_pts_retard int not null default 1,
  max_membres int not null default 2 check (max_membres between 2 and 10),
  fin_journee time not null default '04:00',
  createur uuid not null references public.profils(id),
  created_at timestamptz not null default now()
);

create table if not exists public.membres (
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  user_id uuid not null references public.profils(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (lobby_id, user_id)
);

-- type : 'priere' (horaires Mawaqit), 'horaire' (entre heure_debut et heure_fin), 'journee' (n'importe quand dans la journée)
create table if not exists public.objectifs (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  owner uuid references public.profils(id) on delete cascade, -- null = objectif commun
  titre text not null,
  emoji text not null default '✅',
  type text not null check (type in ('priere','horaire','journee')),
  priere text check (priere in ('fajr','dhuhr','asr','maghrib','isha')),
  heure_debut time,
  heure_fin time,
  pts_temps int not null default 3,
  pts_retard int not null default 1,
  ordre int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.preuves (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  objectif_id uuid not null references public.objectifs(id) on delete cascade,
  user_id uuid not null references public.profils(id) on delete cascade,
  jour date not null,
  photo_path text not null,
  statut text not null check (statut in ('a_temps','retard')),
  points int not null,
  pris_le timestamptz not null default now(),
  refusee boolean not null default false,
  refusee_par uuid references public.profils(id),
  motif text,
  unique (objectif_id, user_id, jour)
);
create index if not exists preuves_lobby_idx on public.preuves (lobby_id, pris_le desc);

create table if not exists public.abonnements_push (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profils(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.horaires_mosquee (
  url text primary key,
  nom text,
  fuseau text,
  calendrier jsonb not null, -- 12 mois, jour -> [fajr, chourouq, dhuhr, asr, maghrib, isha]
  maj timestamptz not null default now()
);

-- Ajouts (rejouables) : admin du lobby, objectifs retirés, preuves contestées
alter table public.lobbies add column if not exists admin uuid references public.profils(id);
update public.lobbies set admin = createur where admin is null;
alter table public.objectifs add column if not exists retire_le timestamptz; -- retiré : plus à faire, les anciennes preuves comptent toujours
alter table public.preuves add column if not exists contestee boolean not null default false;
alter table public.preuves add column if not exists contestee_par uuid references public.profils(id);

-- ---------- Fonctions utilitaires ----------

create or replace function public.est_membre(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membres where lobby_id = l and user_id = auth.uid());
$$;

create or replace function public.code_lobby() returns text
language plpgsql as $$
declare c text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ'; i int;
begin
  loop
    c := '';
    for i in 1..5 loop c := c || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from lobbies where code = c);
  end loop;
  return c;
end $$;

-- Créer un lobby avec ses objectifs communs (verrouillés)
create or replace function public.creer_lobby(
  p_nom text, p_enjeu text, p_date_debut date, p_date_fin date,
  p_nb_perso int, p_perso_pts_temps int, p_perso_pts_retard int,
  p_max_membres int, p_objectifs jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare l uuid; o jsonb; n int := 0;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if p_date_fin < p_date_debut then raise exception 'la date de fin est avant le début'; end if;
  insert into lobbies (code, nom, enjeu, date_debut, date_fin, nb_perso, perso_pts_temps, perso_pts_retard, max_membres, createur, admin)
  values (code_lobby(), p_nom, p_enjeu, p_date_debut, p_date_fin, p_nb_perso, p_perso_pts_temps, p_perso_pts_retard, p_max_membres, auth.uid(), auth.uid())
  returning id into l;
  insert into membres (lobby_id, user_id) values (l, auth.uid());
  for o in select * from jsonb_array_elements(coalesce(p_objectifs, '[]'::jsonb)) loop
    n := n + 1;
    insert into objectifs (lobby_id, owner, titre, emoji, type, priere, heure_debut, heure_fin, pts_temps, pts_retard, ordre)
    values (l, null, o->>'titre', coalesce(o->>'emoji','✅'), o->>'type', o->>'priere',
            nullif(o->>'heure_debut','')::time, nullif(o->>'heure_fin','')::time,
            coalesce((o->>'pts_temps')::int, 3), coalesce((o->>'pts_retard')::int, 1), n);
  end loop;
  return l;
end $$;

create or replace function public.rejoindre_lobby(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare lb lobbies;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  select * into lb from lobbies where code = upper(trim(p_code));
  if lb.id is null then raise exception 'code inconnu'; end if;
  if exists (select 1 from membres where lobby_id = lb.id and user_id = auth.uid()) then return lb.id; end if;
  if (select count(*) from membres where lobby_id = lb.id) >= lb.max_membres then raise exception 'lobby complet'; end if;
  if current_date > lb.date_fin then raise exception 'ce lobby est terminé'; end if;
  insert into membres (lobby_id, user_id) values (lb.id, auth.uid());
  return lb.id;
end $$;

-- Objectifs perso : modifiables seulement avant le début du lobby, points imposés par le lobby
create or replace function public.ajouter_objectif_perso(
  p_lobby uuid, p_titre text, p_emoji text, p_type text, p_priere text, p_heure_debut text, p_heure_fin text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare lb lobbies; o uuid;
begin
  if not est_membre(p_lobby) then raise exception 'pas membre'; end if;
  select * into lb from lobbies where id = p_lobby;
  if (now() at time zone 'Europe/Paris')::date >= lb.date_debut then raise exception 'le lobby a commencé, objectifs verrouillés'; end if;
  if (select count(*) from objectifs where lobby_id = p_lobby and owner = auth.uid()) >= lb.nb_perso then
    raise exception 'tu as déjà tes % objectifs', lb.nb_perso; end if;
  insert into objectifs (lobby_id, owner, titre, emoji, type, priere, heure_debut, heure_fin, pts_temps, pts_retard, ordre)
  values (p_lobby, auth.uid(), p_titre, coalesce(nullif(p_emoji,''),'🎯'), p_type, nullif(p_priere,''),
          nullif(p_heure_debut,'')::time, nullif(p_heure_fin,'')::time, lb.perso_pts_temps, lb.perso_pts_retard, 100)
  returning id into o;
  return o;
end $$;

create or replace function public.supprimer_objectif_perso(p_objectif uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ob objectifs; lb lobbies;
begin
  select * into ob from objectifs where id = p_objectif and owner = auth.uid();
  if ob.id is null then raise exception 'objectif introuvable'; end if;
  select * into lb from lobbies where id = ob.lobby_id;
  if (now() at time zone 'Europe/Paris')::date >= lb.date_debut then raise exception 'le lobby a commencé, objectifs verrouillés'; end if;
  delete from objectifs where id = p_objectif;
end $$;

-- Preuve douteuse : un membre la conteste, l'admin du lobby tranche (si c'est l'admin qui conteste, c'est refusé direct)
create or replace function public.contester_preuve(p_preuve uuid, p_motif text) returns void
language plpgsql security definer set search_path = public as $$
declare pr preuves; adm uuid;
begin
  select * into pr from preuves where id = p_preuve;
  if pr.id is null or not est_membre(pr.lobby_id) then raise exception 'preuve introuvable'; end if;
  if pr.user_id = auth.uid() then raise exception 'tu ne peux pas contester ta propre preuve'; end if;
  if pr.refusee then raise exception 'preuve déjà refusée'; end if;
  select admin into adm from lobbies where id = pr.lobby_id;
  if adm = auth.uid() then
    update preuves set refusee = true, refusee_par = auth.uid(), contestee = false, contestee_par = auth.uid(), motif = nullif(p_motif,'') where id = p_preuve;
  else
    update preuves set contestee = true, contestee_par = auth.uid(), motif = nullif(p_motif,'') where id = p_preuve;
  end if;
end $$;

create or replace function public.trancher_preuve(p_preuve uuid, p_refuser boolean) returns void
language plpgsql security definer set search_path = public as $$
declare pr preuves;
begin
  select * into pr from preuves where id = p_preuve;
  if pr.id is null or not est_membre(pr.lobby_id) then raise exception 'preuve introuvable'; end if;
  if (select admin from lobbies where id = pr.lobby_id) is distinct from auth.uid() then raise exception 'seul l''admin du lobby tranche'; end if;
  if p_refuser then
    update preuves set refusee = true, refusee_par = auth.uid(), contestee = false where id = p_preuve;
  else
    update preuves set refusee = false, refusee_par = null, contestee = false, contestee_par = null, motif = null where id = p_preuve;
  end if;
end $$;

-- Anciens noms (vieilles versions de l'appli encore en cache)
create or replace function public.refuser_preuve(p_preuve uuid, p_motif text) returns void
language sql security definer set search_path = public as $$ select contester_preuve(p_preuve, p_motif); $$;
create or replace function public.accepter_preuve(p_preuve uuid) returns void
language sql security definer set search_path = public as $$ select trancher_preuve(p_preuve, false); $$;

-- Si l'admin quitte le lobby, le plus ancien membre restant devient admin
create or replace function public.admin_parti() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update lobbies set admin = (select user_id from membres where lobby_id = old.lobby_id order by joined_at limit 1)
  where id = old.lobby_id and admin = old.user_id;
  return old;
end $$;
drop trigger if exists membres_admin_parti on public.membres;
create trigger membres_admin_parti after delete on public.membres for each row execute function public.admin_parti();

-- Création automatique du profil à l'inscription
create or replace function public.nouveau_profil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profils (id, pseudo, prenom)
  values (new.id, coalesce(new.raw_user_meta_data->>'pseudo', split_part(new.email,'@',1)),
          coalesce(new.raw_user_meta_data->>'prenom', split_part(new.email,'@',1)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.nouveau_profil();

-- ---------- Sécurité (RLS) ----------

alter table public.profils enable row level security;
alter table public.lobbies enable row level security;
alter table public.membres enable row level security;
alter table public.objectifs enable row level security;
alter table public.preuves enable row level security;
alter table public.abonnements_push enable row level security;
alter table public.horaires_mosquee enable row level security;

drop policy if exists profils_select on public.profils;
create policy profils_select on public.profils for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from membres a join membres b on a.lobby_id = b.lobby_id
    where a.user_id = auth.uid() and b.user_id = profils.id));
drop policy if exists profils_update on public.profils;
create policy profils_update on public.profils for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists lobbies_select on public.lobbies;
create policy lobbies_select on public.lobbies for select to authenticated using (est_membre(id));

drop policy if exists membres_select on public.membres;
create policy membres_select on public.membres for select to authenticated using (est_membre(lobby_id));
drop policy if exists membres_delete on public.membres;
create policy membres_delete on public.membres for delete to authenticated using (user_id = auth.uid());

drop policy if exists objectifs_select on public.objectifs;
create policy objectifs_select on public.objectifs for select to authenticated using (est_membre(lobby_id));

drop policy if exists preuves_select on public.preuves;
create policy preuves_select on public.preuves for select to authenticated using (est_membre(lobby_id));

drop policy if exists push_all on public.abonnements_push;
create policy push_all on public.abonnements_push for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists horaires_select on public.horaires_mosquee;
create policy horaires_select on public.horaires_mosquee for select to authenticated using (true);

revoke update on public.profils from authenticated;
grant update (prenom, mosquee_url, mosquee_nom, lat, lon, fuseau) on public.profils to authenticated;

-- ---------- Photos ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('preuves', 'preuves', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists preuves_photos_select on storage.objects;
create policy preuves_photos_select on storage.objects for select to authenticated using (
  bucket_id = 'preuves' and public.est_membre(((storage.foldername(name))[1])::uuid));

-- ---------- Propositions soumises au vote du lobby ----------
-- type : 'objectif_perso' (contenu = un objectif avec sa pondération), 'changement' (contenu = {resume, operations} préparé par Claude),
--        'admin' (contenu = {user_id}). Tous les membres sauf l'auteur doivent être d'accord, puis n'importe qui clique « Appliquer ».
create table if not exists public.propositions (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  auteur uuid not null references public.profils(id) on delete cascade,
  type text not null check (type in ('objectif_perso','changement','admin')),
  texte text,
  contenu jsonb not null,
  statut text not null default 'ouverte' check (statut in ('ouverte','appliquee','annulee')),
  created_at timestamptz not null default now(),
  appliquee_le timestamptz
);
create index if not exists propositions_lobby_idx on public.propositions (lobby_id, created_at desc);
create table if not exists public.votes (
  proposition_id uuid not null references public.propositions(id) on delete cascade,
  user_id uuid not null references public.profils(id) on delete cascade,
  accord boolean not null,
  primary key (proposition_id, user_id)
);
alter table public.propositions enable row level security;
alter table public.votes enable row level security;
drop policy if exists propositions_select on public.propositions;
create policy propositions_select on public.propositions for select to authenticated using (est_membre(lobby_id));
drop policy if exists votes_select on public.votes;
create policy votes_select on public.votes for select to authenticated using (
  exists (select 1 from propositions p where p.id = proposition_id and est_membre(p.lobby_id)));

create or replace function public.proposer(p_lobby uuid, p_type text, p_texte text, p_contenu jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid;
begin
  if not est_membre(p_lobby) then raise exception 'pas membre'; end if;
  if p_type = 'admin' then
    if not exists (select 1 from membres where lobby_id = p_lobby and user_id = (p_contenu->>'user_id')::uuid) then raise exception 'cette personne n''est pas dans le lobby'; end if;
    if (select admin from lobbies where id = p_lobby) = (p_contenu->>'user_id')::uuid then raise exception 'c''est déjà l''admin'; end if;
  end if;
  insert into propositions (lobby_id, auteur, type, texte, contenu) values (p_lobby, auth.uid(), p_type, nullif(p_texte,''), p_contenu) returning id into i;
  return i;
end $$;

create or replace function public.modifier_proposition(p_id uuid, p_texte text, p_contenu jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update propositions set texte = nullif(p_texte,''), contenu = p_contenu where id = p_id and auteur = auth.uid() and statut = 'ouverte';
  if not found then raise exception 'proposition introuvable'; end if;
  delete from votes where proposition_id = p_id; -- c'est une nouvelle version : on revote
end $$;

create or replace function public.annuler_proposition(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update propositions set statut = 'annulee' where id = p_id and auteur = auth.uid() and statut = 'ouverte';
  if not found then raise exception 'proposition introuvable'; end if;
end $$;

create or replace function public.voter(p_id uuid, p_accord boolean) returns void
language plpgsql security definer set search_path = public as $$
declare pr propositions;
begin
  select * into pr from propositions where id = p_id;
  if pr.id is null or not est_membre(pr.lobby_id) or pr.statut <> 'ouverte' then raise exception 'proposition introuvable'; end if;
  if pr.auteur = auth.uid() then raise exception 'c''est ta proposition'; end if;
  insert into votes (proposition_id, user_id, accord) values (p_id, auth.uid(), p_accord)
  on conflict (proposition_id, user_id) do update set accord = excluded.accord;
end $$;

-- Applique une proposition validée par tout le monde
create or replace function public.appliquer_proposition(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr propositions; op jsonb; o jsonb; c jsonb; n int;
begin
  select * into pr from propositions where id = p_id for update;
  if pr.id is null or not est_membre(pr.lobby_id) or pr.statut <> 'ouverte' then raise exception 'proposition introuvable'; end if;
  if exists (select 1 from membres m where m.lobby_id = pr.lobby_id and m.user_id <> pr.auteur
             and not exists (select 1 from votes v where v.proposition_id = p_id and v.user_id = m.user_id and v.accord)) then
    raise exception 'tout le monde n''a pas encore validé';
  end if;

  if pr.type = 'admin' then
    update lobbies set admin = (pr.contenu->>'user_id')::uuid where id = pr.lobby_id;
  elsif pr.type = 'objectif_perso' then
    o := pr.contenu;
    insert into objectifs (lobby_id, owner, titre, emoji, type, priere, heure_debut, heure_fin, pts_temps, pts_retard, ordre)
    values (pr.lobby_id, pr.auteur, o->>'titre', coalesce(nullif(o->>'emoji',''),'🎯'), o->>'type', nullif(o->>'priere',''),
            nullif(o->>'heure_debut','')::time, nullif(o->>'heure_fin','')::time,
            least(20, greatest(0, (o->>'pts_temps')::int)), least(20, greatest(0, coalesce((o->>'pts_retard')::int, 0))), 100);
  else
    for op in select * from jsonb_array_elements(coalesce(pr.contenu->'operations', '[]'::jsonb)) loop
      o := op->'objectif'; c := op->'champs';
      if op->>'op' = 'ajouter' then
        select coalesce(max(ordre), 0) + 1 into n from objectifs where lobby_id = pr.lobby_id and owner is null;
        insert into objectifs (lobby_id, owner, titre, emoji, type, priere, heure_debut, heure_fin, pts_temps, pts_retard, ordre)
        values (pr.lobby_id, null, o->>'titre', coalesce(nullif(o->>'emoji',''),'✅'), o->>'type', nullif(o->>'priere',''),
                nullif(o->>'heure_debut','')::time, nullif(o->>'heure_fin','')::time,
                least(20, greatest(0, (o->>'pts_temps')::int)), least(20, greatest(0, coalesce((o->>'pts_retard')::int, 0))), n);
      elsif op->>'op' = 'modifier' then
        update objectifs set titre = o->>'titre', emoji = coalesce(nullif(o->>'emoji',''), emoji), type = o->>'type', priere = nullif(o->>'priere',''),
          heure_debut = nullif(o->>'heure_debut','')::time, heure_fin = nullif(o->>'heure_fin','')::time,
          pts_temps = least(20, greatest(0, (o->>'pts_temps')::int)), pts_retard = least(20, greatest(0, coalesce((o->>'pts_retard')::int, 0)))
        where id = (op->>'id')::uuid and lobby_id = pr.lobby_id and retire_le is null;
      elsif op->>'op' = 'retirer' then
        update objectifs set retire_le = now() where id = (op->>'id')::uuid and lobby_id = pr.lobby_id and retire_le is null;
      elsif op->>'op' = 'lobby' then
        update lobbies set
          nom = coalesce(nullif(c->>'nom',''), nom), enjeu = coalesce(c->>'enjeu', enjeu),
          date_fin = coalesce((c->>'date_fin')::date, date_fin), nb_perso = coalesce((c->>'nb_perso')::int, nb_perso),
          perso_pts_temps = coalesce((c->>'perso_pts_temps')::int, perso_pts_temps), perso_pts_retard = coalesce((c->>'perso_pts_retard')::int, perso_pts_retard),
          fin_journee = coalesce((c->>'fin_journee')::time, fin_journee)
        where id = pr.lobby_id;
      end if;
    end loop;
  end if;
  update propositions set statut = 'appliquee', appliquee_le = now() where id = p_id;
end $$;

-- ---------- Compte Claude de chacun (sa clé API) ----------
-- Aucune règle d'accès : illisible depuis l'appli. Seule la fonction serveur « claude » la lit et l'écrit.
create table if not exists public.cles_claude (
  user_id uuid primary key references public.profils(id) on delete cascade,
  cle text not null,
  maj timestamptz not null default now()
);
alter table public.cles_claude enable row level security;
create or replace function public.a_cle_claude() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from cles_claude where user_id = auth.uid()); $$;
create or replace function public.oublier_cle_claude() returns void
language sql security definer set search_path = public as $$ delete from cles_claude where user_id = auth.uid(); $$;

-- ---------- Mode triche (réservé à certains comptes) ----------
-- Lier des objectifs de lobbies différents : une seule preuve les valide tous.
-- Tables lisibles uniquement par leur propriétaire : les autres membres ne voient ni le mode, ni les liens,
-- ni les autres lobbies (déjà garanti par les règles des lobbies/membres).

create table if not exists public.triche (
  user_id uuid primary key references public.profils(id) on delete cascade
);
create table if not exists public.liens_triche (
  user_id uuid not null references public.profils(id) on delete cascade,
  objectif_id uuid not null references public.objectifs(id) on delete cascade,
  groupe uuid not null,
  primary key (user_id, objectif_id)
);
create index if not exists liens_triche_groupe_idx on public.liens_triche (user_id, groupe);

alter table public.triche enable row level security;
alter table public.liens_triche enable row level security;
drop policy if exists triche_select on public.triche;
create policy triche_select on public.triche for select to authenticated using (user_id = auth.uid());
drop policy if exists liens_triche_select on public.liens_triche;
create policy liens_triche_select on public.liens_triche for select to authenticated using (user_id = auth.uid());

-- Un objectif « à moi » : commun d'un lobby dont je suis membre, ou perso à moi
create or replace function public.objectif_a_moi(p_objectif uuid) returns objectifs
language plpgsql stable security definer set search_path = public as $$
declare ob objectifs;
begin
  select * into ob from objectifs where id = p_objectif;
  if ob.id is null or not est_membre(ob.lobby_id) or (ob.owner is not null and ob.owner <> auth.uid()) then
    raise exception 'objectif introuvable'; end if;
  return ob;
end $$;

create or replace function public.lier_objectifs(p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a objectifs; b objectifs; ga uuid; gb uuid; g uuid;
begin
  if not exists (select 1 from triche where user_id = auth.uid()) then raise exception 'non autorisé'; end if;
  a := objectif_a_moi(p_a); b := objectif_a_moi(p_b);
  if a.lobby_id = b.lobby_id then raise exception 'les deux objectifs sont dans le même lobby'; end if;
  select groupe into ga from liens_triche where user_id = auth.uid() and objectif_id = a.id;
  select groupe into gb from liens_triche where user_id = auth.uid() and objectif_id = b.id;
  g := coalesce(ga, gb, gen_random_uuid());
  if gb is not null and gb <> g then update liens_triche set groupe = g where user_id = auth.uid() and groupe = gb; end if;
  insert into liens_triche (user_id, objectif_id, groupe) values (auth.uid(), a.id, g), (auth.uid(), b.id, g)
  on conflict (user_id, objectif_id) do update set groupe = excluded.groupe;
  -- Jamais deux objectifs d'un même lobby dans un groupe (sinon une photo validerait deux objectifs visibles)
  if exists (select 1 from liens_triche l join objectifs o on o.id = l.objectif_id
             where l.user_id = auth.uid() and l.groupe = g group by o.lobby_id having count(*) > 1) then
    raise exception 'un objectif de ce lobby est déjà dans ce lien';
  end if;
end $$;

create or replace function public.delier_objectif(p_objectif uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  delete from liens_triche where user_id = auth.uid() and objectif_id = p_objectif returning groupe into g;
  if g is not null and (select count(*) from liens_triche where user_id = auth.uid() and groupe = g) < 2 then
    delete from liens_triche where user_id = auth.uid() and groupe = g;
  end if;
end $$;

-- Activer le mode pour le compte de Taha
insert into public.triche (user_id) select id from public.profils where pseudo = 'taha' on conflict do nothing;

-- ---------- Temps réel ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'preuves') then
    alter publication supabase_realtime add table public.preuves;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'propositions') then
    alter publication supabase_realtime add table public.propositions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'votes') then
    alter publication supabase_realtime add table public.votes;
  end if;
end $$;
