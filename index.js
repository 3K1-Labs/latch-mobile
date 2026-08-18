// DO NOT reorder these imports — see polyfills.js for why.
//
// Everything here must be synchronous. React Native calls
// AppRegistry.runApplication('main') as soon as this bundle finishes
// evaluating; expo-router/entry is what registers 'main'. Deferring that
// import into a promise callback registers it too late and hard-crashes
// with `"main" has not been registered`.
import './polyfills';
import 'expo-router/entry';
