// Vitest global setup for the cross-app integration tests (task 15.2).
//
// The Mobile_PWA local store is Dexie/IndexedDB, which jsdom does not provide,
// so register the in-memory fake-indexeddb implementation on the global scope.
// This lets the real `LocalSessionStore` persist against a real (in-memory)
// IndexedDB, exactly as it does in the mobile app's own tests.
import 'fake-indexeddb/auto';
