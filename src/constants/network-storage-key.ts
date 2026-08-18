// Deliberately its own leaf module with zero other imports/side effects — index.js
// needs this string before it's safe to import anything from config.ts (which
// resolves ACTIVE_NETWORK the moment it's first evaluated).
export const ACTIVE_NETWORK_STORAGE_KEY = 'latch_active_network';
