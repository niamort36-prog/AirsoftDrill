/* =========================================================================
 * DRILL.JS — Page « Création de Drill »
 * Rassemble terrain + pax + matériel + supports, appelle le module AI,
 * affiche le briefing (markdown sécurisé) et la carte annotée.
 *
 * Deux modes :
 *  - IA : l'IA rédige le briefing et place des overlays sur la carte
 *    (avec reprise automatique si le modèle est saturé, cf. js/ai.js) ;
 *  - Manuel : l'utilisateur annote lui-même la carte (crayon, flèche,
 *    cibles, départ, consignes texte) — aussi disponible PAR-DESSUS un
 *    résultat IA pour l'ajuster.
 * ========================================================================= */

const Drill = (() => {
    'use strict';

    // Dernier rendu affiché (terrain + overlays IA) et annotations utilisateur.
    let lastRender = null;      // { terrain, overlays }
    let annotations = [];       // annotations manuelles (voir drawAnnotations)
    let annotTool = null;       // outil actif : pen|arrow|target|start|text|null
    let annotDrawing = false;
    let annotStart = null;      // départ d'une flèche en cours

    // --- Peuplement du formulaire depuis les données des autres pages ---------
    function populate() {
        populateTerrains();
        populateSquads();
        populateMaterials();
    }

    function populateTerrains() {
        const sel = document.getElementById('drill-terrain-select');
        const previous = sel.value;
        sel.innerHTML = '<option value="">— Sélectionnez un terrain —</option>';
        Store.state.terrains.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.name} (${t.type})`;
            sel.appendChild(opt);
        });
        if (previous && Store.state.terrains.some(t => t.id === previous)) sel.value = previous;
    }

    function populateSquads() {
        const sel = document.getElementById('drill-squad-select');
        const previous = sel.value;
        sel.innerHTML = '';
        if (!Store.state.squads.length) {
            sel.innerHTML = '<option value="">— Aucune squad créée —</option>';
            sel.disabled = true;
        } else {
            sel.disabled = false;
            Store.state.squads.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = `${s.name} (${s.pax.length} pax)`;
                sel.appendChild(opt);
            });
            if (previous && Store.state.squads.some(s => s.id === previous)) sel.value = previous;
        }
        populatePaxChecks();
    }

    function populatePaxChecks() {
        const container = document.getElementById('drill-pax-checkboxes');
        const squad = Store.state.squads.find(s => s.id === document.getElementById('drill-squad-select').value);
        container.innerHTML = '';
        if (!squad || !squad.pax.length) {
            container.innerHTML = '<p class="empty">Aucun pax dans cette squad (page Squad & Matériel).</p>';
            return;
        }
        squad.pax.forEach(p => {
            const div = document.createElement('div');
            div.className = 'checkbox-item';
            div.innerHTML = `
                <input type="checkbox" id="chk-pax-${UI.esc(p.id)}" value="${UI.esc(p.id)}" checked>
                <label for="chk-pax-${UI.esc(p.id)}">${UI.esc(p.name)} <span class="muted">(${UI.esc(p.role)})</span></label>`;
            container.appendChild(div);
        });
    }

    function populateMaterials() {
        const container = document.getElementById('drill-material-checkboxes');
        container.innerHTML = '';
        if (!Store.state.logisticsItems.length) {
            container.innerHTML = '<p class="empty">Aucun matériel logistique (page Logistique).</p>';
            return;
        }
        Store.state.logisticsItems.forEach(item => {
            const div = document.createElement('div');
            div.className = 'checkbox-item';
            div.innerHTML = `
                <input type="checkbox" id="chk-mat-${UI.esc(item.id)}" value="${UI.esc(item.id)}">
                <label for="chk-mat-${UI.esc(item.id)}">${UI.esc(item.name)} <span class="muted">(max : ${UI.esc(item.qty)})</span></label>`;
            container.appendChild(div);
        });
    }

    // --- Configuration API (clé stockée en local UNIQUEMENT) -------------------
    function saveApiConfig() {
        const key = document.getElementById('gemini-api-key').value.trim();
        const model = document.getElementById('gemini-model').value;
        localStorage.setItem('geminiApiKey', key);
        localStorage.setItem('geminiModel', model);
        UI.toast(key ? 'Configuration IA enregistrée (stockée uniquement sur cet appareil).' : 'Clé effacée.', 'success');
    }

    // --- États de l'interface -----------------------------------------------------
    const LOADING_DEFAULT = 'L\'IA analyse votre terrain, vos pax et vos supports…';

    function setLoading(loading) {
        const btn = document.getElementById('generate-drill-btn');
        btn.disabled = loading;
        btn.classList.toggle('btn-loading', loading);
        document.getElementById('drill-loading').classList.toggle('hidden', !loading);
        if (loading) setLoadingStatus(LOADING_DEFAULT);
    }

    function setLoadingStatus(message) {
        document.getElementById('drill-loading-status').textContent = message;
    }

    function showError(message) {
        const box = document.getElementById('drill-error');
        if (message) {
            box.textContent = '⚠️ ' + message;
            box.classList.remove('hidden');
        } else {
            box.classList.add('hidden');
        }
    }

    function selectedTerrain() {
        return Store.state.terrains.find(t => t.id === document.getElementById('drill-terrain-select').value);
    }

    // --- Génération par IA ----------------------------------------------------------
    async function generate() {
        showError(null);

        const apiKey = localStorage.getItem('geminiApiKey');
        if (!apiKey) { showError('Entrez et enregistrez d\'abord votre clé API Gemini (gratuite sur aistudio.google.com) — ou utilisez le mode manuel.'); return; }

        const terrain = selectedTerrain();
        if (!terrain) { showError('Sélectionnez un terrain.'); return; }

        const squad = Store.state.squads.find(s => s.id === document.getElementById('drill-squad-select').value);
        const paxIds = Array.from(document.querySelectorAll('#drill-pax-checkboxes input:checked')).map(c => c.value);
        const pax = squad ? squad.pax.filter(p => paxIds.includes(p.id)) : [];

        const matIds = Array.from(document.querySelectorAll('#drill-material-checkboxes input:checked')).map(c => c.value);
        const materials = Store.state.logisticsItems.filter(i => matIds.includes(i.id));

        const includeDocs = document.getElementById('include-docs-chk').checked;

        setLoading(true);
        document.getElementById('drill-result-content').classList.add('hidden');

        try {
            const result = await AI.generateDrill({
                apiKey,
                model: localStorage.getItem('geminiModel') || AI.DEFAULT_MODEL,
                terrain,
                pax,
                materials,
                docs: includeDocs ? Store.state.supportDocs : [],
                userPrompt: document.getElementById('drill-prompt').value.trim(),
                onStatus: setLoadingStatus
            });

            document.getElementById('drill-result-text').innerHTML = UI.mdToHtml(result.markdown);
            showResult(terrain, result.overlays);

            // Informe si la génération a dû s'adapter (repli / allègement).
            const info = [];
            if (result.fellBack) info.push(`généré par le modèle de repli « ${result.modelUsed} » (le vôtre était saturé ou à court de quota)`);
            if (result.docsDropped) info.push('supports non joints pour alléger la requête');
            const infoEl = document.getElementById('drill-model-info');
            infoEl.textContent = info.length ? 'ℹ️ ' + info.join(' — ') : '';
            infoEl.classList.toggle('hidden', !info.length);
        } catch (err) {
            console.error('Génération du drill :', err);
            showError(err.message);
        } finally {
            setLoading(false);
        }
    }

    // --- Mode manuel (sans IA) --------------------------------------------------------
    function startManual() {
        showError(null);
        const terrain = selectedTerrain();
        if (!terrain) { showError('Sélectionnez un terrain pour l\'annoter.'); return; }
        document.getElementById('drill-model-info').classList.add('hidden');
        document.getElementById('drill-result-text').innerHTML =
            '<p><strong>Mode manuel.</strong> Choisissez un outil au-dessus de la carte et dessinez vos consignes directement dessus (doigt ou souris).</p>';
        showResult(terrain, []);
    }

    function showResult(terrain, overlays) {
        lastRender = { terrain, overlays: overlays || [] };
        annotations = [];
        setAnnotTool(null);
        redrawResult();
        document.getElementById('drill-result-content').classList.remove('hidden');
        document.getElementById('drill-result-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // --- Rendu de la carte (terrain + overlays IA + annotations manuelles) -------------
    function redrawResult() {
        if (!lastRender) return;
        const terrain = lastRender.terrain;
        const canvas = document.getElementById('drill-result-canvas');
        canvas.width = terrain.width || Schema.TERRAIN_WIDTH;
        canvas.height = terrain.height || Schema.TERRAIN_HEIGHT;
        const c = canvas.getContext('2d');

        c.fillStyle = '#cfd8dc';
        c.fillRect(0, 0, canvas.width, canvas.height);
        TerrainEditor.drawElements(c, terrain.elements || []);
        drawOverlays(c, lastRender.overlays);
        drawAnnotations(c);
    }

    function drawOverlays(c, overlays) {
        (overlays || []).forEach(o => {
            if (o.type === 'target') {
                drawTarget(c, o.x, o.y, o.label);
            } else if (o.type === 'start_point') {
                drawStart(c, o.x, o.y, o.label);
            } else if (o.type === 'zone') {
                c.beginPath(); c.arc(o.x, o.y, 24, 0, 2 * Math.PI);
                c.fillStyle = 'rgba(155, 89, 182, 0.25)'; c.fill();
                c.strokeStyle = '#8e44ad'; c.lineWidth = 2; c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]);
                if (o.label) drawMapLabel(c, o.label, o.x, o.y - 32);
            } else if (o.type === 'path' && o.points && o.points.length > 1) {
                drawPath(c, o.points, '#b8860b');
            }
        });
    }

    function drawTarget(c, x, y, label) {
        c.beginPath(); c.arc(x, y, 10, 0, 2 * Math.PI);
        c.fillStyle = '#e74c3c'; c.fill();
        c.lineWidth = 2; c.strokeStyle = '#c0392b'; c.stroke();
        c.beginPath(); c.moveTo(x - 10, y); c.lineTo(x + 10, y);
        c.moveTo(x, y - 10); c.lineTo(x, y + 10); c.stroke();
        if (label) drawMapLabel(c, label, x, y - 18);
    }

    function drawStart(c, x, y, label) {
        c.fillStyle = '#2ecc71'; c.fillRect(x - 10, y - 10, 20, 20);
        c.strokeStyle = '#1e8449'; c.lineWidth = 2; c.strokeRect(x - 10, y - 10, 20, 20);
        drawMapLabel(c, label || 'Départ', x, y - 18);
    }

    function drawPath(c, points, color) {
        c.beginPath(); c.setLineDash([6, 10]);
        c.strokeStyle = color; c.lineWidth = 3;
        c.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach(p => c.lineTo(p.x, p.y));
        c.stroke(); c.setLineDash([]);
        const a = points[points.length - 2], b = points[points.length - 1];
        drawArrowHead(c, a, b, color);
    }

    function drawArrowHead(c, from, to, color) {
        const ang = Math.atan2(to.y - from.y, to.x - from.x);
        c.beginPath();
        c.moveTo(to.x, to.y);
        c.lineTo(to.x - 12 * Math.cos(ang - 0.4), to.y - 12 * Math.sin(ang - 0.4));
        c.lineTo(to.x - 12 * Math.cos(ang + 0.4), to.y - 12 * Math.sin(ang + 0.4));
        c.closePath(); c.fillStyle = color; c.fill();
    }

    function drawMapLabel(c, text, x, y) {
        c.save();
        c.font = 'bold 13px Roboto, Arial, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.strokeStyle = '#fff'; c.lineWidth = 3; c.strokeText(text, x, y);
        c.fillStyle = '#2c3e50'; c.fillText(text, x, y);
        c.restore();
    }

    // --- Annotations manuelles (violet pour les distinguer de l'IA) ---------------------
    const ANNOT_COLOR = '#8e44ad';

    function drawAnnotations(c) {
        annotations.forEach(a => {
            if (a.tool === 'pen' && a.points.length > 1) {
                c.beginPath(); c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = ANNOT_COLOR; c.lineWidth = 3;
                c.moveTo(a.points[0].x, a.points[0].y);
                a.points.forEach(p => c.lineTo(p.x, p.y));
                c.stroke();
            } else if (a.tool === 'arrow') {
                c.beginPath(); c.strokeStyle = ANNOT_COLOR; c.lineWidth = 3;
                c.moveTo(a.x1, a.y1); c.lineTo(a.x2, a.y2); c.stroke();
                drawArrowHead(c, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }, ANNOT_COLOR);
            } else if (a.tool === 'target') {
                drawTarget(c, a.x, a.y, a.label);
            } else if (a.tool === 'start') {
                drawStart(c, a.x, a.y);
            } else if (a.tool === 'text') {
                c.save();
                c.font = 'bold 15px Roboto, Arial, sans-serif';
                c.textAlign = 'center'; c.textBaseline = 'middle';
                c.strokeStyle = '#fff'; c.lineWidth = 4; c.strokeText(a.text, a.x, a.y);
                c.fillStyle = ANNOT_COLOR; c.fillText(a.text, a.x, a.y);
                c.restore();
            }
        });
    }

    function setAnnotTool(tool) {
        annotTool = tool;
        annotDrawing = false;
        annotStart = null;
        const canvas = document.getElementById('drill-result-canvas');
        // touch-action dynamique : ne bloque le scroll tactile QUE lorsqu'un outil est actif
        canvas.style.touchAction = tool ? 'none' : 'auto';
        canvas.style.cursor = tool ? 'crosshair' : 'default';
        document.querySelectorAll('#annot-toolbar [data-tool]').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === tool);
        });
    }

    function annotPos(e) {
        const canvas = document.getElementById('drill-result-canvas');
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (canvas.width / r.width),
            y: (e.clientY - r.top) * (canvas.height / r.height)
        };
    }

    function nextTargetLabel() {
        const count = (lastRender ? lastRender.overlays.filter(o => o.type === 'target').length : 0)
            + annotations.filter(a => a.tool === 'target').length;
        return 'C' + (count + 1);
    }

    function onAnnotPointerDown(e) {
        if (!annotTool || !lastRender) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = annotPos(e);
        annotDrawing = true;
        if (annotTool === 'pen') {
            annotations.push({ tool: 'pen', points: [p] });
        } else if (annotTool === 'arrow') {
            annotStart = p;
        }
    }

    function onAnnotPointerMove(e) {
        if (!annotTool || !annotDrawing || !lastRender) return;
        e.preventDefault();
        const p = annotPos(e);
        if (annotTool === 'pen') {
            annotations[annotations.length - 1].points.push(p);
            redrawResult();
        } else if (annotTool === 'arrow' && annotStart) {
            redrawResult();
            const c = document.getElementById('drill-result-canvas').getContext('2d');
            c.beginPath(); c.strokeStyle = ANNOT_COLOR; c.lineWidth = 3; c.setLineDash([4, 4]);
            c.moveTo(annotStart.x, annotStart.y); c.lineTo(p.x, p.y); c.stroke(); c.setLineDash([]);
        }
    }

    function onAnnotPointerUp(e) {
        if (!annotTool || !annotDrawing || !lastRender) return;
        annotDrawing = false;
        const p = annotPos(e);
        if (annotTool === 'arrow' && annotStart) {
            if (Math.hypot(p.x - annotStart.x, p.y - annotStart.y) > 5) {
                annotations.push({ tool: 'arrow', x1: annotStart.x, y1: annotStart.y, x2: p.x, y2: p.y });
            }
            annotStart = null;
        } else if (annotTool === 'target') {
            annotations.push({ tool: 'target', x: p.x, y: p.y, label: nextTargetLabel() });
        } else if (annotTool === 'start') {
            annotations.push({ tool: 'start', x: p.x, y: p.y });
        } else if (annotTool === 'text') {
            const text = prompt('Consigne à afficher sur la carte :');
            if (text && text.trim()) {
                annotations.push({ tool: 'text', x: p.x, y: p.y, text: text.trim().slice(0, 60) });
            }
        }
        redrawResult();
    }

    function onAnnotToolbarClick(e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.tool) {
            // Re-cliquer sur l'outil actif le désactive (rend le scroll au doigt)
            setAnnotTool(annotTool === btn.dataset.tool ? null : btn.dataset.tool);
        } else if (btn.id === 'annot-undo') {
            annotations.pop();
            redrawResult();
        } else if (btn.id === 'annot-clear') {
            if (annotations.length && !confirm('Effacer toutes vos annotations manuelles ? (le résultat IA est conservé)')) return;
            annotations = [];
            redrawResult();
        }
    }

    // --- Init -------------------------------------------------------------------------
    function init() {
        // Modèles disponibles depuis le module AI (découplage complet)
        const modelSel = document.getElementById('gemini-model');
        AI.MODELS.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id; opt.textContent = m.label;
            modelSel.appendChild(opt);
        });
        modelSel.value = localStorage.getItem('geminiModel') || AI.DEFAULT_MODEL;

        const saved = localStorage.getItem('geminiApiKey');
        if (saved) document.getElementById('gemini-api-key').value = saved;

        document.getElementById('save-api-btn').addEventListener('click', saveApiConfig);
        document.getElementById('drill-squad-select').addEventListener('change', populatePaxChecks);
        document.getElementById('generate-drill-btn').addEventListener('click', generate);
        document.getElementById('manual-drill-btn').addEventListener('click', startManual);

        document.getElementById('annot-toolbar').addEventListener('click', onAnnotToolbarClick);
        const resCanvas = document.getElementById('drill-result-canvas');
        resCanvas.addEventListener('pointerdown', onAnnotPointerDown);
        resCanvas.addEventListener('pointermove', onAnnotPointerMove);
        resCanvas.addEventListener('pointerup', onAnnotPointerUp);
        resCanvas.addEventListener('pointercancel', onAnnotPointerUp);

        populate();
    }

    return { init, populate };
})();
