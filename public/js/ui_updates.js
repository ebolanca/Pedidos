
// === OPTIMIZACIÓN RENDIMIENTO ===
function v8_updateRowUI(id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;

    // 1. Recalcular valores de la fila
    const qty = cart[id] ? parseFloat(cart[id]) : 0;
    const precioBaseStr = p.precio || "0";
    const pesoVal = p.peso || "";
    const ivaVal = parseFloat(p.iva) || 0;

    // Inputs (si existen, por si acaso)
    const elWei = document.getElementById(`wei_${id}`);
    const elPrc = document.getElementById(`prc_${id}`);
    if (elWei && document.activeElement !== elWei) elWei.value = pesoVal;
    if (elPrc && document.activeElement !== elPrc) elPrc.value = precioBaseStr;

    // Calcular Total Unitario
    const pNum = parseFloat(precioBaseStr.replace(',', '.'));
    if (!isNaN(pNum)) {
        const finalUnit = (pNum * (1 + ivaVal / 100)).toFixed(2);
        const elLbl = document.getElementById(`lblUnit_${id}`);
        if (elLbl) elLbl.innerText = `Total: ${finalUnit}€`;

        // Calcular Total Fila
        const multiplicador = (pesoVal && parseFloat(pesoVal) > 0) ? parseFloat(pesoVal) : (qty > 0 ? qty : 0);
        if (multiplicador > 0) {
            const totalRow = (finalUnit * multiplicador).toFixed(2);
            let infoIva = ivaVal > 0 ? ` <span style="font-size:9px; color:#666">(IVA ${ivaVal}%)</span>` : '';
            const elBadge = document.getElementById(`badge_${id}`);

            // Si no existe el badge (porque antes era 0), quizás debamos recargar si es muy complejo
            // Pero normalmente el badge está dentro del HTML base si es admin.
            if (elBadge) {
                elBadge.innerHTML = `= ${totalRow}€${infoIva}`;
                elBadge.style.display = 'inline-block';
            }
        } else {
            const elBadge = document.getElementById(`badge_${id}`);
            if (elBadge) elBadge.style.display = 'none';
        }
    }

    // 2. Recalcular Totales Globales (Bottom Bar)
    v8_updateGlobalTotals();
}

function v8_updateGlobalTotals() {
    let totalCoste = 0;
    let itemsCount = Object.keys(cart).length;

    for (const [id, qty] of Object.entries(cart)) {
        const p = allProducts.find(x => x.id === id);
        if (p && p.precio) {
            const precioBase = parseFloat(p.precio.replace(',', '.')) || 0;
            const ivaPct = parseFloat(p.iva) || 0;
            const precioConIva = precioBase * (1 + (ivaPct / 100));

            const factorFinal = (p.peso && parseFloat(p.peso) > 0) ? parseFloat(p.peso) : parseFloat(qty);
            if (precioBase > 0) totalCoste += precioConIva * factorFinal;
        }
    }

    const elTotal = document.getElementById("v8-totalCount");
    if (elTotal) {
        // Mantenemos el formato original
        // "3 items [hidden msg] | 12.50€"
        // Simplificación para no complicar el regex del hidden msg:
        // Reconstruimos el string.
        // NOTA: itemsOcultos se calculaba en renderTabla. Si asumimos que no cambia al editar un precio...
        // Podemos leerlo del DOM actual o recalcularlo (más costoso).
        // Para máxima velocidad, solo actualizamos el precio final si es posible.

        const currentHTML = elTotal.innerHTML;
        // Buscamos el span del precio (tiene color success)
        const newPriceHtml = `<span style="color:var(--success)">${totalCoste.toFixed(2)}€</span>`;
        // Intentamos reemplazar solo el precio
        // Regex: busca el span verde y su contenido
        if (currentHTML.includes('color:#28a745') || currentHTML.includes('color:var(--success)')) {
            // Hack rápido: reemplazar todo después del pipe |
            // O mejor, regenerar simple.
            elTotal.innerHTML = `${itemsCount} <span style="opacity:0.5; margin:0 5px">|</span> ${newPriceHtml}`;
        } else {
            elTotal.innerHTML = `${itemsCount} <span style="opacity:0.5; margin:0 5px">|</span> ${newPriceHtml}`;
        }
    }
}
