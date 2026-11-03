const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.resolve(__dirname, '../pedidos-service-account.json'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

function generarIdProducto(provName, prodName) {
    if (!provName || !prodName) return "error_" + Date.now();
    const cleanProv = provName.trim().toUpperCase()
        .replace(/[^A-Z0-9]/g, "") 
        .substring(0, 10);
    const cleanProd = prodName.trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
        .replace(/[^a-z0-9]/g, ""); 
    return `${cleanProv}_${cleanProd}`;
}

const NUEVOS_PRODUCTOS_MAKRO = [
    {
        nombre: "Margarina 5kg",
        unidad: "Cubo",
        categoria: "Refrigerados",
        responsable: "Jazmín",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 4
    },
    {
        nombre: "Mantequilla monodosis",
        unidad: "Caja",
        categoria: "Refrigerados",
        responsable: "Jazmín",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 4
    },
    {
        nombre: "Mermelada fresa",
        unidad: "Caja",
        categoria: "Conservas, Salsas y Encurtidos",
        responsable: "Amina",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 10
    },
    {
        nombre: "Mermelada melocotón",
        unidad: "Caja",
        categoria: "Conservas, Salsas y Encurtidos",
        responsable: "Amina",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 10
    },
    {
        nombre: "Ketchup monodosis",
        unidad: "Caja",
        categoria: "Conservas, Salsas y Encurtidos",
        responsable: "Jazmín",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 10
    },
    {
        nombre: "Mayonesa monodosis",
        unidad: "Caja",
        categoria: "Conservas, Salsas y Encurtidos",
        responsable: "Jazmín",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 10
    },
    {
        nombre: "Nescafé",
        unidad: "Paquete",
        categoria: "Bebidas y Cafés",
        responsable: "Amina",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 10
    },
    {
        nombre: "Cola Cao",
        unidad: "Paquete",
        categoria: "Panadería y Repostería",
        responsable: "Amina",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 10
    },
    {
        nombre: "Levadura Royal",
        unidad: "Bote",
        categoria: "Panadería y Repostería",
        responsable: "Jazmín",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 10
    },
    {
        nombre: "Vinagre monodosis",
        unidad: "Caja",
        categoria: "Condimentos y Especias",
        responsable: "Aarón",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 10
    },
    {
        nombre: "Nata líquida montar 35%",
        unidad: "Unidad",
        categoria: "Refrigerados",
        responsable: "Jazmín",
        proveedor: "Makro",
        precio: "",
        precioAnterior: "",
        historialPrecios: [],
        peso: "",
        iva: 4
    }
];

async function main() {
    console.log("Iniciando alta de productos en Makro...");
    const makroRef = db.collection('proveedores').doc('Makro');
    const prodsCol = makroRef.collection('productos');

    const batch = db.batch();

    for (const prod of NUEVOS_PRODUCTOS_MAKRO) {
        const docId = generarIdProducto("Makro", prod.nombre);
        const docRef = prodsCol.doc(docId);
        
        console.log(`-> Registrando: [${docId}] "${prod.nombre}" (${prod.categoria}) | Resp: ${prod.responsable} | Unidad: ${prod.unidad}`);
        batch.set(docRef, prod, { merge: true });
    }

    await batch.commit();
    console.log(`\n🎉 ¡Se han dado de alta los ${NUEVOS_PRODUCTOS_MAKRO.length} productos en Makro con éxito!`);
}

main().catch(console.error);

