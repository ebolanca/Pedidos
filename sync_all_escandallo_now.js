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
            if (res.endsWith('s') && res.length > 3) res = res.slice(0, -1);
            if (res.endsWith('ito') && res.length > 4) res = res.slice(0, -3) + 'o';
            if (res.endsWith('ita') && res.length > 4) res = res.slice(0, -3) + 'a';
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

function matchScore(appStr, appUnit, sheetStr) {
    const wApp = extraerPalabrasClave(appStr);
    const wSheet = extraerPalabrasClave(sheetStr);
    if (wApp.length === 0 || wSheet.length === 0) return 0;

    const numApp = extraerCapacidades(appStr);
    const numSheet = extraerCapacidades(sheetStr);

    let numBonus = 0;
    if (numApp.length > 0 && numSheet.length > 0) {
        const numMatch = numApp.every(n => numSheet.includes(n));
        if (!numMatch) return 0;
        numBonus = 0.4;
    }

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

    let score = (matches / Math.max(wApp.length, wSheet.length)) + numBonus;
    if (coreBrandMatched && wApp.some(w => FLAVOR_COLORS.includes(w)) && !wSheet.some(w => FLAVOR_COLORS.includes(w))) {
        score += 0.35;
    }

    const appEsCaja = (appUnit && appUnit.toLowerCase().includes('caja')) || appStr.toLowerCase().includes('caja');
    const sheetEsCaja = sheetStr.toLowerCase().includes('caja');
    if (appEsCaja && sheetEsCaja) score += 0.3;
    if (!appEsCaja && sheetEsCaja) score -= 0.2;

    return score;
}

function parsearPrecio(str) {
    if (!str) return null;
    const cleaned = str.toString().replace(/[€\s"]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return (isNaN(num) || num <= 0) ? null : Math.round(num * 100) / 100;
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

function calcularTipoIVA(precioSinIva, precioConIva) {
    if (!precioSinIva || !precioConIva || precioSinIva <= 0 || precioConIva <= 0) return null;
    const ratio = precioConIva / precioSinIva;
    if (ratio < 1.01) return 0;
    if (ratio <= 1.07) return 4;
    if (ratio <= 1.16) return 10;
    return 21;
}

function httpsRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

const url = 'https://docs.google.com/spreadsheets/d/1B77f3gIVm-jx87fwy4nxM_8ZJp37V0eir6lyu_4ERME/gviz/tq?tqx=out:csv&gid=1786108103';

async function run() {
    console.log("📥 Descargando Escandallo...");
    const resCSV = await httpsRequest(url);
    const lines = resCSV.body.split(/\r?\n/);
    const sheetRows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols[0] && cols[7]) {
            const pSin = parsearPrecio(cols[3]);
            const pCon = parsearPrecio(cols[4]);
            sheetRows.push({
                nombre: cols[0],
                cantidad: cols[1],
                unidad: cols[2],
                precioSinIva: pSin,
                precioConIva: pCon,
                precioKgSinIva: parsearPrecio(cols[5]),
                precioKgConIva: parsearPrecio(cols[6]),
                ivaCalculado: calcularTipoIVA(pSin, pCon),
                proveedor: cols[7],
                categoria: cols[8]
            });
        }
    }
    console.log(`📊 Total filas en Google Sheets: ${sheetRows.length}`);

    // Obtener proveedores de Firestore
    const resProvs = await httpsRequest({
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/proveedores?pageSize=100',
        headers: { 'Authorization': 'Bearer ' + token }
    });
    const provDocs = JSON.parse(resProvs.body).documents || [];
    console.log(`🏢 Proveedores en Firestore: ${provDocs.length}`);

    let totalActualizados = 0;

    for (const pDoc of provDocs) {
        const provId = pDoc.name.split('/').pop();
        const resProds = await httpsRequest({
            hostname: 'firestore.googleapis.com',
            path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/proveedores/${encodeURIComponent(provId)}/productos?pageSize=300`,
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const prods = JSON.parse(resProds.body).documents || [];
        const provSheetRows = sheetRows.filter(r => {
            const normP = extraerPalabrasClave(provId).join(' ');
            const normS = extraerPalabrasClave(r.proveedor).join(' ');
            return normP.includes(normS) || normS.includes(normP);
        });

        if (provSheetRows.length === 0) continue;

        for (const prod of prods) {
            const f = prod.fields || {};
            const appName = f.nombre ? f.nombre.stringValue : '';
            const appUnit = f.unidad ? f.unidad.stringValue : '';
            const prodDocPath = prod.name.replace(`projects/${PROJECT_ID}/databases/(default)/documents/`, '');

            let bestScore = 0;
            let bestMatch = null;

            provSheetRows.forEach(s => {
                const score = matchScore(appName, appUnit, s.nombre);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = s;
                }
            });

            if (bestScore >= 0.5 && bestMatch && bestMatch.precioSinIva > 0) {
                const isSuper = ['supeco', 'hiper usera', 'mercadona'].some(s => provId.toLowerCase().includes(s));
                const nuevoPrecio = isSuper ? bestMatch.precioConIva : bestMatch.precioSinIva;
                const nuevoIva = bestMatch.ivaCalculado;

                const escandalloInfo = {
                    cantidad: bestMatch.cantidad || '',
                    unidad: bestMatch.unidad || '',
                    precioSinIva: bestMatch.precioSinIva,
                    precioConIva: bestMatch.precioConIva,
                    precioKgSinIva: bestMatch.precioKgSinIva,
                    precioKgConIva: bestMatch.precioKgConIva,
                    proveedor: bestMatch.proveedor,
                    categoria: bestMatch.categoria
                };

                // Preparar update en Firestore
                const patchFields = {
                    precio: { doubleValue: nuevoPrecio },
                    escandalloInfo: {
                        mapValue: {
                            fields: {
                                cantidad: { stringValue: escandalloInfo.cantidad },
                                unidad: { stringValue: escandalloInfo.unidad },
                                precioSinIva: { doubleValue: escandalloInfo.precioSinIva || 0 },
                                precioConIva: { doubleValue: escandalloInfo.precioConIva || 0 },
                                precioKgSinIva: { doubleValue: escandalloInfo.precioKgSinIva || 0 },
                                precioKgConIva: { doubleValue: escandalloInfo.precioKgConIva || 0 },
                                proveedor: { stringValue: escandalloInfo.proveedor },
                                categoria: { stringValue: escandalloInfo.categoria }
                            }
                        }
                    }
                };

                if (nuevoIva !== null) {
                    patchFields.iva = { integerValue: nuevoIva.toString() };
                }

                const updateUrl = encodeURI(`/v1/${prod.name}?updateMask.fieldPaths=precio&updateMask.fieldPaths=escandalloInfo` + (nuevoIva !== null ? '&updateMask.fieldPaths=iva' : ''));
                
                await httpsRequest({
                    hostname: 'firestore.googleapis.com',
                    path: updateUrl,
                    method: 'PATCH',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    }
                }, JSON.stringify({ fields: patchFields }));

                totalActualizados++;
                console.log(`✅ Actualizado [${provId}]: "${appName}" ➔ "${bestMatch.nombre}" (Precio: ${nuevoPrecio}€, IVA: ${nuevoIva}%, Contenido: ${escandalloInfo.cantidad} ${escandalloInfo.unidad}, Unit: ${escandalloInfo.precioKgSinIva}€ / ${escandalloInfo.precioKgConIva}€)`);
            }
        }
    }

    console.log(`\n🎉 Sincronización completa: ${totalActualizados} productos actualizados con éxito en Firestore.`);
}

run().catch(console.error);
