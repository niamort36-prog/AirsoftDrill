/* =========================================================================
 * LOGISTICS.JS — Page « Logistique » : matériel de terrain + supports
 * Matériel : cibles, cônes, barricades... (nom, quantité, photo).
 * Supports : documents PDF / image / TEXTE réutilisés par l'IA du drill.
 * ========================================================================= */

const Logistics = (() => {
    'use strict';

    const ITEM_PHOTO_LABEL = 'Choisir une image';
    const DOC_FILE_LABEL = 'Importer un fichier';

    let currentItemPhoto = null;
    let currentDocPayload = null; // { kind:'pdf'|'image'|'text', payload, fileName }

    // --- Matériel de terrain -------------------------------------------------
    function renderItems() {
        const container = document.getElementById('logistics-item-list');
        container.innerHTML = '';
        if (!Store.state.logisticsItems.length) {
            container.innerHTML = '<p class="empty">Aucun matériel enregistré.</p>';
            return;
        }
        Store.state.logisticsItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'equipment-card';
            card.innerHTML = `
                <div class="card-head">
                    <div>
                        <span class="category">Quantité : ${UI.esc(item.qty)}</span>
                        <h4>${UI.esc(item.name)}</h4>
                    </div>
                    <button type="button" class="delete-btn" data-id="${item.id}" aria-label="Supprimer ${UI.esc(item.name)}">✕</button>
                </div>
                ${item.photo ? `<img class="card-photo" src="${item.photo}" alt="Photo de ${UI.esc(item.name)}">` : ''}`;
            container.appendChild(card);
        });
    }

    async function onAddItem(e) {
        e.preventDefault();
        const item = Schema.makeLogisticsItem(
            document.getElementById('log-item-name').value.trim(),
            document.getElementById('log-item-qty').value,
            currentItemPhoto
        );
        if (!item.name) return;
        if (await Store.saveLogisticsItem(item, `« ${item.name} » ajouté au matériel`)) {
            e.target.reset();
            document.getElementById('log-item-qty').value = 1;
            currentItemPhoto = null;
            document.getElementById('log-item-photo-label').textContent = ITEM_PHOTO_LABEL;
            renderItems();
            if (typeof Drill !== 'undefined') Drill.populate();
        }
    }

    async function onItemListClick(e) {
        const btn = e.target.closest('button[data-id]');
        if (!btn) return;
        const item = Store.state.logisticsItems.find(i => i.id === btn.dataset.id);
        if (!item || !confirm(`Supprimer « ${item.name} » ?`)) return;
        if (await Store.deleteLogisticsItem(item.id)) {
            UI.toast('Matériel supprimé', 'info');
            renderItems();
            if (typeof Drill !== 'undefined') Drill.populate();
        }
    }

    // --- Supports (PDF / image / texte) ----------------------------------------
    function renderDocs() {
        const container = document.getElementById('logistics-doc-list');
        container.innerHTML = '';
        if (!Store.state.supportDocs.length) {
            container.innerHTML = '<p class="empty">Aucun support. Ajoutez modèles de cibles, fiches de drill, notes...</p>';
            return;
        }
        Store.state.supportDocs.forEach(doc => {
            const card = document.createElement('div');
            card.className = 'equipment-card';
            let preview = '';
            if (doc.kind === 'pdf' && doc.dataUrl) {
                preview = `<a class="doc-link" href="${doc.dataUrl}" download="${UI.esc(doc.title)}.pdf">📥 Télécharger le PDF</a>`;
            } else if (doc.kind === 'image' && doc.dataUrl) {
                preview = `<img class="card-photo" src="${doc.dataUrl}" alt="Aperçu de ${UI.esc(doc.title)}">`;
            } else if (doc.kind === 'text' && doc.text) {
                preview = `<pre class="doc-text-preview">${UI.esc(doc.text.slice(0, 200))}${doc.text.length > 200 ? '…' : ''}</pre>`;
            }
            card.innerHTML = `
                <div class="card-head">
                    <div>
                        <span class="category">${UI.esc(doc.type)}</span>
                        <h4>${UI.esc(doc.title)}</h4>
                    </div>
                    <button type="button" class="delete-btn" data-id="${doc.id}" aria-label="Supprimer ${UI.esc(doc.title)}">✕</button>
                </div>
                ${preview}`;
            container.appendChild(card);
        });
    }

    async function onDocFileChange(e) {
        const file = e.target.files[0];
        if (!file) return;
        const label = document.getElementById('log-doc-file-label');
        try {
            if (file.type.startsWith('text/') || /\.(txt|md)$/i.test(file.name)) {
                currentDocPayload = { kind: 'text', payload: await UI.readFileAsText(file), fileName: file.name };
            } else if (file.type === 'application/pdf') {
                if (file.size > 15 * 1024 * 1024) throw new Error('PDF trop volumineux (15 Mo max).');
                currentDocPayload = { kind: 'pdf', payload: await UI.readFileAsDataURL(file), fileName: file.name };
            } else if (file.type.startsWith('image/')) {
                const raw = await UI.readFileAsDataURL(file);
                currentDocPayload = { kind: 'image', payload: await UI.compressImage(raw, 1600, 0.85), fileName: file.name };
            } else {
                throw new Error('Format non géré (image, PDF ou texte uniquement).');
            }
            label.textContent = '✅ ' + file.name;
        } catch (err) {
            currentDocPayload = null;
            e.target.value = '';
            label.textContent = DOC_FILE_LABEL;
            UI.toast(err.message, 'error');
        }
    }

    async function onAddDoc(e) {
        e.preventDefault();
        const title = document.getElementById('log-doc-title').value.trim();
        if (!title) return;
        if (!currentDocPayload) { UI.toast('Choisissez un fichier (image, PDF ou texte).', 'error'); return; }
        const doc = Schema.makeSupportDoc(
            title,
            document.getElementById('log-doc-type').value,
            currentDocPayload.kind,
            currentDocPayload.payload,
            currentDocPayload.fileName
        );
        if (await Store.saveSupportDoc(doc, `Support « ${title} » ajouté`)) {
            e.target.reset();
            currentDocPayload = null;
            document.getElementById('log-doc-file-label').textContent = DOC_FILE_LABEL;
            renderDocs();
        }
    }

    async function onDocListClick(e) {
        const btn = e.target.closest('button[data-id]');
        if (!btn) return;
        const doc = Store.state.supportDocs.find(d => d.id === btn.dataset.id);
        if (!doc || !confirm(`Supprimer le support « ${doc.title} » ?`)) return;
        if (await Store.deleteSupportDoc(doc.id)) {
            UI.toast('Support supprimé', 'info');
            renderDocs();
        }
    }

    // --- Init ----------------------------------------------------------------------
    function init() {
        document.getElementById('log-item-photo').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const raw = await UI.readFileAsDataURL(file);
                currentItemPhoto = await UI.compressImage(raw, 800, 0.8);
                document.getElementById('log-item-photo-label').textContent = '✅ ' + file.name;
            } catch (err) {
                UI.toast(err.message, 'error');
            }
        });
        document.getElementById('logistics-item-form').addEventListener('submit', onAddItem);
        document.getElementById('logistics-item-list').addEventListener('click', onItemListClick);

        document.getElementById('log-doc-file').addEventListener('change', onDocFileChange);
        document.getElementById('logistics-doc-form').addEventListener('submit', onAddDoc);
        document.getElementById('logistics-doc-list').addEventListener('click', onDocListClick);

        renderItems();
        renderDocs();
    }

    return { init, renderItems, renderDocs };
})();
