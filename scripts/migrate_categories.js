const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.resolve(__dirname, '../pedidos-service-account.json'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

// =========================================================================
// TAXONOMÍA MAESTRA DE CATEGORÍAS GENÉRICAS
// =========================================================================
const CATEGORIAS_OFICIALES = [
    "Frutas y Verduras",
    "Carnes y Aves",
    "Pescados y Mariscos",
    "Lácteos y Huevos",
    "Panadería y Repostería",
    "Despensa y Secos",
    "Condimentos y Especias",
    "Conservas, Salsas y Encurtidos",
    "Bebidas y Cafés",
    "Bodega y Alcoholes",
    "Congelados y Elaborados",
    "Limpieza y Químicos",
    "Menaje y Utensilios",
    "Desechables y Envases",
    "Oficina y Mantenimiento"
];

// Mapeo directo de las categorías antiguas ultra-específicas a las genéricas
const MAPA_CATEGORIAS_EXISTENTES = {
    // Frutas y verduras
    "Fruta": "Frutas y Verduras",
    "Verdura": "Frutas y Verduras",
    "Hierbas": "Frutas y Verduras",

    // Carnes
    "Carnes": "Carnes y Aves",

    // Pescados
    "Pescado": "Pescados y Mariscos",
    "Surimi": "Pescados y Mariscos",

    // Lácteos
    "Lácteos": "Lácteos y Huevos",
    "Queso": "Lácteos y Huevos",
    "Quesos": "Lácteos y Huevos",
    "Leche": "Lácteos y Huevos",

    // Panadería y repostería
    "Panadería": "Panadería y Repostería",
    "Harina": "Panadería y Repostería",
    "Repostería": "Panadería y Repostería",
    "Dulces": "Panadería y Repostería",
    "Galletas": "Panadería y Repostería",
    "Cacao": "Panadería y Repostería",
    "Levadura": "Panadería y Repostería",
    "Tempura": "Panadería y Repostería",

    // Despensa y secos
    "Arroz": "Despensa y Secos",
    "Fideos": "Despensa y Secos",
    "Sésamo": "Despensa y Secos",
    "FrutosSecos": "Despensa y Secos",
    "Snacks": "Despensa y Secos",
    "Azúcar": "Despensa y Secos",
    "Edulcorante": "Despensa y Secos",
    "Caldo": "Despensa y Secos",

    // Condimentos, especias y aceites
    "Especias": "Condimentos y Especias",
    "Curry": "Condimentos y Especias",
    "Aceite": "Condimentos y Especias",
    "Vinagre": "Condimentos y Especias",
    "Aliños": "Condimentos y Especias",

    // Conservas y salsas
    "Conservas": "Conservas, Salsas y Encurtidos",
    "Salsas": "Conservas, Salsas y Encurtidos",
    "Salsa": "Conservas, Salsas y Encurtidos",
    "Soja": "Conservas, Salsas y Encurtidos",
    "Mermelada": "Conservas, Salsas y Encurtidos",
    "Trufa": "Conservas, Salsas y Encurtidos",
    "Algas": "Conservas, Salsas y Encurtidos",

    // Bebidas no alcohólicas
    "Refresco": "Bebidas y Cafés",
    "Café": "Bebidas y Cafés",
    "Infusión": "Bebidas y Cafés",
    "Zumo": "Bebidas y Cafés",
    "Mosto": "Bebidas y Cafés",
    "Energético": "Bebidas y Cafés",
    "Bebidas": "Bebidas y Cafés",
    "Mix": "Bebidas y Cafés",

    // Bodega y alcoholes
    "Cerveza": "Bodega y Alcoholes",
    "Vino": "Bodega y Alcoholes",
    "Cava": "Bodega y Alcoholes",
    "Sidra": "Bodega y Alcoholes",
    "Licor": "Bodega y Alcoholes",
    "Ginebra": "Bodega y Alcoholes",
    "Ron": "Bodega y Alcoholes",
    "Whisky": "Bodega y Alcoholes",
    "Brandy": "Bodega y Alcoholes",
    "Vodka": "Bodega y Alcoholes",
    "Aguardiente": "Bodega y Alcoholes",
    "Vermut": "Bodega y Alcoholes",
    "Tequila": "Bodega y Alcoholes",
    "Sake": "Bodega y Alcoholes",

    // Congelados y elaborados
    "Congelado": "Congelados y Elaborados",
    "Gyoza": "Congelados y Elaborados",
    "Pulpa": "Congelados y Elaborados",

    // Limpieza
    "Limpieza": "Limpieza y Químicos",
    "Plagas": "Limpieza y Químicos",

    // Menaje y utensilios
    "Menaje": "Menaje y Utensilios",
    "Utensilios": "Menaje y Utensilios",
    "Cristalería": "Menaje y Utensilios",
    "Almacenaje": "Menaje y Utensilios",
    "Piedra": "Menaje y Utensilios",

    // Desechables
    "Desechables": "Desechables y Envases",

    // Oficina
    "Oficina": "Oficina y Mantenimiento",
    "Gas": "Oficina y Mantenimiento"
};

// =========================================================================
// CLASIFICACIÓN INTELIGENTE DE PRODUCTOS EN "GENERAL" O SIN CATEGORÍA
// =========================================================================
function clasificarProductoGeneral(nombre, proveedor, unidad) {
    const n = (nombre || '').toLowerCase();
    const p = (proveedor || '').toLowerCase();

    // 1. Hiper Usera específico
    if (p.includes('usera')) {
        if (/az[uú]car/i.test(n)) return "Despensa y Secos";
        if (/\bsal\b/i.test(n)) return "Despensa y Secos";
        if (/cebolla caramelizada/i.test(n)) return "Conservas, Salsas y Encurtidos";
    }

    // 2. Proveedores especializados enteros
    if (p === 'argal') return "Carnes y Aves";
    if (p === 'hnos maqueda' || p === 'norteños') return "Carnes y Aves";
    if (p === 'coca cola') return "Bebidas y Cafés";
    if (p === 'cerroliva') return "Condimentos y Especias";
    if (p === 'brillante') return "Desechables y Envases";
    if (p === 'huevos') return "Lácteos y Huevos";
    if (p === 'hielo') return "Bebidas y Cafés";
    if (p === 'mojitos') return "Bodega y Alcoholes";
    if (p === 'pan el mimbre') return "Panadería y Repostería";
    if (p === 'tequebox') return "Congelados y Elaborados";

    // 3. Proveedor 105 (oriental / congelados / pescados)
    if (p === '105') {
        if (n.includes('dorayaki') || n.includes('mochicream')) return "Panadería y Repostería";
        if (n.includes('gyoza')) return "Congelados y Elaborados";
        if (n.includes('ebi') || n.includes('langostino') || n.includes('escolar') || n.includes('surimi') || n.includes('tobiko')) return "Pescados y Mariscos";
        if (n.includes('edamame') || n.includes('wakame')) return "Frutas y Verduras";
        return "Congelados y Elaborados";
    }

    // 4. Proveedor Argal (chacinería y embutidos)
    if (p === 'argal') return "Carnes y Aves";

    // 5. Proveedor Distr La Mancha
    if (p.includes('mancha')) {
        if (n.includes('servilleta')) return "Desechables y Envases";
        return "Limpieza y Químicos";
    }

    // 6. Proveedor Disbesa
    if (p === 'disbesa') {
        if (n.includes('cuajada') || n.includes('queso')) return "Lácteos y Huevos";
        if (n.includes('sal') || n.includes('vinagre')) return "Despensa y Secos";
    }

    // 7. Proveedor Goya
    if (p === 'goya') {
        if (n.includes('frijol') || n.includes('tortilla')) return "Despensa y Secos";
        if (n.includes('jalapeño') || n.includes('picante')) return "Conservas, Salsas y Encurtidos";
        if (n.includes('vainilla')) return "Panadería y Repostería";
    }

    // 8. Proveedor Supeco
    if (p === 'supeco') {
        if (n.includes('arroz') || n.includes('espiral')) return "Despensa y Secos";
        if (n.includes('galleta')) return "Panadería y Repostería";
        if (n.includes('gaseosa')) return "Bebidas y Cafés";
        if (n.includes('pollo') || n.includes('hamburguesa')) return "Carnes y Aves";
    }

    // 9. Proveedor Día
    if (p === 'día' || p === 'dia') {
        if (n.includes('vermouth') || n.includes('vino')) return "Bodega y Alcoholes";
    }

    // Reglas semánticas generales por nombre
    if (/cerveza|vino|licor|ron|vodka|ginebra|whisky|brandy|cava|sidra|vermut|vermouth|tequila|sake/i.test(n)) return "Bodega y Alcoholes";
    if (/refresco|cola|fanta|sprite|nestea|aquarius|agua|café|cafe|infusion|infusión|zumo|mosto/i.test(n)) return "Bebidas y Cafés";
    if (/carne|pollo|ternera|cerdo|bacon|jamon|jamón|salchicha|lomo|alita|hamburguesa/i.test(n)) return "Carnes y Aves";
    if (/pescado|salmon|salmón|atun|atún|langostino|gamba|merluza|surimi|calamar|pulpo/i.test(n)) return "Pescados y Mariscos";
    if (/leche|queso|nata|yogur|mantequilla|cuajada|huevo/i.test(n)) return "Lácteos y Huevos";
    if (/pan|harina|galleta|bollo|tarta|dulce|bizcocho|croissant|brioche/i.test(n)) return "Panadería y Repostería";
    if (/arroz|pasta|fideo|macarron|espagueti|legumbre|garbanzo|lenteja|azucar|azúcar|sal/i.test(n)) return "Despensa y Secos";
    if (/aceite|vinagre|pimienta|oregano|orégano|pimenton|curry|comino|salero|especias/i.test(n)) return "Condimentos y Especias";
    if (/salsa|mayonesa|ketchup|tomate frito|conserva|lata|pepinillo|aceituna|mermelada/i.test(n)) return "Conservas, Salsas y Encurtidos";
    if (/lejia|lejía|fregona|jabon|jabón|lavavajillas|desengrasante|limpiador|ambientador/i.test(n)) return "Limpieza y Químicos";
    if (/servilleta|papel|bolsa|film|aluminio|envase|tarrina|vaso plastico|pajita/i.test(n)) return "Desechables y Envases";
    if (/plato|vaso|copa|cubierto|cuchillo|tenedor|sarten|sartén|olla|tabla/i.test(n)) return "Menaje y Utensilios";
    if (/patata|tomate|lechuga|cebolla|ajo|zanahoria|manzana|naranja|limon|limón|aguacate/i.test(n)) return "Frutas y Verduras";

    return "Despensa y Secos"; // Por defecto seguro en vez de 'General'
}

// =========================================================================
// FUNCIÓN PRINCIPAL DE MIGRACIÓN
// =========================================================================
async function ejecutarMigracion(aplicarCambios = false) {
    console.log("==========================================================");
    console.log(`🚀 INICIANDO MIGRACIÓN DE CATEGORÍAS (${aplicarCambios ? 'MODO REAL' : 'MODO DRY-RUN'})`);
    console.log("==========================================================\n");

    const provsSnap = await db.collection('proveedores').get();
    let totalExaminados = 0;
    let totalModificados = 0;
    let totalSinCambio = 0;

    const estadisticasNuevaCat = {};
    const cambiosDetalle = [];

    for (const provDoc of provsSnap.docs) {
        const provId = provDoc.id;
        const prodsSnap = await db.collection('proveedores').doc(provId).collection('productos').get();

        for (const prodDoc of prodsSnap.docs) {
            totalExaminados++;
            const data = prodDoc.data();
            const catActual = (data.categoria || 'General').trim();
            const nombre = data.nombre || '';
            const unidad = data.unidad || '';

            let catNueva = null;

            // Caso A: Está en General o vacío
            if (catActual === 'General' || catActual === '') {
                catNueva = clasificarProductoGeneral(nombre, provId, unidad);
            } 
            // Caso B: Ya tenía una categoría existente
            else if (MAPA_CATEGORIAS_EXISTENTES[catActual]) {
                catNueva = MAPA_CATEGORIAS_EXISTENTES[catActual];
            } 
            // Caso C: Ya coincide exactamente con una de las oficiales
            else if (CATEGORIAS_OFICIALES.includes(catActual)) {
                catNueva = catActual;
            } 
            // Caso D: Desconocida
            else {
                catNueva = clasificarProductoGeneral(nombre, provId, unidad);
            }

            estadisticasNuevaCat[catNueva] = (estadisticasNuevaCat[catNueva] || 0) + 1;

            if (catActual !== catNueva) {
                totalModificados++;
                cambiosDetalle.push({
                    proveedor: provId,
                    producto: nombre,
                    docPath: `proveedores/${provId}/productos/${prodDoc.id}`,
                    docRef: prodDoc.ref,
                    anterior: catActual,
                    nueva: catNueva
                });
            } else {
                totalSinCambio++;
            }
        }
    }

    if (aplicarCambios && cambiosDetalle.length > 0) {
        console.log(`⏳ Aplicando ${cambiosDetalle.length} cambios en Firestore en batches...`);
        const BATCH_SIZE = 450;
        for (let i = 0; i < cambiosDetalle.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = cambiosDetalle.slice(i, i + BATCH_SIZE);
            chunk.forEach(c => {
                batch.update(c.docRef, { categoria: c.nueva });
            });
            await batch.commit();
            console.log(`  💾 Lote guardado: ${Math.min(i + BATCH_SIZE, cambiosDetalle.length)} / ${cambiosDetalle.length}`);
        }
    }

    console.log(`\n📦 Total productos examinados: ${totalExaminados}`);
    console.log(`✨ Productos actualizados: ${totalModificados}`);
    console.log(`✅ Productos que ya estaban correctos: ${totalSinCambio}\n`);

    console.log("--- MUESTRA DE CAMBIOS (Primeros 30) ---");
    cambiosDetalle.slice(0, 30).forEach((c, idx) => {
        console.log(`${idx + 1}. [${c.proveedor}] "${c.producto}": "${c.anterior}" ➔ "${c.nueva}"`);
    });

    console.log("\n--- PRODUCTOS DE HIPER USERA ---");
    cambiosDetalle.filter(c => c.proveedor.toLowerCase().includes('usera')).forEach(c => {
        console.log(`• [${c.proveedor}] "${c.producto}": "${c.anterior}" ➔ "${c.nueva}"`);
    });

    console.log("\n--- DISTRIBUCIÓN FINAL EN LAS CATEGORÍAS MAESTRAS ---");
    for (const [cat, count] of Object.entries(estadisticasNuevaCat).sort((a,b) => b[1] - a[1])) {
        console.log(`• ${cat}: ${count} productos`);
    }

    if (aplicarCambios) {
        console.log("\n🎉 ¡MIGRACIÓN COMPLETADA CON ÉXITO EN FIRESTORE!");
    } else {
        console.log("\nℹ️  Ejecución en modo DRY-RUN completada. No se ha modificado nada en Firestore.");
        console.log("   Para aplicar los cambios reales, ejecuta con: node scripts/migrate_categories.js --apply");
    }
}

const aplicar = process.argv.includes('--apply');
ejecutarMigracion(aplicar).catch(console.error);
