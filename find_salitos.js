const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json');
const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const refreshToken = conf.tokens.refresh_token;
const PROJECT_ID = 'pedidos-rail-app-2025-87f2c';

function refreshAccessToken() {
    return new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
            client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho859e1.apps.googleusercontent.com', // standard firebase-tools client_id
            client_secret: '', // public client
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        }).toString();

        const req = https.request({
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length
            }
        }, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                const parsed = JSON.parse(data);
                if (parsed.access_token) {
                    resolve(parsed.access_token);
                } else {
                    reject(new Error(JSON.stringify(parsed)));
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

function httpsGet(urlPath, token) {
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
    let token;
    try {
        token = await refreshAccessToken();
        console.log("🔑 Token renovado con éxito!");
    } catch(e) {
        // Fallback to existing
        token = conf.tokens.access_token;
    }

    const provs = await httpsGet('/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/proveedores?pageSize=100', token);
    console.log('Total proveedores en Firestore:', provs.documents?.length);

    for (const doc of (provs.documents || [])) {
        const provId = doc.name.split('/').pop();
        const prods = await httpsGet('/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/proveedores/' + encodeURIComponent(provId) + '/productos?pageSize=300', token);
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
