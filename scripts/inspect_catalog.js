const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.resolve(__dirname, '../pedidos-service-account.json'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function main() {
    const provsSnap = await db.collection('proveedores').get();
    console.log(`Proveedores encontrados en Firestore: ${provsSnap.size}`);

    const categoriesCount = {};
    const sampleByCat = {};
    let totalProds = 0;

    for (const provDoc of provsSnap.docs) {
        const provId = provDoc.id;
        const prodsSnap = await db.collection('proveedores').doc(provId).collection('productos').get();
        totalProds += prodsSnap.size;

        prodsSnap.forEach(doc => {
            const data = doc.data();
            const cat = data.categoria || '(sin categoría / General)';
            const nombre = data.nombre || 'Sin nombre';

            categoriesCount[cat] = (categoriesCount[cat] || 0) + 1;
            if (!sampleByCat[cat]) sampleByCat[cat] = [];
            if (sampleByCat[cat].length < 4) {
                sampleByCat[cat].push(`[${provId}] ${nombre}`);
            }
        });
    }

    console.log(`\nTotal productos en catálogo: ${totalProds}`);
    console.log('\n--- CATEGORÍAS ACTUALES Y CONTEO ---');
    for (const [cat, count] of Object.entries(categoriesCount).sort((a,b) => b[1] - a[1])) {
        console.log(`• "${cat}" (${count} prods): ${sampleByCat[cat].join(', ')}`);
    }
}

main().catch(console.error);
