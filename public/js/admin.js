/* public/js/admin.js - CORREGIDO BATCH ERROR */
import { firebaseConfig } from './config.js';

// Inicializamos Firebase solo para esta página de Admin
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// --- 1. AUTENTICACIÓN ADMIN ---
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

// --- 2. UTILIDADES (IDs y Nombres) ---
function generarIdProducto(provName, prodName) {
    if(!provName || !prodName) return "error_" + Date.now();
    
    // CORRECCIÓN: Usar más caracteres o el nombre limpio completo
    const cleanProv = provName.trim().toUpperCase()
        .replace(/[^A-Z0-9]/g, "") // Quitar espacios y símbolos
        .substring(0, 10); // Usar hasta 10 chars para evitar colisiones
        
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
    return resp; // Si no coincide con ninguno, devuelve lo que venga en el CSV
}

// --- 3. LECTOR DE CSV ROBUSTO ---
function leerArchivo(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        // UTF-8 suele ir bien, pero si ves símbolos raros (), cambia "UTF-8" por "ISO-8859-1"
        reader.readAsText(file, "UTF-8"); 
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
    });
}

function csvToArray(text) {
    let p = '', row = [''], ret = [row], i = 0, r = 0, s = !0, l;
    for (l of text) {
        if ('"' === l) {
            if (s && l === p) row[i] += l;
            s = !s;
        } else if (',' === l && s) l = row[++i] = '';
        else if ('\n' === l && s) {
            if ('\r' === p) row[i] = row[i].slice(0, -1);
            row = ret[++r] = [l = '']; i = 0;
        } else row[i] += l;
        p = l;
    }
    return ret;
}

// --- 4. FUNCIÓN PRINCIPAL DE IMPORTACIÓN ---
async function procesarImportacion() {
    const btn = document.getElementById("btnImport");
    const status = document.getElementById("status");
    const fileInput = document.getElementById("fileUpload");
    const textArea = document.getElementById("csvData");

    let rawData = "";

    // A. Leer del archivo si existe
    if (fileInput && fileInput.files.length > 0) {
        try {
            status.style.display = "block";
            status.className = "status info";
            status.innerHTML = "📂 Leyendo archivo...";
            rawData = await leerArchivo(fileInput.files[0]);
        } catch (e) {
            return alert("Error al leer archivo: " + e.message);
        }
    } else if (textArea) {
        // B. Si no, leer del cuadro de texto
        rawData = textArea.value.trim();
    }

    if(!rawData) return alert("❌ Selecciona un archivo CSV o pega el contenido.");

    btn.disabled = true;
    status.innerHTML = "Analizando estructura inteligente...";
    status.style.display = "block";

    try {
        const filas = csvToArray(rawData);
        const datosPorProveedor = {};
        let proveedorActual = "Sin Proveedor"; 
        let totalProductos = 0;

        for(let i=0; i<filas.length; i++) {
            const cols = filas[i];
            // Aseguramos que col0 existe y es string
            const col0 = cols[0] ? cols[0].toString().trim() : "";
            
            // Ignorar líneas vacías o la cabecera "Nombre"
            if(!col0 || col0.toLowerCase() === "nombre") continue; 

            // === LÓGICA DE DETECCIÓN DE PROVEEDOR ===
            // Si hay texto en la primera columna, pero NO hay Unidad (col 2) ni Responsable (col 3)
            const esLineaProveedor = (!cols[2] || cols[2].trim() === "") && (!cols[3] || cols[3].trim() === "");

            if (esLineaProveedor) {
                // Limpiamos nombre (quitamos comillas extra, puntos, dos puntos)
                proveedorActual = col0.replace(/[:\.]/g, '').replace(/"/g, '').trim();
                
                // Inicializamos estructura
                if(!datosPorProveedor[proveedorActual]) {
                    datosPorProveedor[proveedorActual] = { prod: [], resp: new Set(["Roberto"]) };
                }
                continue; // Saltamos esta línea, ya sabemos el proveedor
            }

            // === ES UN PRODUCTO ===
            const nombre = col0.replace(/"/g, '');
            const resp = normalizarResponsable(cols[3] || "Todos");
            
            // Si el archivo empieza con productos sin proveedor, creamos uno genérico
            if (!datosPorProveedor[proveedorActual]) {
                 datosPorProveedor[proveedorActual] = { prod: [], resp: new Set(["Roberto"]) };
            }

            datosPorProveedor[proveedorActual].prod.push({
                id: generarIdProducto(proveedorActual, nombre),
                data: {
                    nombre: nombre,
                    unidad: cols[2] || "ud",
                    responsable: resp,
                    categoria: cols[4] || "General",
                    precio: cols[5] ? cols[5].toString().trim() : "",
                    proveedor: proveedorActual
                }
            });
            datosPorProveedor[proveedorActual].resp.add(resp);
            totalProductos++;
        }

        // --- SUBIDA A FIREBASE (CORREGIDO) ---
        // Usamos 'let' en vez de 'const' para poder renovar el batch
        let batch = db.batch(); 
        let op = 0;
        
        status.innerHTML = `Detectados <b>${Object.keys(datosPorProveedor).length} proveedores</b>.<br>Subiendo ${totalProductos} productos...`;

        for (const [nom, dat] of Object.entries(datosPorProveedor)) {
            const provRef = db.collection("proveedores").doc(nom);
            
            // 1. Guardamos el proveedor
            batch.set(provRef, { actual: new Date(), responsables: Array.from(dat.resp) }, { merge: true });
            op++;

            // 2. Guardamos sus productos
            for (const p of dat.prod) {
                batch.set(provRef.collection("productos").doc(p.id), p.data, { merge: true });
                op++;
                
                // Límite de Batch de Firebase (450 ops por seguridad)
                if (op >= 450) { 
                    await batch.commit(); // Enviamos paquete lleno
                    batch = db.batch();   // ¡IMPORTANTE! Abrimos un NUEVO paquete vacío
                    op = 0;               // Reiniciamos contador
                }
            }
        }
        // Commit final de lo que quede
        if (op > 0) await batch.commit();

        status.className = "status success";
        status.innerHTML = `✅ <b>IMPORTACIÓN COMPLETADA</b><br>Se han cargado ${totalProductos} productos en ${Object.keys(datosPorProveedor).length} proveedores.`;
        
        cargarSelectorProveedores(); // Actualizamos la lista manual de abajo
        btn.innerText = "🚀 PROCESO FINALIZADO";
        setTimeout(() => { btn.disabled = false; btn.innerText = "🚀 PROCESAR OTRA VEZ"; fileInput.value = ""; }, 3000);

    } catch (e) {
        console.error(e);
        status.className = "status error";
        status.innerText = "❌ Error: " + e.message;
        btn.disabled = false;
    }
}

// --- 5. CARGAR SELECTOR MANUAL (Para añadir productos sueltos) ---
async function cargarSelectorProveedores() {
    const sel = document.getElementById("selProveedor");
    if(!sel) return;
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

// --- 6. GUARDADO MANUAL ---
async function guardarManual() {
    const prov = document.getElementById("selProveedor").value;
    const nombre = document.getElementById("mNombre").value.trim();
    if(!prov || !nombre) return alert("Faltan datos (Proveedor y Nombre)");

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

// EXPORTACIÓN DE FUNCIONES AL HTML
window.procesarImportacion = procesarImportacion;
window.guardarManual = guardarManual;