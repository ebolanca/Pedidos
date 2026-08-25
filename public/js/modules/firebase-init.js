import { firebaseConfig } from '../config.js';
import { CURRENT_CLIENT_VERSION } from './constants.js';

// Inicializar Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

// Habilitar persistencia offline de forma segura sin bloquear la app
try {
    db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        console.warn("Persistencia offline no disponible:", err ? (err.message || err.code) : err);
    });
} catch (e) {
    console.warn("No se pudo habilitar persistencia:", e ? e.message : e);
}

export { db, auth };
