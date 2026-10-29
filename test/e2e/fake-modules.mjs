const wrap = body => body;
export const MODULES = {
  "firebase-app.js": `export const initializeApp = (...a) => window.__FAKE.app.initializeApp(...a);`,
  "firebase-firestore.js": `const f = window.__FAKE.fs; export const { getFirestore, collection, doc, query, where, orderBy, limit, serverTimestamp, Timestamp, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, onSnapshot } = f;`,
  "firebase-auth.js": `const a = window.__FAKE.auth; export const { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail, updateProfile, signOut } = a;`,
};
