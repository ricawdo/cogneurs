# L'Arène des Cogneurs

Auto-battler en ligne : chaque joueur crée un compte (nom d'utilisateur + mot de passe), crée son cogneur et l'envoie se battre contre les cogneurs des autres joueurs.

- **Hébergement** : Vercel (page statique `public/` + fonctions `api/`), région Paris (`cdg1`).
- **Base de données** : Postgres Supabase (projet `cogneurs`, région Paris). Schéma : `db/schema.sql`.
- **Anti-triche** : tout se décide sur le serveur (stats, combats, XP, compteurs). Le navigateur rejoue le combat à partir d'une graine envoyée par le serveur.

## Configuration Vercel

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | Chaîne de connexion Supabase, mode **Transaction pooler** (port 6543), avec le vrai mot de passe à la place de `[YOUR-PASSWORD]` |

## Développement local

```bash
npm install
npm run dev     # jeu sur http://localhost:3000 avec une base Postgres embarquée (rien à installer)
npm test        # test de bout en bout de l'API
```

## Fichiers

| Chemin | Rôle |
|---|---|
| `public/index.html` | Le jeu dans le navigateur |
| `public/engine.js` | Moteur du jeu, partagé navigateur / serveur |
| `lib/app.js` | Logique serveur : comptes, sessions, combats, événement |
| `dev-server.js` | Serveur local pour le développement (pas utilisé sur Vercel) |
| `api/*.js` | Points d'entrée Vercel (un fichier par route) |
| `db/schema.sql` | Tables Postgres (RLS activée sans politique : invisibles depuis les clés publiques Supabase) |

## Lancer un nouvel événement

Dans `lib/app.js`, modifier `const EVENT = {...}` : nouvel identifiant, titre, date de fin, multiplicateurs d'XP, combats bonus, récompense du camp gagnant. À la fin d'un événement, le camp gagnant reçoit sa récompense à la prochaine connexion de chaque joueur.

## Limites connues

- Pas d'e-mail : un mot de passe oublié ne peut pas être récupéré.
- Le défenseur ne gagne pas d'XP quand on l'attaque.
- Pas encore d'élèves, de tournois ni de paiement.
