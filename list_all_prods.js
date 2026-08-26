const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json');
const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const token = conf.tokens.access_token;
const PROJECT_ID = 'pedidos-rail-app-2025-87f2c';

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

async function main() {
    const provs = await httpsGet('/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/proveedores?pageSize=100');
    console.log('Total proveedores en Firestore:', provs.documents?.length);

    for (const doc of (provs.documents || [])) {
        const provId = doc.name.split('/').pop();
        const prods = await httpsGet('/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/proveedores/' + encodeURIComponent(provId) + '/productos?pageSize=300');
        const list = prods.documents || [];
        list.forEach(p => {
            const name = p.fields?.nombre?.stringValue || '';
            if (name.toLowerCase().includes('salitos') || provId.toLowerCase().includes('vecino')) {
                console.log(`[${provId}] -> "${name}" | Unidad: ${p.fields?.unidad?.stringValue} | Peso: ${p.fields?.peso?.stringValue || p.fields?.peso?.integerValue} | Precio: ${p.fields?.precio?.doubleValue || p.fields?.precio?.stringValue}`);
            }
        });
    }
}
main().catch(console.error);
