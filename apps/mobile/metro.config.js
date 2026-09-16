// Configuration Metro basée sur celle d'Expo.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite passe par WebAssembly sur la cible web : sans cette extension,
// le bundle web échoue à résoudre wa-sqlite.wasm. Sans effet sur iOS/Android.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
