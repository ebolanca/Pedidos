const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.resolve(__dirname, '../pedidos-service-account.json'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

// Productos exactos de la cámara de frío de Makro
const REFRIGERADOS_EXACTOS = [
    "Cinta lomo",
    "Crepes",
    "Nata agria",
    "Queso cheddar Aro",
    "Queso crema grande",
    "Queso feta Dodoni barra",
    "Queso Gouda",
    "Queso mix",
    "Queso mozzarella ( barra)",
    "Salchichas cocktail",
    "Tofu"
];

async function main() {
    const provsSnap = await db.collection('proveedores').get();
    let makroDoc = null;

    for (const doc of provsSnap.docs) {
        if (doc.id.toLowerCase() === 'makro') {
            makroDoc = doc;
            break;
        }
    }

    if (!makroDoc) {
        console.error('Proveedor Makro no encontrado.');
        return;
    }

    console.log(`Proveedor encontrado: "${makroDoc.id}"`);
    const prodsSnap = await makroDoc.ref.collection('productos').get();

    const aActualizar = [];

    prodsSnap.forEach(doc => {
        const data = doc.data();
        const nombre = (data.nombre || '').trim();
        const catActual = data.categoria || '';

        if (REFRIGERADOS_EXACTOS.includes(nombre)) {
            aActualizar.push({
                id: doc.id,
                ref: doc.ref,
                nombre,
                catAnterior: catActual
            });
        }
    });

    console.log(`\n📦 Productos a actualizar a "Refrigerados" (${aActualizar.length}):`);
    aActualizar.forEach((p, idx) => {
        console.log(` ${idx + 1}. "${p.nombre}" | Anterior: "${p.catAnterior}" ➔ Nueva: "Refrigerados"`);
    });

    const apply = process.argv.includes('--apply');
    if (apply && aActualizar.length > 0) {
        console.log(`\n⏳ Aplicando cambios en Firestore...`);
        const batch = db.batch();
        aActualizar.forEach(p => {
            batch.update(p.ref, { categoria: 'Refrigerados' });
        });
        await batch.commit();
        console.log('🎉 ¡Todos los productos han sido actualizados con éxito en Firestore!');
    } else {
        console.log('\nModo lectura. Para aplicar cambios ejecuta con --apply');
    }
}

main().catch(console.error);
