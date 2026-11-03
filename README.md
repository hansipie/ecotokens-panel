# ecotokens-panel — plugin pour Claude Code

> **Ce plugin est fait pour [Claude Code](https://claude.com/claude-code)**, l'assistant de code en ligne de commande d'Anthropic. Il ne fonctionne pas seul ni dans d'autres outils (Codex, Gemini CLI, Qwen Code…), même si ecotokens les prend en charge.

Un plugin Claude Code qui ajoute un bouton **◧ ecotokens-panel** dans le pied de page et un panneau latéral à onglets autour d'[ecotokens](https://github.com/hansipie/ecotokens) : modèle et effort, contexte et quota de la session, handoff, économies de tokens, usage de Jev, watcher d'index, agents et tâches en arrière-plan de la session.

## Installation

Dans un terminal Claude Code :

```
/plugin install ecotokens-panel --marketplace hansipie/ecotokens-panel
```

Répondez `y` pour ajouter le marketplace, puis choisissez la portée (`user` par défaut). Le plugin est actif tout de suite, sans redémarrage. Installé en portée `user`, il fonctionne aussi dans l'onglet Code de l'application desktop.

### Prérequis

- **Claude Code** (terminal, ou onglet Code de l'application desktop), avec la prise en charge des plugins à hooks (`/plugin`).
- **ecotokens 0.30.0 ou plus récent** dans le `PATH`, avec ses hooks installés (`ecotokens install`). L'onglet Gains utilise l'option `--project` de `ecotokens gain` et `ecotokens jev`, apparue dans cette version. Vérifiez avec `ecotokens --version`.
- **sqlite3** dans le `PATH`, pour lire la base de mesures en lecture seule. Sous Windows, vérifiez que `sqlite3.exe` est également accessible depuis l’environnement qui lance Claude Code.

Le panneau suit les chemins de données natifs d'ecotokens : `%APPDATA%\ecotokens` sous Windows, `~/Library/Application Support/ecotokens` sous macOS et `$XDG_CONFIG_HOME/ecotokens` (ou `~/.config/ecotokens`) sous Linux. Il affiche l’emplacement attendu et les étapes de diagnostic si la base de mesures ou la configuration manque. Une configuration absente laisse ecotokens utiliser ses valeurs par défaut ; sans tarif global, les lignes de la conversation utilisent le tarif API du modèle actif (voir plus bas) et les gains historiques restent sans coût ; définissez-le avec `ecotokens gain price --input <USD par million> --output <USD par million>`. `ecotokens doctor` vérifie l’installation.

Sans ecotokens, les onglets Session, Contexte et Background fonctionnent toujours ; les autres indiquent qu'ils ne peuvent pas lire l'état.

## Utilisation

### Langue

Le panneau propose l’anglais, le français et l’hindi. Pour choisir une langue, définissez `ECOTOKENS_PANEL_LANG` avant de lancer Claude Code :

```sh
ECOTOKENS_PANEL_LANG=fr claude
```

Dans PowerShell (Windows 10/11) :

```powershell
$env:ECOTOKENS_PANEL_LANG = 'fr'
claude
```

Les valeurs prises en charge sont `en`, `fr` et `hi`. Sans remplacement explicite, le panneau suit la langue du système lorsqu’elle est prise en charge, puis revient à l’anglais. Les catalogues se trouvent dans `locales/`.

`locales/en.ts` est le catalogue canonique. Pour ajouter un texte, ajoutez une clé sémantique avec les mêmes placeholders dans les catalogues anglais, français et hindi. Le typage et le test de complétude (`claude plugin test .`) signalent les catalogues incomplets. Pour ajouter une langue, créez son catalogue puis ajoutez son code à `hooks/i18n.ts` et aux tests.

Ouvrez ou fermez le panneau avec le bouton du pied de page ou la commande `/panel`. Les touches `1` à `6` changent d'onglet (la barre d'onglets passe à la ligne quand le panneau est étroit), `↻` relit tout, `✕` ferme.

| Onglet | Contenu | Commandes |
| --- | --- | --- |
| **Session** (`1`) | En haut, modèle et effort : ligne « Modèle » (haiku, sonnet, opus, fable ; le modèle courant en surbrillance, son nom complet en gris dessous) et ligne « Effort » (les niveaux de la ligne effort de `/config`, sinon low, medium, high, xhigh, max ; le niveau courant en surbrillance, celui de `/config` s'il le donne, sinon le dernier choisi ici). Ultracode est présenté séparément comme mode de workflows automatiques, pas comme niveau d’effort ; les boutons l’activent ou le désactivent pour la session. Puis fenêtre de contexte, quota de l’abonnement (5 h, 7 j) avec le coût équivalent API sur la même ligne que le titre ; handoff : état, handoffs du dossier (celui de la session marqué) | Un bouton de modèle ou d'effort lance `/model` ou `/effort` (le bouton s'éclaire au survol) ; Ultracode lance `/effort ultracode on/off` ; `h` active ou désactive le handoff ; « Handoff (/handoff) » lance la skill |
| **Contexte** (`2`) | Détail de la fenêtre comme `/context` : grille, répartition, cache de la dernière requête, fichiers mémoire, serveurs MCP, skills, agents | — |
| **Ecotokens** (`3`) | Économies de la session : les 5 dernières sorties filtrées et les 5 derniers appels à Jev | — |
| **Gains** (`4`) | Pour le workspace courant uniquement : tokens économisés, coût évité, détail par famille ; appels Jev, coût, latence, usages, erreurs, activité | Période : Jour, Semaine, Mois, Tout |
| **Watch** (`5`) | Watcher d'index du dossier : état, PID, sessions, journal ; autres dossiers surveillés | `w` démarre ou arrête le watcher de ce dossier |
| **Background** (`6`) | En-tête : nombre d'agents, de tâches et d'actifs. Section Agents : sous-agents et coéquipiers de la session courante, les actifs en premier : nom ou type, description, statut (`●` en cours, `◌` en attente, `○` inactif, `✓` terminé, `✗` échoué, `■` arrêté), type · coéquipier ou arrière-plan · modèle, temps écoulé (durée une fois fini), « N outils » (appels d'outils de la boucle propre à l'agent, et le dernier tant qu'il tourne), tokens entrée → sortie et coût estimé (`≈ $0.15`, `< $0.01` sous un centime) après une exécution. Section Tâches en arrière-plan : commandes Bash lancées en arrière-plan, Monitor, workflows, agents distants : type, description, commande, statut (en cours, terminé, arrêté), temps écoulé. 30 lignes au plus par section. « Aucun agent ni tâche en arrière-plan dans cette session. » quand il n'y a rien | — |

Les onglets se rafraîchissent à leur ouverture, à la fin de chaque tour tant qu'ils sont affichés, et avec `↻`. L'onglet Background suit en plus chaque lancement d'agent, chaque appel d'outil d'un agent, et relit la liste toutes les 2 s tant qu'il est affiché. Un agent lancé avant le chargement du plugin apparaît sans temps écoulé, et ses compteurs ne partent que de ce chargement.

Claude Code ne donne pas de liste des tâches en arrière-plan aux plugins : une tâche apparaît quand l'outil qui la lance répond (Bash en arrière-plan, Monitor), passe à « arrêté » quand TaskStop l'arrête, et la liste des tâches en cours que portent les événements de fin de tour (Stop, SubagentStop) ajoute celles qui n'ont pas été vues partir (workflows, agents distants) et marque « terminé » celles qui n'y figurent plus. Leur fin n'est donc connue qu'à la fin du tour suivant (d'où la durée « ≤ ») ; leur code de sortie et leur résultat ne sont pas connus. Un agent ou une tâche terminé quitte l'onglet 5 minutes après sa fin (un agent que le moteur liste encore reste).

### Dans la conversation

Sans ouvrir le panneau, le plugin écrit aussi dans la conversation, en gris :

- sous le résultat d'un appel d'outil sur lequel ecotokens a économisé des tokens : `ecotokens · −11.3k tokens (−91 %) · ≈ $0.02 API estimate (Claude Sonnet 5.5)`. Sous une série d'appels repliée (« Read 3 files »), une ligne donne la somme ;
- à la fin de chaque tour de la conversation principale, l'économie depuis le tour précédent, puis le cumul des tokens de la session. Le coût API estimé est calculé pour le modèle de ce tour (ces lignes ne sont que de l'affichage : elles ne sont pas envoyées au modèle). Rien n'est écrit quand ecotokens n'a rien économisé pendant le tour.
- quand un sous-agent délégué par le routeur ecotokens (`router-tiny`, `router-everyday`, `router-large`, `router-hardest`) termine, ses tokens et son coût : `délégation · router-everyday (sonnet-5-5) · 41.0k → 2.0k tokens · ≈ $0.15`. Une ligne par exécution terminée.

Les coûts des lignes `ecotokens` sont des estimations équivalentes aux tarifs publics de l'API Anthropic, pas la facture réelle ni le coût d'un abonnement Claude. Si `price_input_usd_per_mtok` est configuré dans ecotokens, ce tarif global reste prioritaire. Sinon, le panneau utilise le modèle et l'usage du tour courant ; un modèle inconnu n'est pas tarifé. Dans ce mode dynamique, le total de session reste en tokens, car une session peut changer de modèle. Les gains historiques d'`ecotokens gain` restent sans coût tant qu'un tarif global n'est pas configuré.

Le coût d'une délégation et celui d'un agent du Background sont aussi des **estimations** : Claude Code ne fournit pas de coût par exécution aux plugins. Le panneau utilise l'identifiant exact du modèle et les tarifs publics Anthropic (entrée, sortie, lecture et écriture du cache ; création du cache estimée au tarif d'écriture de 5 minutes faute de détail de durée). Les tarifs peuvent changer ; un modèle inconnu n'est pas tarifé. Comme `ecotokens gain`, les lignes en mode « réécrit » ne sont pas comptées.

ecotokens ne note pas l'identifiant de l'appel d'outil : le plugin rapproche un appel (Bash ou Read) de sa ligne dans `metrics.db` par le texte de la commande (ou `Read <fichier>`) et par l'heure. Deux commandes identiques lancées presque ensemble peuvent donc échanger leur ligne. Les sorties des autres outils ne sont pas rapprochées, et un appel d'une série dépliée n'a pas de ligne. Ces lignes sont relues à la fin de chaque appel d'outil (et 4 s plus tard, pour les lectures que résume ecotokens après coup), puis à la fin de chaque tour : pas de minuteur qui tourne en continu. Sans base de mesures ecotokens dans son dossier de données natif, rien n'est lancé ni affiché.

Pour les désactiver : `/config`, ligne **Lignes ecotokens dans la conversation** du plugin (option `liveTranscript`, activée par défaut). Le panneau n'est pas touché.

### Captures d'écran

<table>
  <tr>
    <th>Session</th>
    <th>Contexte</th>
    <th>Ecotokens</th>
  </tr>
  <tr>
    <td><img src="docs/screenshots/session.png" alt="Onglet Session : modèle et effort, fenêtre de contexte, quota de l'abonnement, coût équivalent API et handoff" width="280"></td>
    <td><img src="docs/screenshots/contexte.png" alt="Onglet Contexte : grille de la fenêtre, répartition et cache de la dernière requête" width="280"></td>
    <td><img src="docs/screenshots/ecotokens.png" alt="Onglet Ecotokens : dernières économies et derniers appels à Jev de la session" width="280"></td>
  </tr>
  <tr>
    <th>Gains</th>
    <th>Watch</th>
    <th></th>
  </tr>
  <tr>
    <td><img src="docs/screenshots/gains.png" alt="Onglet Gains : tokens économisés, détail par famille et usage de Jev du workspace" width="280"></td>
    <td><img src="docs/screenshots/watch.png" alt="Onglet Watch : état du watcher, journal et autres dossiers surveillés" width="280"></td>
    <td></td>
  </tr>
</table>

## Développement

Le plugin est un module de hooks TypeScript (`hooks/register.tsx`) chargé directement par Claude Code : il n'y a rien à compiler.

```bash
claude plugin validate .   # manifeste, marketplace et module
claude plugin test .       # tests de tests/
```

Pour le charger depuis le dossier pendant le développement : `claude --plugin-dir ~/chemin/vers/ecotokens-panel`, puis `/reload-plugins` après chaque modification.

| Fichier | Rôle |
| --- | --- |
| `hooks/register.tsx` | Hooks, commande `/panel`, rendu du panneau et des lignes de la conversation |
| `hooks/eco.ts` | Requêtes sqlite de l'onglet Ecotokens, lignes ecotokens de la conversation (rapprochement appel ↔ économie) |
| `hooks/gain.ts` | `ecotokens gain` / `ecotokens jev` de l'onglet Gains |
| `hooks/handoff.ts` | `ecotokens handoff` du panneau handoff |
| `hooks/watch.ts` | `ecotokens watch` de l'onglet Watch |
| `hooks/agents.ts` | Suivi des agents et des tâches en arrière-plan de l'onglet Background |
| `hooks/bar.ts` | Jauges et dégradé de couleurs |
| `hooks/i18n.ts` | Détection de la langue, traductions et formats localisés |
| `hooks/paths.ts` | Construction et comparaison des chemins sous Windows et Unix |
| `locales/*.ts` | Catalogues anglais, français et hindi |
| `types/index.d.ts` | Contrat des valeurs gardées dans `$.state` |
