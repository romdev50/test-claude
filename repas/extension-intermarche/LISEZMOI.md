# Extension « Repas de la semaine → panier Intermarché »

Ajoute automatiquement dans ton panier Intermarché Drive tous les articles de ta liste
de courses qui ne sont pas cochés « J'ai déjà ».

## Installation (une seule fois, sur ordinateur, Chrome ou Edge)

1. Décompresse le fichier `extension-intermarche.zip` dans un dossier que tu gardes (par exemple `Documents/extension-intermarche`).
2. Ouvre `chrome://extensions` (ou `edge://extensions` dans Edge).
3. Active le **Mode développeur** (interrupteur en haut à droite ; dans Edge, à gauche).
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier décompressé.

## Utilisation

1. Sur intermarche.com, **connecte-toi et choisis ton magasin** de retrait.
2. Dans l'appli Repas de la semaine (Réglages → drive **Intermarché Drive**), va dans **Courses → Ma liste**.
3. Touche **🤖 Remplir mon panier Intermarché**. Le site d'Intermarché s'ouvre avec un panneau en bas à droite.
4. Clique **Démarrer** et laisse l'onglet ouvert. Pour chaque article, l'extension lance la recherche
   et ajoute le premier produit proposé.
5. Si elle ne trouve pas de bouton « Ajouter », elle se met en pause : ajoute le produit toi-même puis
   clique **C'est ajouté, suivant**, ou **Passer**.
6. À la fin, un récapitulatif rappelle la quantité nécessaire pour chaque article : ajuste les quantités
   dans ton panier si besoin.

## Bon à savoir

- L'extension ajoute **1 unité du premier résultat** de la recherche. Vérifie ton panier avant de valider la commande.
- Elle ne fonctionne que sur www.intermarche.com et n'envoie aucune donnée ailleurs. La liste reçue
  est gardée dans ton navigateur jusqu'à ce que tu cliques « Fermer et effacer la liste ».
- Elle n'a pas pu être testée sur le vrai site d'Intermarché, seulement sur une copie simulée. Si le site
  change, l'extension se mettra en pause sur chaque article au lieu de cliquer : préviens-moi pour l'adapter.
