# LigdiBe 💚

> *« Ligdi » = l'argent en mooré.* Tracker financier **100 % hors-ligne** pour l'Afrique de l'Ouest et Centrale : tes SMS Mobile Money deviennent un budget, sans compte ni serveur.

## Fonctionnalités

| Domaine | Ce que fait l'app |
|---|---|
| Lecture SMS | Analyse en temps réel (même app fermée) des SMS Orange Money, Moov Money, Wave/UBA, Telecel et des banques (débit/crédit, retrait GAB → Poche, salaire)… Whitelist d'expéditeurs, rejet des OTP / PIN / 2FA. |
| Apprentissage guidé | Au premier lancement (et via Réglages / Sauvegarde › « Réanalyser mes SMS ») : l'historique SMS est classé un SMS à la fois avec une proposition pré-remplie — Confirmer / Corriger (type, montant, compte, catégorie, **nouvelle catégorie**) / Ignorer (motif). Ordre : haute confiance d'abord, puis ambigus, puis non reconnus. Chaque correction affine les suivantes (« deviné d'après tes 2 choix précédents »). Reprise exacte, annulation, validation finale en une transaction ; OTP et doublons exclus d'office. |
| SMS non reconnus | Un SMS opérateur au format inconnu n'est pas perdu : il est mis de côté (montant et compte pré-remplis) et s'ajoute en un tap depuis l'accueil. |
| Retrait kiosque | MoMo débité (montant + frais), **Poche (espèces) créditée du net** : un retrait n'est pas une dépense. Frais → « Frais & Taxes ». |
| Crédit & data | Compteur jour / mois / an des micro-recharges, alerte plafond. |
| Internet (data) | Écran « Internet & crédit » : forfaits par semaine / mois / année, volume acheté (Mo/Go), prix du Go, opérateurs, forfaits les plus achetés, graphique interactif, plafond mensuel avec alerte, conseils (pass jour vs forfait mensuel). Les forfaits payés avec le crédit d'appel sont suivis sans être recomptés en dépense. |
| Budget du jour | `(budget disponible − charges fixes) / jours restants` pondéré : ven. 18h → dim. ×1,5 (paramétrable), jours spéciaux (Tabaski…). Série de jours sous budget 🔥. |
| Prévisionnel | Gains & dépenses prévus, coche automatique via le nom dans le SMS, sélection manuelle, report au mois suivant. |
| Carnet informel | « On me doit » / « Je dois », relance WhatsApp/SMS pré-remplie, remboursements partiels, détection auto du remboursement. Tontines. |
| Famille | Demandes d'argent des proches, budget solidarité mensuel, montant conseillé, réponses courtoises pré-rédigées (tout / une partie / plus tard / non) par WhatsApp ou SMS ; l'envoi MoMo détecté est rattaché et classé « Famille ». « Ma famille » importée des contacts (recherche, multi-sélection) : les envois vers ces numéros sont classés « Famille » automatiquement. |
| Statistiques | Top 5 destinataires, frais MoMo du mois, crédit d'appel, solidarité familiale (montant, proches aidés, part des entrées), répartition par catégorie, bilan partageable. |
| Dépôt chez un agent | Poche débitée, MoMo crédité : ni revenu ni dépense. |
| Comparateur de frais | « Combien ça coûte ? » : frais estimés par opérateur (envoi, retrait, paiement) d'après tes propres SMS, opérateur le moins cher et économie possible du mois. |
| Enveloppes | Plafonds mensuels par catégorie, alerte à 80 % et 100 %. |
| Récurrences | Détection automatique des opérations mensuelles (abonnements, loyer, salaire) proposées au prévisionnel. |
| Épargne | Objectifs (Tabaski, rentrée, moto…) avec effort quotidien/hebdomadaire et suivi du rythme. |
| Recherche | Dans tout l'historique (nom, numéro, montant, catégorie, sans accents) avec total envoyé / reçu : « combien j'ai donné à Moussa ? ». |
| Gamification | Série de jours sous budget 🔥, 8 badges, défi de la semaine. |
| Données | SQLite chiffré SQLCipher (AES-256, clé dans l'Android Keystore). Écran « Sauvegarde & transfert » : export **ZIP** (sauvegarde complète + CSV + notice), CSV (Excel) ou JSON horodaté ; envoi par le menu de partage Android (WhatsApp, Bluetooth, Drive…) ; import d'un .zip ou .json depuis n'importe quel dossier (sélecteur de fichiers) avec aperçu avant fusion. |
| Sécurité | Verrouillage par code PIN (haché, salé, blocage après 5 essais), soldes masquables. |
| Notifications | Post-dépense avec catégories en un tap, rappel 07h30, bilan 21h30, bilan mensuel le 1er, rappel prévisionnel le 28, alertes. |
| Widget Android | Budget du jour sur l'écran d'accueil (reste, jauge, série 🔥, week-end), mis à jour à chaque SMS même app fermée ; patrimoine affiché seulement si activé. |
| Confort | Mode sombre (auto/clair/sombre), libellés accessibles TalkBack. |

## Architecture

```
android/app/src/main/java/com/ligdibe/sms/  SmsReceiver.kt, SmsHeadlessTaskService.kt, SmsInboxModule.kt
android/app/src/main/java/com/ligdibe/widget/  BudgetWidgetProvider.kt, WidgetModule.kt
src/core/            devise FCFA, dates, catégories, identifiants
src/data/parser/     SmsParserEngine (regex opérateurs), filtres de sécurité
src/data/database/   op-sqlite + SQLCipher, migrations
src/data/repositories/ dépôts SQL
src/domain/          modèles, ports, cas d'usage (purs, testés)
src/presentation/    store Zustand, hooks, composants, écrans, navigation
src/services/        notifications Notifee, export, pont SMS
__tests__/           Jest (parseur : 100 % de couverture)
```

## Démarrer

```bash
npm install --legacy-peer-deps
npm run verify      # typecheck + lint + 240+ tests
npm run android     # appareil Android ou émulateur
```

Node ≥ 22.5 requis pour les tests des dépôts SQL (`node:sqlite`).

## Publication Google Play

`READ_CONTACTS` est facultative (import de « Ma famille ») et demandée seulement au moment de l'import. Les permissions `RECEIVE_SMS` / `READ_SMS` exigent la déclaration « Permissions SMS et journal d'appels » (exception *gestion financière basée sur les SMS*). Rien ne quitte l'appareil : l'app n'utilise pas Internet en production.

## Version de publication (Google Play)

1. Générer une clé : `keytool -genkeypair -v -keystore upload.keystore -alias ligdibe -keyalg RSA -keysize 2048 -validity 10000`
2. Créer les secrets GitHub : `LIGDIBE_UPLOAD_KEYSTORE_BASE64` (`base64 -w0 upload.keystore`), `LIGDIBE_UPLOAD_STORE_PASSWORD`, `LIGDIBE_UPLOAD_KEY_ALIAS`, `LIGDIBE_UPLOAD_KEY_PASSWORD`.
3. Pousser un tag `v1.0.0` : la CI produit l'AAB signé (`ligdibe-release-aab`).

En local, les mêmes variables peuvent être placées dans `~/.gradle/gradle.properties`. Sans clé, le build release est signé avec la clé debug (non publiable).

## Formats SMS réels — état d'avancement

Calibrage sur un export réel (Orange Money, Moov Money, Wave, Ecobank — Burkina Faso). Fixtures anonymisées dans `__tests__/realSmsFormats.test.ts`.

- [x] Étape 1 — Codes de sécurité (code SMS Moov, OTP Orange, validation Wave, activation Ecobank, mot de passe de retrait, lien de connexion Max it) et SMS informatifs (soldes consultés, demandes de paiement, échecs, unités offertes, détail de facture, recharge de carte virtuelle) écartés.
- [x] Étape 2 — Orange Money : reçu sans frais, « vous avez transfere … au numero », paiement sans frais, « recharge … d unites », dépôt agent (CI), transferts internationaux, envoi à un non-abonné.
- [ ] Étape 3 — Moov Money : « recu … de credit du … » (achat de crédit), « Depot d'argent reussi », « Transfert National reussi ».
- [ ] Étape 4 — Ecobank : « XOF … Crédit / Débit du ac », dépôts au Point Xpress (3 SMS pour une opération → 1 seule écriture).
- [ ] Étape 5 — Import d'un fichier « SMS Exporter » (.txt) vers l'apprentissage guidé.

### Reste à développer
- Frais de retrait Orange : absents du SMS, déductibles de l'écart de solde (non calculés).
- Frais de facture ONEA/SONABEL : présents seulement dans le SMS « détail de facture » (ignoré pour éviter le doublon).
- Crédit Moov « recu … de credit du <numéro> » : impossible de distinguer un achat pour soi d'un cadeau reçu sans le solde ; proposé avec confiance moyenne dans l'apprentissage guidé.
- Expéditeurs non agréés vus dans l'export (NANAN, OrangeMaxit) : à ajouter à la main dans Réglages si souhaité.
