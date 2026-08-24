import { firebaseConfig } from '../config.js';
import { CURRENT_CLIENT_VERSION } from './constants.js';

// Inicializar Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

// Habilitar persistencia offline de forma segura
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
        console.warn("Múltiples pestañas abiertas, persistencia en pestaña principal.");
    } else if (err.code === 'unimplemented') {
        console.warn("Navegador no soporta persistencia offline.");
    }
});

export { db, auth };
