const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json');
const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const token = conf.tokens.access_token;
const PROJECT_ID = 'pedidos-rail-app-2025-87f2c';

const DESCRIPTORS_NOISE = [
    'bebida', 'cerveza', 'salsa', 'envase', 'producto', 'caja', 'paquete', 'botella', 
    'pack', 'lata', 'barra', 'bolsa', 'bandeja', 'formato', 'con', 'sin', 'de', 
    'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'llevar', 'en'
];

const FLAVOR_COLORS = [
    'blue', 'pink', 'red', 'green', 'black', 'white', 'azul', 'rosa', 'rojo', 
    'limon', 'naranja', 'fresa', 'melocoton', 'maracuya', 'mango', 'pina', 'cola',
    'zero', 'light', 'original', 'clasica', 'tostada'
];

function extraerPalabrasClave(str) {
    if (!str) return [];
    return str.toString().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, ' ')
        .split(/\s+/)
        .map(w => {
            let res = w;
            // Plural simple
            if (res.endsWith('s') && res.length > 3) res = res.slice(0, -1);
            // Diminutivos comunes (zumitos -> zumo, etc.)
            if (res.endsWith('ito') && res.length > 4) res = res.slice(0, -3) + 'o';
            if (res.endsWith('ita') && res.length > 4) res = res.slice(0, -3) + 'a';
            // Normalización fonética suave (z -> c, v -> b)
            res = res.replace(/z/g, 'c').replace(/v/g, 'b');
            return res;
        })
        .filter(w => w && !DESCRIPTORS_NOISE.includes(w));
}

function extraerCapacidades(str) {
    if (!str) return [];
    const norm = str.toLowerCase().replace(/(\d+)\s+(cl|ml|kg|g|l|cm|ud)/g, '$1$2');
    return (norm.match(/\d+(?:[.,]\d+)?(?:cl|ml|kg|g|l|cm|ud)?/gi) || []).map(x => x.toLowerCase());
}

function calcularScoreCoincidenciaAvanzado(appStr, appUnit, sheetStr, sheetUnit) {
    const wApp = extraerPalabrasClave(appStr);
    const wSheet = extraerPalabrasClave(sheetStr);
    if (wApp.length === 0 || wSheet.length === 0) return 0;

    const numApp = extraerCapacidades(appStr);
    const numSheet = extraerCapacidades(sheetStr);

    let numBonus = 0;
    if (numApp.length > 0 && numSheet.length > 0) {
        const numMatch = numApp.every(n => numSheet.includes(n));
        if (!numMatch) return 0; // Conflicto de tamaño numérico (ej: 1.5L vs 2L o 10cl vs 20cl)
        numBonus = 0.4;
    }

    // Comprobar coincidencia de palabras raíz
    let matches = 0;
    let coreBrandMatched = false;

    wApp.forEach(w => {
        const matchFound = wSheet.some(x => x === w || (w.length >= 4 && x.length >= 4 && (x.includes(w) || w.includes(x))));
        if (matchFound) {
            matches++;
            if (!FLAVOR_COLORS.includes(w)) {
                coreBrandMatched = true;
            }
        }
    });

    if (!coreBrandMatched && matches === 0) return 0;

    // Si coincide la marca principal (ej. "Salitos"), las variantes de sabor ("blue", "pink") son match positivo
    let score = (matches / Math.max(wApp.length, wSheet.length)) + numBonus;
    if (coreBrandMatched && wApp.some(w => FLAVOR_COLORS.includes(w)) && !wSheet.some(w => FLAVOR_COLORS.includes(w))) {
        score += 0.35; // Bonificación de variante
    }

    // Compatibilidad de caja
    const appEsCaja = (appUnit && appUnit.toLowerCase().includes('caja')) || appStr.toLowerCase().includes('caja');
    const sheetEsCaja = sheetStr.toLowerCase().includes('caja');
    if (appEsCaja && sheetEsCaja) score += 0.3;
    if (!appEsCaja && sheetEsCaja) score -= 0.2;

    return score;
}

function parseCSVLine(line) {
    const cols = [];
    let inQuotes = false;
    let cur = '';
    for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === '"') {
            if (inQuotes && line[c+1] === '"') { cur += '"'; c++; }
            else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
            cols.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    cols.push(cur.trim());
    return cols;
}

function parsearPrecio(str) {
    if (!str) return null;
    const cleaned = str.toString().replace(/[€\s"]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return (isNaN(num) || num <= 0) ? null : Math.round(num * 100) / 100;
}

function httpsGet(urlPath) {
    return new Promise((resolve, reject) => {
        https.get({
            hostname: 'firestore.googleapis.com',
            path: urlPath,
            headers: { 'Authorization': 'Bearer ' + token }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
    });
}

const url = 'https://docs.google.com/spreadsheets/d/1B77f3gIVm-jx87fwy4nxM_8ZJp37V0eir6lyu_4ERME/gviz/tq?tqx=out:csv&gid=1786108103';

https.get(url, (res) => {
    let csv = '';
    res.on('data', c => csv += c);
    res.on('end', async () => {
        const lines = csv.split(/\r?\n/);
        const sheetRows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVLine(lines[i]);
            if (cols[0] && cols[7]) {
                sheetRows.push({
                    nombre: cols[0],
                    cantidad: cols[1],
                    unidad: cols[2],
                    precioSinIva: parsearPrecio(cols[3]),
                    precioConIva: parsearPrecio(cols[4]),
                    precioKgSinIva: parsearPrecio(cols[5]),
                    precioKgConIva: parsearPrecio(cols[6]),
                    proveedor: cols[7],
                    categoria: cols[8]
                });
            }
        }

        const prodsVecino = await httpsGet('/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/proveedores/Vecino/productos?pageSize=300');
        const list = prodsVecino.documents || [];
        const sheetVecino = sheetRows.filter(r => r.proveedor.toLowerCase().includes('vecino'));

        console.log(`--- PRUEBA DE COINCIDENCIAS PARA VECINO (${list.length} productos en app) ---`);
        list.forEach(p => {
            const f = p.fields || {};
            const appName = f.nombre?.stringValue || '';
            const appUnit = f.unidad?.stringValue || '';

            let bestScore = 0;
            let bestMatch = null;

            sheetVecino.forEach(s => {
                const score = calcularScoreCoincidenciaAvanzado(appName, appUnit, s.nombre, s.unidad);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = s;
                }
            });

            if (bestScore >= 0.5 && bestMatch) {
                console.log(`✅ MATCH [${(bestScore*100).toFixed(0)}%]: "${appName}" (${appUnit}) ➔ "${bestMatch.nombre}" (${bestMatch.cantidad} ${bestMatch.unidad}) | Precio Sin IVA: ${bestMatch.precioSinIva}€ | Con IVA: ${bestMatch.precioConIva}€ | Unit: ${bestMatch.precioKgSinIva}€ / ${bestMatch.precioKgConIva}€`);
            } else {
                console.log(`❌ NO MATCH: "${appName}" (${appUnit}) (Best: ${bestMatch ? bestMatch.nombre : 'none'} - ${(bestScore*100).toFixed(0)}%)`);
            }
        });
    });
});
