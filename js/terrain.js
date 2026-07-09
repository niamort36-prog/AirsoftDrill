/* =========================================================================
 * TERRAIN.JS — Page « Terrains » : éditeur de plan + bibliothèque
 * -------------------------------------------------------------------------
 * Le canvas a une résolution interne FIXE (900x500, cf. Schema) et est mis
 * à l'échelle par le CSS : les coordonnées enregistrées sont donc les mêmes
 * sur tous les écrans, et cohérentes avec le canvas de résultat du drill
 * et avec le repère communiqué à l'IA.
 * Les Pointer Events couvrent souris, stylet ET tactile (mobile/tablette).
 * ========================================================================= */

const TerrainEditor = (() => {
    'use strict';

    const W = Schema.TERRAIN_WIDTH;
    const H = Schema.TERRAIN_HEIGHT;
    const PPM = Schema.PIXELS_PER_METER;
    const PHOTO_LABEL_DEFAULT = '📸 Ajouter une photo';

    let canvas, ctx;
    let currentTool = 'wall';
    let drawing = false;
    let startX = 0, startY = 0;
    let elements = [];          // TerrainElement[] en cours d'édition
    let editingId = null;       // id du terrain en cours d'édition, sinon null
    let editingPhoto = null;    // photo existante conservée si pas de nouvelle
    let newPhoto = null;        // nouvelle photo choisie (dataURL compressée)

    // --- Conversion pointeur -> repère interne du canvas --------------------
    function pointerPos(e) {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (W / r.width),
            y: (e.clientY - r.top) * (H / r.height)
        };
    }

    // --- Dessin ---------------------------------------------------------------
    function setStyle(c, tool) {
        c.lineCap = 'round'; c.lineJoin = 'round';
        switch (tool) {
            case 'wall': c.strokeStyle = '#2c3e50'; c.lineWidth = 6; break;
            case 'door_single': c.strokeStyle = '#e67e22'; c.lineWidth = 4; break;
            case 'door_double': c.strokeStyle = '#f1c40f'; c.lineWidth = 6; break;
            case 'window': c.strokeStyle = '#3498db'; c.lineWidth = 4; break;
            case 'brush_in': c.strokeStyle = 'rgba(149, 165, 166, 0.5)'; c.lineWidth = 20; break;
            case 'brush_out': c.strokeStyle = 'rgba(39, 174, 96, 0.5)'; c.lineWidth = 20; break;
        }
    }

    function drawLabel(c, text, x, y) {
        c.save();
        c.font = 'bold 14px Roboto, Arial, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.strokeStyle = '#000'; c.lineWidth = 3; c.strokeText(text, x, y);
        c.fillStyle = '#fff'; c.fillText(text, x, y);
        c.restore();
    }

    function drawShape(c, el, isPreview) {
        c.beginPath();
        if (el.type === 'rect') {
            c.strokeStyle = isPreview ? '#4CAF50' : '#27ae60';
            if (isPreview) c.setLineDash([5, 5]);
            c.fillStyle = 'rgba(76, 175, 80, 0.2)';
            c.lineWidth = 2;
            c.fillRect(el.x1, el.y1, el.x2 - el.x1, el.y2 - el.y1);
            c.strokeRect(el.x1, el.y1, el.x2 - el.x1, el.y2 - el.y1);
            c.setLineDash([]);
            const wM = (Math.abs(el.x2 - el.x1) / PPM).toFixed(1);
            const hM = (Math.abs(el.y2 - el.y1) / PPM).toFixed(1);
            drawLabel(c, `${wM}m x ${hM}m`, el.x1 + (el.x2 - el.x1) / 2, el.y1 + (el.y2 - el.y1) / 2);
        } else if (el.type === 'brush_in' || el.type === 'brush_out') {
            setStyle(c, el.type);
            if (!el.points.length) return;
            c.moveTo(el.points[0].x, el.points[0].y);
            el.points.forEach(p => c.lineTo(p.x, p.y));
            c.stroke();
        } else {
            setStyle(c, el.type);
            c.moveTo(el.x1, el.y1);
            c.lineTo(el.x2, el.y2);
            c.stroke();
            const distM = (Math.hypot(el.x2 - el.x1, el.y2 - el.y1) / PPM).toFixed(1);
            drawLabel(c, `${distM}m`, el.x1 + (el.x2 - el.x1) / 2, el.y1 + (el.y2 - el.y1) / 2);
        }
    }

    /** Redessine tous les éléments d'un terrain sur un contexte donné. */
    function drawElements(c, els) {
        els.forEach(el => drawShape(c, el, false));
    }

    function redraw() {
        ctx.clearRect(0, 0, W, H);
        drawElements(ctx, elements);
    }

    // --- Événements pointeur (souris + tactile + stylet) ----------------------
    function onPointerDown(e) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        drawing = true;
        const p = pointerPos(e);
        startX = p.x; startY = p.y;
        if (currentTool === 'brush_in' || currentTool === 'brush_out') {
            elements.push({ type: currentTool, points: [{ x: p.x, y: p.y }] });
        }
    }

    function onPointerMove(e) {
        if (!drawing) return;
        e.preventDefault();
        const p = pointerPos(e);
        if (currentTool === 'brush_in' || currentTool === 'brush_out') {
            elements[elements.length - 1].points.push({ x: p.x, y: p.y });
            redraw();
        } else {
            redraw();
            drawShape(ctx, { type: currentTool, x1: startX, y1: startY, x2: p.x, y2: p.y }, true);
        }
    }

    function onPointerUp(e) {
        if (!drawing) return;
        drawing = false;
        const p = pointerPos(e);
        if (currentTool !== 'brush_in' && currentTool !== 'brush_out') {
            // Ignore les clics sans mouvement (évite les segments fantômes)
            if (Math.hypot(p.x - startX, p.y - startY) > 3) {
                elements.push({ type: currentTool, x1: startX, y1: startY, x2: p.x, y2: p.y });
            }
        }
        redraw();
    }

    // --- API utilisée par le HTML ----------------------------------------------
    function setTool(tool, btn) {
        currentTool = tool;
        document.querySelectorAll('.canvas-toolbar .tool-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
    }

    function undo() {
        elements.pop();
        redraw();
    }

    function clear() {
        if (elements.length && !confirm('Effacer tout le plan en cours ?')) return;
        elements = [];
        redraw();
    }

    function resetForm() {
        document.getElementById('terrain-name').value = '';
        document.getElementById('terrain-type').selectedIndex = 0;
        document.getElementById('terrain-photo-input').value = '';
        document.getElementById('terrain-photo-label').textContent = PHOTO_LABEL_DEFAULT;
        document.getElementById('edit-mode-indicator').classList.add('hidden');
        editingId = null; editingPhoto = null; newPhoto = null;
        elements = [];
        redraw();
    }

    /** Rendu du plan sur fond clair pour la vignette de la bibliothèque. */
    function makeThumbnail() {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const cx = c.getContext('2d');
        cx.fillStyle = '#cfd8dc';
        cx.fillRect(0, 0, W, H);
        drawElements(cx, elements);
        return c.toDataURL('image/jpeg', 0.75);
    }

    async function save() {
        const name = document.getElementById('terrain-name').value.trim();
        const type = document.getElementById('terrain-type').value;
        if (!name) { UI.toast('Donnez un nom au terrain.', 'error'); return; }
        if (!elements.length) { UI.toast('Le plan est vide : dessinez au moins un élément.', 'error'); return; }

        let terrain;
        if (editingId) {
            terrain = Store.state.terrains.find(t => t.id === editingId) || Schema.makeTerrain(name, type);
            terrain.name = name; terrain.type = type;
        } else {
            terrain = Schema.makeTerrain(name, type);
        }
        terrain.elements = JSON.parse(JSON.stringify(elements));
        terrain.thumbnail = makeThumbnail();
        terrain.photo = newPhoto || editingPhoto || null;

        if (await Store.saveTerrain(terrain, `Terrain « ${name} » sauvegardé`)) {
            resetForm();
            renderTerrains();
            if (window.Drill) Drill.populate();
        }
    }

    function edit(id) {
        const t = Store.state.terrains.find(x => x.id === id);
        if (!t) return;
        editingId = t.id;
        editingPhoto = t.photo || null;
        newPhoto = null;
        elements = JSON.parse(JSON.stringify(t.elements || []));
        document.getElementById('terrain-name').value = t.name;
        document.getElementById('terrain-type').value = t.type;
        document.getElementById('edit-mode-indicator').classList.remove('hidden');
        document.getElementById('terrain-photo-label').textContent = PHOTO_LABEL_DEFAULT;
        redraw();
        document.getElementById('terrain').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function remove(id) {
        const t = Store.state.terrains.find(x => x.id === id);
        if (!t || !confirm(`Supprimer le terrain « ${t.name} » ?`)) return;
        if (await Store.deleteTerrain(id)) {
            if (editingId === id) resetForm();
            UI.toast('Terrain supprimé', 'info');
            renderTerrains();
            if (window.Drill) Drill.populate();
        }
    }

    // --- Bibliothèque ------------------------------------------------------------
    function renderTerrains() {
        const container = document.getElementById('terrain-list');
        container.innerHTML = '';
        if (!Store.state.terrains.length) {
            container.innerHTML = '<p class="empty">Aucun terrain enregistré. Dessinez votre premier plan ci-dessus.</p>';
            return;
        }
        Store.state.terrains.forEach(t => {
            const card = document.createElement('div');
            card.className = 'equipment-card terrain-card';
            card.innerHTML = `
                <div class="card-head">
                    <div>
                        <span class="category">${UI.esc(t.type)}</span>
                        <h4>${UI.esc(t.name)}</h4>
                    </div>
                    <div class="card-actions">
                        <button type="button" class="edit-btn" data-action="edit" data-id="${t.id}" aria-label="Éditer ${UI.esc(t.name)}">✏️ Éditer</button>
                        <button type="button" class="delete-btn" data-action="delete" data-id="${t.id}" aria-label="Supprimer ${UI.esc(t.name)}">✕</button>
                    </div>
                </div>
                <div class="terrain-images-container">
                    ${t.thumbnail ? `<img src="${t.thumbnail}" alt="Plan de ${UI.esc(t.name)}">` : ''}
                    ${t.photo ? `<img src="${t.photo}" alt="Photo de ${UI.esc(t.name)}">` : ''}
                </div>`;
            container.appendChild(card);
        });
    }

    function onListClick(e) {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'edit') edit(btn.dataset.id);
        if (btn.dataset.action === 'delete') remove(btn.dataset.id);
    }

    // --- Init -----------------------------------------------------------------------
    function init() {
        canvas = document.getElementById('terrain-canvas');
        ctx = canvas.getContext('2d');
        canvas.width = W;
        canvas.height = H;

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);

        document.getElementById('terrain-photo-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const raw = await UI.readFileAsDataURL(file);
                newPhoto = await UI.compressImage(raw, 1200, 0.8);
                document.getElementById('terrain-photo-label').textContent = '✅ ' + file.name;
            } catch (err) {
                UI.toast(err.message, 'error');
            }
        });

        document.getElementById('terrain-list').addEventListener('click', onListClick);
        redraw();
        renderTerrains();
    }

    return { init, setTool, undo, clear, save, renderTerrains, drawElements };
})();
