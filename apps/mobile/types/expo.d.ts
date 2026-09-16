/// <reference types="expo/types" />

// Expo génère `expo-env.d.ts` au démarrage du bundler et le remet dans .gitignore
// à chaque fois — il n'est donc pas versionné. Ce fichier-ci porte la même
// référence de types, en version suivie, pour que `npm run typecheck` fonctionne
// sur un dépôt fraîchement cloné, avant tout lancement d'Expo.
