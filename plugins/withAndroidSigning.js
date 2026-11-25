const { withAppBuildGradle } = require('@expo/config-plugins');
module.exports = function withAndroidSigning(config) {
  return withAppBuildGradle(config, mod => {
    const marker = '// LEDGER_SAWA_ENV_SIGNING';
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents += `\n\n${marker}\ndef ledgerKeystorePath = System.getenv('LEDGER_KEYSTORE_PATH')\nif (ledgerKeystorePath != null && !ledgerKeystorePath.isEmpty()) {\n  android {\n    signingConfigs {\n      release {\n        storeFile file(ledgerKeystorePath)\n        storePassword System.getenv('LEDGER_KEYSTORE_PASSWORD')\n        keyAlias System.getenv('LEDGER_KEY_ALIAS')\n        keyPassword System.getenv('LEDGER_KEY_PASSWORD')\n      }\n    }\n    buildTypes {\n      release { signingConfig signingConfigs.release }\n    }\n  }\n}\n`;
    }
    return mod;
  });
};
