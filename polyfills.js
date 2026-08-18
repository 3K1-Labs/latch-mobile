// Must be the first thing that runs in the whole app — before any other import.
// @noble/hashes (a transitive dep of @walletconnect/core/utils) snapshots
// globalThis.crypto once, the first time it's required, and never re-checks it.
// If anything else gets imported first and pulls that module in before crypto
// exists, the snapshot is frozen `undefined` for the rest of the JS session.
import 'react-native-get-random-values';
import { install } from 'react-native-quick-crypto';

install();
