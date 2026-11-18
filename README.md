# Rafiq

Appli web (installable sur iPhone) pour tenir ses objectifs à plusieurs : lobby, objectifs communs verrouillés,
objectifs perso, preuves photo horodatées, points, enjeu final, horaires de prière Mawaqit.

- `app/` : l'appli (HTML/CSS/JS sans build), à héberger en HTTPS (GitHub Pages).
- `supabase/schema.sql` : base de données + règles de sécurité (rejouable).
- `supabase/functions/` : `preuve` (réception photo, calcul à temps/retard, notifs) et `mosquee` (horaires Mawaqit).
- `tests/pilote.mjs` : pilotage de Chrome headless pour les tests à deux comptes.

Les clés secrètes ne sont pas dans le dépôt (elles sont dans `~/.config/rafiq/`).
