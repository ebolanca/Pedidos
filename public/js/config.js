/* public/js/config.js */

// 1. Configuración de Firebase (IGUAL)
const firebaseConfig = {
    apiKey: "AIzaSyATkItPtDhyjv9hkL54Q1JZauK5DfqdKh4",
    authDomain: "pedidos-rail-app-2025-87f2c.firebaseapp.com",
    projectId: "pedidos-rail-app-2025-87f2c",
    storageBucket: "pedidos-rail-app-2025-87f2c.firebasestorage.app",
    messagingSenderId: "31822553366",
    appId: "1:31822553366:web:9fa1be91c895a8fdf8b037"
};

// 2. Constantes de Seguridad
// Eliminamos LECTOR_EMAILS y dejamos solo ADMIN
const ADMIN_EMAILS = ["quiebrakanto@gmail.com", "ebolanca@hotmail.com"]; 
// const LECTOR_EMAILS = []; // Ya no es necesario

// 3. Mapa de Usuarios (IGUAL)
const MAPA_USUARIOS = {
    "quiebrakanto@gmail.com": "Roberto",      
    "ebolanca@hotmail.com": "Roberto",        
    "aaronmg995@gmail.com": "Jazmín y Aarón", 
    "jasmiinrivas802@gmail.com": "Jazmín", 
    "flor101318@gmail.com": "Flor",
    "jhoansanch3z@gmail.com": "Jhoan",
    "ami.habtany15@gmail.com": "Amina",
    "josemartin7s.f@gmail.com": "Jose",
};

// 4. Proveedores (IGUAL)
const PROVEEDORES_LECTOR = ["Chinos", "Inde", "Vecino", "Mercadona", "Mercamadrid", "Supeco", "Makro"];

export { firebaseConfig, ADMIN_EMAILS, MAPA_USUARIOS, PROVEEDORES_LECTOR };