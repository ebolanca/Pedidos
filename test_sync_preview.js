const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json');
const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const token = conf.tokens.access_token;
const PROJECT_ID = 'pedidos-rail-app-2025-87f2c';

function cleanWords(str) {
    if (!str) return [];
    return str.toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, ' ')
        .split(/\s+/)
        .map(w => (w.endsWith('s') && w.length > 3) ? w.slice(0, -1) : w)
        .filter(w => w && !['de','el','la','los','las','un','una','para','llevar','en','con','del'].includes(w));
}

function extraerCapacidades(str) {
    if (!str) return [];
    // Normalizar espacios antes de la unidad (ej: "10 cl" -> "10cl")
    const norm = str.toLowerCase().replace(/(\d+)\s+(cl|ml|kg|g|l|cm|ud)/g, '$1$2');
    return (norm.match(/\d+(?:[.,]\d+)?(?:cl|ml|kg|g|l|cm|ud)?/gi) || []).map(x => x.toLowerCase());
}

function matchScore(appStr, appUnit, sheetStr) {
    const w1 = cleanWords(appStr);
    const w2 = cleanWords(sheetStr);
    if (w1.length === 0 || w2.length === 0) return 0;
    
    // Comprobar coincidencia de capacidades numéricas (ej: 10cl, 20cl, 30cl, etc.)
    const appNums = extraerCapacidades(appStr);
    const sheetNums = extraerCapacidades(sheetStr);
    
    let numBonus = 0;
    if (appNums.length > 0) {
        const numMatch = appNums.every(n => sheetNums.includes(n));
        if (!numMatch) return 0; // Si dice 20cl y la hoja dice 10cl, NO es match
        numBonus = 0.5;
    }

    // Si la unidad en la app es Caja o el nombre lleva caja, priorizar si la hoja lleva caja
    const appEsCaja = (appUnit && appUnit.toLowerCase().includes('caja')) || appStr.toLowerCase().includes('caja');
    const sheetEsCaja = sheetStr.toLowerCase().includes('caja');
    
    let matches = 0;
    w1.forEach(w => {
        if (w2.some(x => x === w || (w.length >= 4 && (x.includes(w) || w.includes(x))))) matches++;
    });
    
    let score = (matches / Math.max(w1.length, w2.length)) + numBonus;
    if (appEsCaja && sheetEsCaja) score += 0.4;
    if (!appEsCaja && sheetEsCaja) score -= 0.3;
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

const url = 'https://docs.google.com/spreadsheets/d/1B77f3gIVm-jx87fwy4nxM_8ZJp37V0eir6lyu_4ERME/gviz/tq?tqx=out:csv&gid=1786108103';

https.get(url, (res) => {
    let csv = '';
    res.on('data', c => csv += c);
    res.on('end', () => {
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
        
        const opt = {
            hostname: 'firestore.googleapis.com',
            path: '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/proveedores/Makro/productos?pageSize=300',
            headers: { 'Authorization': 'Bearer ' + token }
        };
        https.get(opt, (res2) => {
            let body = '';
            res2.on('data', c => body += c);
            res2.on('end', () => {
                const json = JSON.parse(body);
                const docs = json.documents || [];
                const makroSheet = sheetRows.filter(r => r.proveedor.toLowerCase().includes('makro'));
                
                docs.forEach(d => {
                    const f = d.fields || {};
                    const appName = f.nombre ? f.nombre.stringValue : '';
                    const appUnit = f.unidad ? f.unidad.stringValue : '';
                    let bestScore = 0;
                    let bestMatch = null;
                    
                    makroSheet.forEach(s => {
                        const score = matchScore(appName, appUnit, s.nombre);
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = s;
                        }
                    });
                    
                    if (bestScore >= 0.5 && bestMatch) {
                        console.log(`✅ MATCH [${(bestScore*100).toFixed(0)}%]: "${appName}" ➔ "${bestMatch.nombre}" | ${bestMatch.cantidad} ${bestMatch.unidad} | Total Sin IVA: ${bestMatch.precioSinIva}€ | Total Con IVA: ${bestMatch.precioConIva}€ | Unit Sin IVA: ${bestMatch.precioKgSinIva}€ | Unit Con IVA: ${bestMatch.precioKgConIva}€`);
                    } else {
                        console.log(`❌ NO MATCH: "${appName}" (Best: ${bestMatch ? bestMatch.nombre : 'none'} - ${(bestScore*100).toFixed(0)}%)`);
                    }
                });
            });
        });
    });
});
