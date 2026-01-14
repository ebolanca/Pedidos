
// js/modules/firebase-init.js
import { firebaseConfig } from '../config.js';

// Inicializar Firebase si no está inicializado
// Nota: Usamos la versión 'compat' que expone 'firebase' globalmente, 
// pero aquí lo encapsulamos.
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Inicializar servicios
const db = firebase.firestore();
const auth = firebase.auth();

// Habilitar persistencia (caché offline)
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    console.log("Persistencia no disponible (posiblemente múltiples pestañas abiertas):", err.code);
});

export { db, auth };
