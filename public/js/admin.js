/* =============================================================
   ADMIN.JS - Lógica del Importador
   ============================================================= */
import { firebaseConfig } from './config.js';

// Inicializamos Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Lógica de Autenticación Anónima para poder escribir
auth.signInAnonymously().then(() => {
    document.getElementById("authStatus").innerHTML = "<span style='color:green'>✅ Conectado y autorizado.</span>";
    habilitarBoton();
}).catch(e => {
    console.error(e);
    let msg = "❌ Error de conexión: " + e.code;
    if(e.code === 'auth/admin-restricted-operation' || e.code === 'auth/operation-not-allowed') {
        msg += "<br>👉 <b>SOLUCIÓN:</b> Activa 'Anónimo' en Authentication > Sign-in method en la consola Firebase.";
    }
    document.getElementById("authStatus").innerHTML = "<span style='color:red'>" + msg + "</span>";
});

// Chequeo de seguridad por si tarda mucho
setTimeout(() => {
    const btn = document.getElementById("btnImport");
    if(btn && btn.disabled && !btn.innerText.includes("SUBIR")) {
        const status = document.getElementById("authStatus");
        if(status) status.innerHTML += "<br><span style='color:orange'>⚠️ Tardando mucho... Revisa tu conexión.</span>";
    }
}, 5000);

function habilitarBoton() {
    const btn = document.getElementById("btnImport");
    if(btn) {
        btn.innerText = "🚀 SUBIR DATOS A FIREBASE";
        btn.disabled = false;
    }
}

// --- FUNCIÓN DE PARSEO CSV ---
function csvToArray(str, delimiter = ",") {
    const rows = [];
    let arr = [];
    let quote = false;
    let col = "";
    let startIdx = str.indexOf("\n") + 1;
    if(startIdx === 0) startIdx = 0; 

    for (let i = startIdx; i < str.length; i++) {
        let cc = str[i];
        if (cc === '"') { quote = !quote; continue; }
        if (cc === delimiter && !quote) { arr.push(col.trim()); col = ""; continue; }
        if ((cc === '\r' || cc === '\n') && !quote) { 
            if(col || arr.length > 0) arr.push(col.trim());
            if(arr.length > 0) rows.push(arr);
            arr = []; col = ""; continue; 
        }
        col += cc;
    }
    if(col || arr.length > 0) { arr.push(col.trim()); if(arr.length > 0) rows.push(arr); }
    return rows;
}

// --- FUNCIÓN PRINCIPAL DE IMPORTACIÓN ---
async function procesarImportacion() {
    const btn = document.getElementById("btnImport");
    const status = document.getElementById("status");
    const provNameInput = document.getElementById("provName");
    const csvDataInput = document.getElementById("csvData");

    const provName = provNameInput.value.trim();
    const rawData = csvDataInput.value.trim();

    if(!provName) return alert("❌ Escribe el nombre del proveedor.");
    if(!rawData) return alert("❌ Pega el contenido del CSV.");

    btn.disabled = true;
    btn.innerText = "⏳ Procesando...";
    status.className = "status info";
    status.style.display = "block"; // Asegurar que se ve
    status.innerHTML = "Analizando CSV...";

    try {
        const filas = csvToArray(rawData);
        if(filas.length === 0) throw new Error("No se han detectado filas. Revisa el formato.");

        status.innerHTML = `Detectadas ${filas.length} filas. Subiendo a la nube...`;

        const batch = db.batch();
        const responsablesSet = new Set();
        responsablesSet.add("Roberto"); 
        
        let count = 0;

        filas.forEach((cols, index) => {
            let nombre = cols[0];
            if(!nombre && cols[3]) nombre = cols[3]; 
            if(!nombre || nombre.toLowerCase() === "producto" || nombre.match(/^,+$/)) return;

            let unidad = cols[2] || "ud";
            let resp = cols[3] || "Todos";
            let cat = cols[4] || "General";
            // PRECIO (COLUMNA 5)
            let precio = cols[5] ? cols[5].trim() : "";

            if(resp.includes("@")) {
                if(resp.includes("flor")) resp = "Flor";
                else if(resp.includes("jose")) resp = "Jose";
                else if(resp.includes("amina")) resp = "Amina";
                else if(resp.includes("jazmin") || resp.includes("aaron")) resp = "Jazmín y Aarón";
                else if(resp.includes("cris")) resp = "Cristina";
                else if(resp.includes("jhoan")) resp = "Jhoan";
                else if(resp.includes("enrique") || resp.includes("ebolanca")) resp = "Enrique";
            }
            if(!resp || resp === "Responsable") resp = "Todos";

            responsablesSet.add(resp);

            const idDoc = provName.substring(0,3).toUpperCase() + "_" + index + "_" + nombre.substring(0,5).replace(/[^a-zA-Z0-9]/g,'');
            const ref = db.collection("proveedores").doc(provName).collection("productos").doc(idDoc);
            
            batch.set(ref, {
                nombre: nombre.replace(/"/g, ''),
                unidad: unidad,
                responsable: resp,
                categoria: cat,
                precio: precio,
                proveedor: provName
            });
            count++;
        });

        await db.collection("proveedores").doc(provName).set({
            creado: new Date(),
            responsables: Array.from(responsablesSet)
        }, { merge: true });

        await batch.commit();

        status.className = "status success";
        status.innerHTML = `<b>✅ ¡SUBIDA COMPLETADA!</b><br>Proveedor: <strong>${provName}</strong><br>Productos subidos: <strong>${count}</strong><br>Responsables: ${Array.from(responsablesSet).join(", ")}`;
        
        csvDataInput.value = "";
        provNameInput.value = "";
        setTimeout(() => { btn.innerText = "🚀 SUBIR OTRO"; btn.disabled = false; }, 2000);
        
    } catch (e) {
        console.error(e);
        status.className = "status error";
        status.innerText = "❌ ERROR: " + e.message;
        btn.disabled = false;
        btn.innerText = "🚀 INTENTAR DE NUEVO";
    }
}

// Exponemos la función al window para el onclick del HTML
window.procesarImportacion = procesarImportacion;