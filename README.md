# ecotokens-panel — plugin pour Claude Code

> **Ce plugin est fait pour [Claude Code](https://claude.com/claude-code)**, l'assistant de code en ligne de commande d'Anthropic. Il ne fonctionne pas seul ni dans d'autres outils (Codex, Gemini CLI, Qwen Code…), même si ecotokens les prend en charge.

Un plugin Claude Code qui ajoute un bouton **◧ ecotokens-panel** dans le pied de page et un panneau latéral à onglets autour d'[ecotokens](https://github.com/hansipie/ecotokens) : contexte et quota de la session, handoff, économies de tokens, usage de Jev et watcher d'index.

## Installation

Dans un terminal Claude Code :

```
/plugin install ecotokens-panel --marketplace hansipie/ecotokens-panel
```

Répondez `y` pour ajouter le marketplace, puis choisissez la portée (`user` par défaut). Le plugin est actif tout de suite, sans redémarrage. Installé en portée `user`, il fonctionne aussi dans l'onglet Code de l'application desktop.

### Prérequis

- **Claude Code** (terminal, ou onglet Code de l'application desktop), avec la prise en charge des plugins à hooks (`/plugin`).
- **ecotokens 0.30.0 ou plus récent** dans le `PATH`, avec ses hooks installés (`ecotokens install`). L'onglet Gains utilise l'option `--project` de `ecotokens gain` et `ecotokens jev`, apparue dans cette version. Vérifiez avec `ecotokens --version`.
- **sqlite3** dans le `PATH`, pour l'onglet Ecotokens, qui lit les bases d'ecotokens en lecture seule.

Sans ecotokens, les onglets Session et Contexte fonctionnent toujours ; les autres indiquent qu'ils ne peuvent pas lire l'état.

## Utilisation

Ouvrez ou fermez le panneau avec le bouton du pied de page ou la commande `/panel`. Les touches `1` à `5` changent d'onglet, `↻` relit tout, `✕` ferme.

| Onglet | Contenu | Commandes |
| --- | --- | --- |
| **Session** (`1`) | Fenêtre de contexte, quota de l'abonnement (5 h, 7 j), coût équivalent API ; handoff : état, handoffs du dossier (celui de la session marqué) | `h` active ou désactive le handoff ; « Handoff (/handoff) » lance la skill |
| **Contexte** (`2`) | Détail de la fenêtre comme `/context` : grille, répartition, cache de la dernière requête, fichiers mémoire, serveurs MCP, skills, agents | — |
| **Ecotokens** (`3`) | Économies de la session : les 5 dernières sorties filtrées et les 5 derniers appels à Jev | — |
| **Gains** (`4`) | Pour le workspace courant uniquement : tokens économisés, coût évité, détail par famille ; appels Jev, coût, latence, usages, erreurs, activité | Période : Jour, Semaine, Mois, Tout |
| **Watch** (`5`) | Watcher d'index du dossier : état, PID, sessions, journal ; autres dossiers surveillés | `w` démarre ou arrête le watcher de ce dossier |

Les onglets se rafraîchissent à leur ouverture, à la fin de chaque tour tant qu'ils sont affichés, et avec `↻`.

## Développement

Le plugin est un module de hooks TypeScript (`hooks/register.tsx`) chargé directement par Claude Code : il n'y a rien à compiler.

```bash
claude plugin validate .   # manifeste, marketplace et module
claude plugin test .       # tests de tests/
```

Pour le charger depuis le dossier pendant le développement : `claude --plugin-dir ~/chemin/vers/ecotokens-panel`, puis `/reload-plugins` après chaque modification.

| Fichier | Rôle |
| --- | --- |
| `hooks/register.tsx` | Hooks, commande `/panel`, rendu du panneau |
| `hooks/eco.ts` | Requêtes sqlite de l'onglet Ecotokens |
| `hooks/gain.ts` | `ecotokens gain` / `ecotokens jev` de l'onglet Gains |
| `hooks/handoff.ts` | `ecotokens handoff` du panneau handoff |
| `hooks/watch.ts` | `ecotokens watch` de l'onglet Watch |
| `hooks/bar.ts` | Jauges et dégradé de couleurs |
| `types/index.d.ts` | Contrat des valeurs gardées dans `$.state` |
