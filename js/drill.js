/* =========================================================================
 * DRILL.JS — Page « Création de Drill »
 * Rassemble terrain + pax + matériel + supports, appelle le module AI,
 * affiche le briefing (markdown sécurisé) et la carte annotée.
 * ========================================================================= */

const Drill = (() => {
    'use strict';

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

    // --- Génération ---------------------------------------------------------------
    function setLoading(loading) {
        const btn = document.getElementById('generate-drill-btn');
        btn.disabled = loading;
        btn.classList.toggle('btn-loading', loading);
        document.getElementById('drill-loading').classList.toggle('hidden', !loading);
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

    async function generate() {
        showError(null);

        const apiKey = localStorage.getItem('geminiApiKey');
        if (!apiKey) { showError('Entrez et enregistrez d\'abord votre clé API Gemini (gratuite sur aistudio.google.com).'); return; }

        const terrain = Store.state.terrains.find(t => t.id === document.getElementById('drill-terrain-select').value);
        if (!terrain) { showError('Sélectionnez un terrain.'); return; }

        const squad = Store.state.squads.find(s => s.id === document.getElementById('drill-squad-select').value);
        const paxIds = Array.from(document.querySelectorAll('#drill-pax-checkboxes input:checked')).map(c => c.value);
        const pax = squad ? squad.pax.filter(p => paxIds.includes(p.id)) : [];

        const matIds = Array.from(document.querySelectorAll('#drill-material-checkboxes input:checked')).map(c => c.value);
        const materials = Store.state.logisticsItems.filter(i => matIds.includes(i.id));

        setLoading(true);
        document.getElementById('drill-result-content').classList.add('hidden');

        try {
            const result = await AI.generateDrill({
                apiKey,
                model: localStorage.getItem('geminiModel') || AI.DEFAULT_MODEL,
                terrain,
                pax,
                materials,
                docs: Store.state.supportDocs,
                userPrompt: document.getElementById('drill-prompt').value.trim()
            });

            document.getElementById('drill-result-text').innerHTML = UI.mdToHtml(result.markdown);
            drawResult(terrain, result.overlays);
            document.getElementById('drill-result-content').classList.remove('hidden');
            document.getElementById('drill-result-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
            console.error('Génération du drill :', err);
            showError(err.message);
        } finally {
            setLoading(false);
        }
    }

    // --- Rendu de la carte annotée ---------------------------------------------
    function drawResult(terrain, overlays) {
        const canvas = document.getElementById('drill-result-canvas');
        canvas.width = terrain.width || Schema.TERRAIN_WIDTH;
        canvas.height = terrain.height || Schema.TERRAIN_HEIGHT;
        const c = canvas.getContext('2d');

        c.fillStyle = '#cfd8dc';
        c.fillRect(0, 0, canvas.width, canvas.height);
        TerrainEditor.drawElements(c, terrain.elements || []);

        (overlays || []).forEach(o => {
            if (o.type === 'target') {
                c.beginPath(); c.arc(o.x, o.y, 10, 0, 2 * Math.PI);
                c.fillStyle = '#e74c3c'; c.fill();
                c.lineWidth = 2; c.strokeStyle = '#c0392b'; c.stroke();
                c.beginPath(); c.moveTo(o.x - 10, o.y); c.lineTo(o.x + 10, o.y);
                c.moveTo(o.x, o.y - 10); c.lineTo(o.x, o.y + 10); c.stroke();
                if (o.label) drawOverlayLabel(c, o.label, o.x, o.y - 18);
            } else if (o.type === 'start_point') {
                c.fillStyle = '#2ecc71'; c.fillRect(o.x - 10, o.y - 10, 20, 20);
                c.strokeStyle = '#1e8449'; c.lineWidth = 2; c.strokeRect(o.x - 10, o.y - 10, 20, 20);
                drawOverlayLabel(c, o.label || 'Départ', o.x, o.y - 18);
            } else if (o.type === 'zone') {
                c.beginPath(); c.arc(o.x, o.y, 24, 0, 2 * Math.PI);
                c.fillStyle = 'rgba(155, 89, 182, 0.25)'; c.fill();
                c.strokeStyle = '#8e44ad'; c.lineWidth = 2; c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]);
                if (o.label) drawOverlayLabel(c, o.label, o.x, o.y - 32);
            } else if (o.type === 'path' && o.points && o.points.length > 1) {
                c.beginPath(); c.setLineDash([6, 10]);
                c.strokeStyle = '#b8860b'; c.lineWidth = 3;
                c.moveTo(o.points[0].x, o.points[0].y);
                o.points.slice(1).forEach(p => c.lineTo(p.x, p.y));
                c.stroke(); c.setLineDash([]);
                // Flèche de sens de passage sur le dernier segment
                const a = o.points[o.points.length - 2], b = o.points[o.points.length - 1];
                const ang = Math.atan2(b.y - a.y, b.x - a.x);
                c.beginPath();
                c.moveTo(b.x, b.y);
                c.lineTo(b.x - 12 * Math.cos(ang - 0.4), b.y - 12 * Math.sin(ang - 0.4));
                c.lineTo(b.x - 12 * Math.cos(ang + 0.4), b.y - 12 * Math.sin(ang + 0.4));
                c.closePath(); c.fillStyle = '#b8860b'; c.fill();
            }
        });
    }

    function drawOverlayLabel(c, text, x, y) {
        c.save();
        c.font = 'bold 13px Roboto, Arial, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.strokeStyle = '#fff'; c.lineWidth = 3; c.strokeText(text, x, y);
        c.fillStyle = '#2c3e50'; c.fillText(text, x, y);
        c.restore();
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

        populate();
    }

    return { init, populate };
})();
