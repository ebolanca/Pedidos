import { firebaseConfig } from '../config.js';
import { CURRENT_CLIENT_VERSION } from './constants.js';

// Inicializar Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

// --- LÓGICA DE LIMPIEZA FORZADA (v11.33.1) ---
async function setupPersistence() {
    const key = "rail_last_sync_version";
    const lastVersion = localStorage.getItem(key);

    if (lastVersion !== CURRENT_CLIENT_VERSION) {
        console.warn(`🔄 Nueva versión detectada [${CURRENT_CLIENT_VERSION}]. Limpiando persistencia...`);
        try {
            await db.terminate();
            await db.clearPersistence();
            localStorage.setItem(key, CURRENT_CLIENT_VERSION);
            console.log("✅ Persistencia limpiada. Reiniciando...");
            window.location.reload();
            return; // Detenemos ejecución para que recargue
        } catch (e) {
            console.error("Error limpiando:", e);
        }
    }

    // Habilitar persistencia normal
    db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        console.log("Persistencia no disponible:", err.code);
    });
}

setupPersistence();

export { db, auth };
