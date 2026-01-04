/* public/js/admin.js */
import { firebaseConfig } from './config.js';

// Inicializamos Firebase solo para esta página de Admin
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// --- AUTENTICACIÓN ADMIN ---
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById("authStatus").innerHTML = "<span style='color:green'>✅ Conectado (" + user.email + ")</span>";
        habilitarBotones();
        cargarSelectorProveedores();
    } else {
        window.location.href = "login.html"; // Si no es admin, fuera
    }
});

function habilitarBotones() {
    const btnImport = document.getElementById("btnImport");
    const btnManual = document.getElementById("btnManual");
    if(btnImport) { btnImport.innerText = "🚀 PROCESAR IMPORTACIÓN"; btnImport.disabled = false; }
    if(btnManual) { btnManual.disabled = false; }
}

// --- UTILIDADES ---
function generarIdProducto(provName, prodName) {
    const cleanProv = provName.trim().substring(0, 4).toUpperCase();
    const cleanProd = prodName.trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
    return `${cleanProv}_${cleanProd}`;
}

function normalizarResponsable(resp) {
    if (!resp || resp.toLowerCase() === "responsable") return "Todos";
    const r = resp.toLowerCase();
    if(r.includes("flor")) return "Flor";
    if(r.includes("jose") || r.includes("josé")) return "Jose";
    if(r.includes("amina")) return "Amina";
    if(r.includes("jazmin") || r.includes("aaron")) return "Jazmín y Aarón";
    if(r.includes("jhoan")) return "Jhoan";
    return resp;
}

async function cargarSelectorProveedores() {
    const sel = document.getElementById("selProveedor");
    sel.innerHTML = "<option value=''>Cargando...</option>";
    try {
        const snap = await db.collection("proveedores").get();
        const provs = [];
        snap.forEach(doc => provs.push(doc.id));
        provs.sort();
        sel.innerHTML = "<option value=''>-- Selecciona Proveedor --</option>";
        provs.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p; opt.innerText = p; sel.appendChild(opt);
        });
    } catch(e) { sel.innerHTML = "<option>Error cargando lista</option>"; }
}

// --- LECTURA DE ARCHIVO ---
function leerArchivo(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

function csvToArray(str, delimiter = ",") {
    const rows = [];
    let arr = [];
    let quote = false;
    let col = "";
    // Normalizar saltos de línea para evitar errores
    str = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < str.length; i++) {
        let cc = str[i];
        if (cc === '"') { quote = !quote; continue; }
        if (cc === delimiter && !quote) { arr.push(col.trim()); col = ""; continue; }
        if (cc === '\n' && !quote) { 
            if(col || arr.length > 0) arr.push(col.trim());
            if(arr.length > 0) rows.push(arr);
            arr = []; col = ""; continue; 
        }
        col += cc;
    }
    if(col || arr.length > 0) { arr.push(col.trim()); if(arr.length > 0) rows.push(arr); }
    return rows;
}

// --- PROCESO PRINCIPAL (CSV) ---
async function procesarImportacion() {
    const btn = document.getElementById("btnImport");
    const status = document.getElementById("status");
    const fileInput = document.getElementById("fileUpload");
    const textArea = document.getElementById("csvData");

    let rawData = "";

    // Leemos el archivo si existe, si no, leemos el textarea
    if (fileInput && fileInput.files.length > 0) {
        try {
            status.style.display = "block";
            status.className = "status info";
            status.innerHTML = "Leyendo archivo...";
            rawData = await leerArchivo(fileInput.files[0]);
        } catch (e) {
            return alert("Error leyendo el archivo: " + e.message);
        }
    } else if (textArea) {
        rawData = textArea.value.trim();
    }

    if(!rawData) return alert("❌ Selecciona un archivo CSV o pega el contenido.");

    btn.disabled = true;
    status.style.display = "block";
    status.innerHTML = "Analizando estructura...";

    try {
        const filas = csvToArray(rawData);
        const datosPorProveedor = {};
        let proveedorActual = null;
        let totalProductos = 0;

        for(let i=0; i<filas.length; i++) {
            const cols = filas[i];
            const col0 = cols[0] ? cols[0].trim() : "";
            if(!col0 || col0 === "Nombre") continue; 

            // Detectar Proveedor
            if (cols.length < 3 || (!cols[2] && !cols[3])) {
                proveedorActual = col0.replace(/[:\.]/g, '').trim();
                proveedorActual = proveedorActual.replace(/\[source.*\]/g, "").trim(); 
                if(!datosPorProveedor[proveedorActual]) {
                    datosPorProveedor[proveedorActual] = { prod: [], resp: new Set(["Roberto"]) };
                }
                continue;
            }

            if (!proveedorActual) continue;

            const nombre = col0.replace(/"/g, '');
            const resp = normalizarResponsable(cols[3] || "Todos");
            
            datosPorProveedor[proveedorActual].prod.push({
                id: generarIdProducto(proveedorActual, nombre),
                data: {
                    nombre: nombre,
                    unidad: cols[2] || "ud",
                    responsable: resp,
                    categoria: cols[4] || "General",
                    precio: cols[5] ? cols[5].trim() : "",
                    proveedor: proveedorActual
                }
            });
            datosPorProveedor[proveedorActual].resp.add(resp);
            totalProductos++;
        }

        const batch = db.batch();
        let op = 0;
        
        status.innerHTML = `Detectados ${Object.keys(datosPorProveedor).length} proveedores y ${totalProductos} productos. Subiendo...`;

        for (const [nom, dat] of Object.entries(datosPorProveedor)) {
            const provRef = db.collection("proveedores").doc(nom);
            batch.set(provRef, { actual: new Date(), responsables: Array.from(dat.resp) }, { merge: true });
            op++;

            for (const p of dat.prod) {
                // merge: true para sobreescribir datos pero mantener historial si existe
                batch.set(provRef.collection("productos").doc(p.id), p.data, { merge: true });
                op++;
                if (op >= 450) { await batch.commit(); op = 0; }
            }
        }
        if (op > 0) await batch.commit();

        status.className = "status success";
        status.innerHTML = `✅ <b>IMPORTACIÓN COMPLETADA</b><br>Se han actualizado ${totalProductos} productos.`;
        
        cargarSelectorProveedores(); // Recargar selector manual
        btn.innerText = "🚀 PROCESO FINALIZADO";
        setTimeout(() => { btn.disabled = false; btn.innerText = "🚀 PROCESAR OTRA VEZ"; }, 2000);

    } catch (e) {
        status.className = "status error";
        status.innerText = "Error Crítico: " + e.message;
        btn.disabled = false;
    }
}

async function guardarManual() {
    const prov = document.getElementById("selProveedor").value;
    const nombre = document.getElementById("mNombre").value.trim();
    if(!prov || !nombre) return alert("Faltan datos");

    try {
        const id = generarIdProducto(prov, nombre);
        await db.collection("proveedores").doc(prov).collection("productos").doc(id).set({
            nombre: nombre,
            precio: document.getElementById("mPrecio").value,
            unidad: document.getElementById("mUnidad").value || "ud",
            categoria: document.getElementById("mCategoria").value || "General",
            responsable: document.getElementById("mResponsable").value,
            proveedor: prov
        }, { merge: true });
        
        alert("✅ Producto guardado correctamente.");
        document.getElementById("mNombre").value = "";
        document.getElementById("mPrecio").value = "";
    } catch(e) { alert(e.message); }
}

// Exponemos las funciones para que funcionen los onclick del HTML
window.procesarImportacion = procesarImportacion;
window.guardarManual = guardarManual;