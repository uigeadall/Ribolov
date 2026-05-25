// Expo config plugin: injects `$RNFirebaseAsStaticFramework = true` into
// the iOS Podfile during `expo prebuild`.
//
// Why we need this:
//   The app uses `useFrameworks: "static"` (via expo-build-properties) for
//   the broader RN ecosystem. Under that mode, every Pod is built as a
//   STATIC FRAMEWORK by default. But @react-native-firebase's pods include
//   non-modular React-Core headers — that's a hard compile error under
//   static framework mode ("non-modular header inside framework module").
//
//   Setting `$RNFirebaseAsStaticFramework = true` flips RNFB's own pods
//   to static-libraries-with-modular-headers, which sidesteps the
//   collision while keeping the rest of the project on static frameworks
//   like Expo recommends.
//
// Why a plugin and not just a Podfile edit:
//   `expo prebuild --clean` wipes the ios/ directory and regenerates it
//   from scratch. Any manual Podfile edit gets lost. Running through a
//   config plugin means the line lands automatically on every prebuild.

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const STATIC_FRAMEWORK_LINE = '$RNFirebaseAsStaticFramework = true';
const MODULAR_HEADERS_LINE = 'use_modular_headers!';
// Sentinel string for the post_install hook injection — used to skip
// re-injection when the Podfile already contains it.
const POST_INSTALL_SENTINEL =
  "config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES']";
const POST_INSTALL_BLOCK = `
    # Injected by plugins/with-rnfb-static-framework.js — see file header.
    installer.pods_project.targets.each do |target|
      if target.name.start_with?('RNFB')
        target.build_configurations.each do |config|
          config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        end
      end
    end`;

const withRnfbStaticFramework = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      // ── 1. Static-framework flag (module-level, before targets) ──
      // RNFB's podspec checks $RNFirebaseAsStaticFramework at evaluation
      // time during pod install; the flag must be defined before any
      // `target ... do` block. Insert just after the existing
      // `podfile_properties = ...` line so it lives outside any target.
      if (!contents.includes(STATIC_FRAMEWORK_LINE)) {
        const anchor = /podfile_properties = JSON\.parse.*$/m;
        const block = [
          '',
          '# Injected by plugins/with-rnfb-static-framework.js — see file header.',
          STATIC_FRAMEWORK_LINE,
          '',
        ].join('\n');
        contents = anchor.test(contents)
          ? contents.replace(anchor, (match) => `${match}\n${block}`)
          : `${block}\n${contents}`;
      }

      // ── 2. Modular headers (inside the main target, after use_frameworks!) ──
      // Without this, the static-framework build of RNFB pods fails with
      // "non-modular header inside framework module" errors because RNFB
      // imports React-Core headers (RCTConvert.h, RCTBridgeModule.h, etc)
      // which aren't themselves clang modules. use_modular_headers! tells
      // CocoaPods to wrap every pod as a module so the imports become
      // legal under static framework mode.
      if (!contents.includes(MODULAR_HEADERS_LINE)) {
        const useFrameworksAnchor =
          /use_frameworks! :linkage => ENV\['USE_FRAMEWORKS'\]\.to_sym if ENV\['USE_FRAMEWORKS'\]/;
        if (useFrameworksAnchor.test(contents)) {
          const block = [
            '',
            '  # Injected by plugins/with-rnfb-static-framework.js — see file header.',
            `  ${MODULAR_HEADERS_LINE}`,
          ].join('\n');
          contents = contents.replace(useFrameworksAnchor, (match) => `${match}${block}`);
        }
        // No fallback when anchor is missing — modular headers MUST live
        // inside the target block; bailing keeps the Podfile syntactically
        // valid if the template ever changes.
      }

      // ── 3. CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES on RNFB pods ──
      // RNFB still imports React-Core headers via the legacy
      // `<React/RCTConvert.h>` style (not the modular
      // `<React-Core/RCTConvert.h>`). Under static frameworks, that's
      // treated as a hard error even when React-Core is built as a
      // module. Downgrading the diagnostic to a warning lets the import
      // resolve at runtime against the actual framework header. Scoped
      // to RNFB targets only — other pods keep the stricter setting.
      if (!contents.includes(POST_INSTALL_SENTINEL)) {
        const reactPostInstallAnchor = /react_native_post_install\([\s\S]*?\)\n/;
        if (reactPostInstallAnchor.test(contents)) {
          contents = contents.replace(
            reactPostInstallAnchor,
            (match) => `${match}${POST_INSTALL_BLOCK}\n`,
          );
        }
        // No fallback — the hook must live inside `post_install do |installer|`.
        // Bailing keeps the Podfile valid if the template structure changes.
      }

      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);
};

module.exports = withRnfbStaticFramework;
