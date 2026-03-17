// --- GESTION DE LA NAVIGATION ---
function showSection(sectionId) {
    const sections = document.querySelectorAll('.view-section');
    sections.forEach(section => section.classList.add('hidden'));
    
    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.classList.remove('hidden');

    if(sectionId === 'terrain') resizeCanvas();
    if(sectionId === 'drill') populateDrillForm(); 
}

// --- LOGIQUE DU MODULE MATÉRIEL (PROFIL) ---
let inventory = JSON.parse(localStorage.getItem('airsoftInventory')) || [];
function renderInventory() { 
    const listContainer = document.getElementById('equipment-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    if (inventory.length === 0) { listContainer.innerHTML = '<p style="color:#777; font-style:italic;">Vide.</p>'; return; }
    inventory.forEach((item, index) => {
        const card = document.createElement('div'); card.className = 'equipment-card';
        card.innerHTML = `<button class="delete-btn" onclick="deleteItem(${index})">X</button><span class="category">${item.category}</span><h4>${item.name}</h4><p>${item.details}</p>`;
        listContainer.appendChild(card);
    });
}
function deleteItem(index) { inventory.splice(index, 1); localStorage.setItem('airsoftInventory', JSON.stringify(inventory)); renderInventory(); }
const eqForm = document.getElementById('equipment-form');
if(eqForm) { eqForm.addEventListener('submit', function(e) { e.preventDefault(); inventory.push({ category: document.getElementById('eq-category').value, name: document.getElementById('eq-name').value, details: document.getElementById('eq-details').value }); localStorage.setItem('airsoftInventory', JSON.stringify(inventory)); renderInventory(); this.reset(); }); }

// --- LOGIQUE DU MODULE TERRAIN ---
const canvas = document.getElementById('terrain-canvas'); const ctx = canvas.getContext('2d');
let currentTool = 'wall'; let isDrawing = false; let startX = 0, startY = 0; let drawnElements = []; 
let terrains = JSON.parse(localStorage.getItem('airsoftTerrains')) || []; let editingTerrainIndex = -1; let currentUploadedPhoto = null; const PIXELS_PER_METER = 20; 

document.getElementById('terrain-photo-input').addEventListener('change', function(e) {
    const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onload = function(event) { currentUploadedPhoto = event.target.result; document.querySelector('label[for="terrain-photo-input"]').innerText = "✅ " + file.name; }; reader.readAsDataURL(file); }
});

function resizeCanvas() { canvas.width = canvas.parentElement.clientWidth - 40; redrawCanvas(); }
function setTool(tool) { currentTool = tool; document.querySelectorAll('.canvas-toolbar .tool-btn').forEach(btn => btn.classList.remove('active')); event.currentTarget.classList.add('active'); }
function clearCanvas() { drawnElements = []; redrawCanvas(); }
function calculateDistance(x1, y1, x2, y2) { return (Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) / PIXELS_PER_METER).toFixed(1); }
function drawTextLabel(t, x, y) { ctx.save(); ctx.font = "bold 14px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.strokeStyle = "#000"; ctx.lineWidth = 3; ctx.strokeText(t, x, y); ctx.fillStyle = "#fff"; ctx.fillText(t, x, y); ctx.restore(); }

canvas.addEventListener('mousedown', (e) => { isDrawing = true; const r = canvas.getBoundingClientRect(); startX = e.clientX - r.left; startY = e.clientY - r.top; if (currentTool === 'brush_in' || currentTool === 'brush_out') drawnElements.push({ type: currentTool, points: [{x: startX, y: startY}] }); });
canvas.addEventListener('mousemove', (e) => { if (!isDrawing) return; const r = canvas.getBoundingClientRect(); const cx = e.clientX - r.left; const cy = e.clientY - r.top; if (currentTool === 'brush_in' || currentTool === 'brush_out') { drawnElements[drawnElements.length - 1].points.push({x: cx, y: cy}); redrawCanvas(); } else { redrawCanvas(); drawShape(startX, startY, cx, cy, currentTool, true); } });
canvas.addEventListener('mouseup', (e) => { if (!isDrawing) return; isDrawing = false; const r = canvas.getBoundingClientRect(); const ex = e.clientX - r.left; const ey = e.clientY - r.top; if (currentTool !== 'brush_in' && currentTool !== 'brush_out') drawnElements.push({ type: currentTool, x1: startX, y1: startY, x2: ex, y2: ey }); redrawCanvas(); });

function drawShape(x1, y1, x2, y2, tool, isPreview = false) { ctx.beginPath(); if (tool === 'rect') { ctx.strokeStyle = isPreview ? '#4CAF50' : '#27ae60'; if (isPreview) ctx.setLineDash([5, 5]); ctx.fillStyle = 'rgba(76, 175, 80, 0.2)'; ctx.lineWidth = 2; ctx.fillRect(x1, y1, x2 - x1, y2 - y1); ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); ctx.setLineDash([]); const wM = (Math.abs(x2 - x1) / PIXELS_PER_METER).toFixed(1); const hM = (Math.abs(y2 - y1) / PIXELS_PER_METER).toFixed(1); drawTextLabel(`${wM}m x ${hM}m`, x1 + (x2-x1)/2, y1 + (y2-y1)/2); } else { setContextStyle(tool); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); const distM = calculateDistance(x1, y1, x2, y2); drawTextLabel(`${distM}m`, x1 + (x2-x1)/2, y1 + (y2-y1)/2); } }
function redrawCanvas() { ctx.clearRect(0, 0, canvas.width, canvas.height); drawnElements.forEach(el => { if (el.type === 'brush_in' || el.type === 'brush_out') { ctx.beginPath(); setContextStyle(el.type); ctx.moveTo(el.points[0].x, el.points[0].y); el.points.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke(); } else { drawShape(el.x1, el.y1, el.x2, el.y2, el.type); } }); }
function setContextStyle(tool) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; switch(tool) { case 'wall': ctx.strokeStyle = '#2c3e50'; ctx.lineWidth = 6; break; case 'door_single': ctx.strokeStyle = '#e67e22'; ctx.lineWidth = 4; break; case 'door_double': ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 6; break; case 'window': ctx.strokeStyle = '#3498db'; ctx.lineWidth = 4; break; case 'brush_in': ctx.strokeStyle = 'rgba(149, 165, 166, 0.5)'; ctx.lineWidth = 20; break; case 'brush_out': ctx.strokeStyle = 'rgba(39, 174, 96, 0.5)'; ctx.lineWidth = 20; break; } }

function saveTerrain() { const name = document.getElementById('terrain-name').value; const type = document.getElementById('terrain-type').value; if (!name) { alert("Nommez le terrain !"); return; } const mapImage = canvas.toDataURL("image/png"); const tData = { name: name, type: type, image: mapImage, photo: currentUploadedPhoto, data: drawnElements }; if (editingTerrainIndex > -1) { if(!currentUploadedPhoto && terrains[editingTerrainIndex].photo) tData.photo = terrains[editingTerrainIndex].photo; terrains[editingTerrainIndex] = tData; editingTerrainIndex = -1; document.getElementById('edit-mode-indicator').style.display = "none"; } else terrains.push(tData); localStorage.setItem('airsoftTerrains', JSON.stringify(terrains)); renderTerrains(); document.getElementById('terrain-name').value = ''; document.querySelector('label[for="terrain-photo-input"]').innerText = "📸 Ajouter photo"; currentUploadedPhoto = null; document.getElementById('terrain-photo-input').value = ""; clearCanvas(); }
function editTerrain(i) { const t = terrains[i]; editingTerrainIndex = i; document.getElementById('terrain-name').value = t.name; document.getElementById('terrain-type').value = t.type; document.getElementById('edit-mode-indicator').style.display = "inline"; drawnElements = JSON.parse(JSON.stringify(t.data)); redrawCanvas(); document.querySelector('.content').scrollTo({ top: 0, behavior: 'smooth' }); }
function renderTerrains() { const c = document.getElementById('terrain-list'); if (!c) return; c.innerHTML = ''; if (terrains.length === 0) { c.innerHTML = '<p style="color:#777; font-style:italic;">Aucun terrain.</p>'; return; } terrains.forEach((t, i) => { const div = document.createElement('div'); div.className = 'equipment-card'; const photo = t.photo ? `<img src="${t.photo}">` : ''; div.innerHTML = `<button class="delete-btn" onclick="deleteTerrain(${i})">X</button><button class="edit-btn" onclick="editTerrain(${i})">✏️ Éditer</button><span class="category">${t.type}</span><h4>${t.name}</h4><div class="terrain-images-container"><img src="${t.image}">${photo}</div>`; c.appendChild(div); }); }
function deleteTerrain(i) { if(confirm("Supprimer ?")) { terrains.splice(i, 1); localStorage.setItem('airsoftTerrains', JSON.stringify(terrains)); renderTerrains(); } }

// --- LOGIQUE DU MODULE LOGISTIQUE ---
let logisticsItems = JSON.parse(localStorage.getItem('airsoftLogisticsItems')) || []; let logisticsDocs = JSON.parse(localStorage.getItem('airsoftLogisticsDocs')) || []; let currentLogItemPhoto = null; let currentLogDocFile = null;

document.getElementById('log-item-photo').addEventListener('change', function(e) { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload = function(ev) { currentLogItemPhoto = ev.target.result; document.getElementById('log-item-photo-label').innerText = "✅ " + f.name; }; r.readAsDataURL(f); } });
document.getElementById('log-doc-file').addEventListener('change', function(e) { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload = function(ev) { currentLogDocFile = ev.target.result; document.getElementById('log-doc-file-label').innerText = "✅ " + f.name; }; r.readAsDataURL(f); } });

function renderLogisticsItems() { const c = document.getElementById('logistics-item-list'); if (!c) return; c.innerHTML = ''; if (logisticsItems.length === 0) { c.innerHTML = '<p style="color:#777; font-style:italic;">Vide.</p>'; return; } logisticsItems.forEach((it, i) => { const div = document.createElement('div'); div.className = 'equipment-card'; const photo = it.photo ? `<img src="${it.photo}" style="width:100%; height:100px; object-fit:cover; margin-top:10px;">` : ''; div.innerHTML = `<button class="delete-btn" onclick="deleteLogisticsItem(${i})">X</button><span class="category">Qté : ${it.qty}</span><h4>${it.name}</h4>${photo}`; c.appendChild(div); }); }
function deleteLogisticsItem(i) { logisticsItems.splice(i, 1); localStorage.setItem('airsoftLogisticsItems', JSON.stringify(logisticsItems)); renderLogisticsItems(); }
const logItemForm = document.getElementById('logistics-item-form'); if(logItemForm) { logItemForm.addEventListener('submit', function(e) { e.preventDefault(); logisticsItems.push({ name: document.getElementById('log-item-name').value, qty: document.getElementById('log-item-qty').value, photo: currentLogItemPhoto }); localStorage.setItem('airsoftLogisticsItems', JSON.stringify(logisticsItems)); renderLogisticsItems(); this.reset(); currentLogItemPhoto = null; document.getElementById('log-item-photo-label').innerText = "Choisir une image"; }); }

function renderLogisticsDocs() { const c = document.getElementById('logistics-doc-list'); if (!c) return; c.innerHTML = ''; if (logisticsDocs.length === 0) { c.innerHTML = '<p style="color:#777; font-style:italic;">Vide.</p>'; return; } logisticsDocs.forEach((doc, i) => { const div = document.createElement('div'); div.className = 'equipment-card'; const isPdf = doc.file && doc.file.startsWith('data:application/pdf'); let fileHtml = ''; if (doc.file) { if (isPdf) fileHtml = `<a href="${doc.file}" download="${doc.title}.pdf" style="display:inline-block; margin-top:10px; color:#3498db; text-decoration:none; font-size:0.9em; border:1px solid #3498db; padding:5px; border-radius:4px;">📥 Télécharger</a>`; else fileHtml = `<img src="${doc.file}" style="width:100%; height:100px; object-fit:cover; margin-top:10px;">`; } div.innerHTML = `<button class="delete-btn" onclick="deleteLogisticsDoc(${i})">X</button><span class="category">${doc.type}</span><h4>${doc.title}</h4>${fileHtml}`; c.appendChild(div); }); }
function deleteLogisticsDoc(i) { logisticsDocs.splice(i, 1); localStorage.setItem('airsoftLogisticsDocs', JSON.stringify(logisticsDocs)); renderLogisticsDocs(); }
const logDocForm = document.getElementById('logistics-doc-form'); if(logDocForm) { logDocForm.addEventListener('submit', function(e) { e.preventDefault(); logisticsDocs.push({ title: document.getElementById('log-doc-title').value, type: document.getElementById('log-doc-type').value, file: currentLogDocFile }); localStorage.setItem('airsoftLogisticsDocs', JSON.stringify(logisticsDocs)); renderLogisticsDocs(); this.reset(); currentLogDocFile = null; document.getElementById('log-doc-file-label').innerText = "Importer un fichier"; }); }

// --- LOGIQUE DU MODULE IA & CRÉATION DE DRILL ---

// 1. Sauvegarde de la clé API
const apiKeyInput = document.getElementById('gemini-api-key');
if(localStorage.getItem('geminiApiKey')) apiKeyInput.value = localStorage.getItem('geminiApiKey');
function saveApiKey() {
    localStorage.setItem('geminiApiKey', apiKeyInput.value);
    alert("Clé API sauvegardée !");
}

// 2. Peupler les listes déroulantes
function populateDrillForm() {
    const terrainSelect = document.getElementById('drill-terrain-select');
    terrainSelect.innerHTML = '<option value="">-- Sélectionnez un terrain enregistré --</option>';
    terrains.forEach((t, i) => {
        terrainSelect.innerHTML += `<option value="${i}">${t.name} (${t.type})</option>`;
    });

    const matContainer = document.getElementById('drill-material-checkboxes');
    matContainer.innerHTML = '';
    if (logisticsItems.length === 0) {
        matContainer.innerHTML = '<p style="color: #777; font-style: italic;">Aucun matériel logistique disponible.</p>';
    } else {
        logisticsItems.forEach((it, i) => {
            matContainer.innerHTML += `
                <div class="checkbox-item">
                    <input type="checkbox" id="chk-mat-${i}" value="${it.name}" data-qty="${it.qty}">
                    <label for="chk-mat-${i}">${it.name} (Max: ${it.qty})</label>
                </div>
            `;
        });
    }
}

// 3. Appel API et Génération
document.getElementById('generate-drill-btn').addEventListener('click', async () => {
    const apiKey = localStorage.getItem('geminiApiKey');
    const terrainIndex = document.getElementById('drill-terrain-select').value;
    const userPrompt = document.getElementById('drill-prompt').value;

    if (!apiKey) return alert("Veuillez entrer et sauvegarder une clé API Gemini.");
    if (terrainIndex === "") return alert("Veuillez sélectionner un terrain.");

    const selectedTerrain = terrains[terrainIndex];

    let selectedMaterials = [];
    document.querySelectorAll('#drill-material-checkboxes input[type="checkbox"]:checked').forEach(chk => {
        selectedMaterials.push(`${chk.value} (x${chk.getAttribute('data-qty')})`);
    });

    let docContext = logisticsDocs.map(d => `- ${d.title} (${d.type})`).join("\n");

    document.getElementById('drill-loading').style.display = "block";
    document.getElementById('drill-result-content').style.display = "none";

    const systemPrompt = `
    Tu es un instructeur expert en entraînement tactique Airsoft. 
    L'utilisateur te demande de créer un exercice (Drill).
    
    CONTEXTE :
    - Inventaire du joueur : ${JSON.stringify(inventory.map(i => i.name))}
    - Matériel disponible pour le drill : ${selectedMaterials.length > 0 ? selectedMaterials.join(', ') : 'Aucun spécifique'}
    - Documents de référence (inspirations possibles) : \n${docContext}
    - Terrain sélectionné : ${selectedTerrain.name} (${selectedTerrain.type})
    - Données topographiques du terrain en JSON (murs, portes) : ${JSON.stringify(selectedTerrain.data)}
    
    DEMANDE SPÉCIFIQUE DU JOUEUR :
    "${userPrompt}"
    
    INSTRUCTION DE SORTIE STRICTE :
    Tu DOIS répondre UNIQUEMENT avec un objet JSON valide (aucun autre texte avant ou après).
    Le JSON doit avoir exactement cette structure :
    {
        "markdown_text": "Ici ton explication complète du drill en markdown (matériel à préparer, chemin, tirs à effectuer). Utilise des titres, du gras.",
        "map_overlays": [
            { "type": "target", "x": 100, "y": 150 },
            { "type": "start_point", "x": 50, "y": 50 },
            { "type": "path", "points": [ {"x":50,"y":50}, {"x":100,"y":100}, {"x":150,"y":200} ] }
        ]
    }
    Notes pour map_overlays: Les coordonnées (x,y) doivent correspondre proportionnellement à un canvas de 900x500 pixels. Base-toi sur les données topographiques pour placer logiquement les cibles (ex: derrière un mur ou une fenêtre).
    `;

    try {
        // CORRECTION ICI : Changement du nom du modèle vers gemini-1.5-flash-latest
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });

        const data = await response.json();
        
        if(data.error) {
            throw new Error(data.error.message);
        }

        const aiResponseText = data.candidates[0].content.parts[0].text;
        const resultJSON = JSON.parse(aiResponseText);

        document.getElementById('drill-loading').style.display = "none";
        document.getElementById('drill-result-content').style.display = "block";

        const textContainer = document.getElementById('drill-result-text');
        textContainer.innerHTML = resultJSON.markdown_text
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
            .replace(/\n/gim, '<br>');

        drawResultCanvas(selectedTerrain, resultJSON.map_overlays);

    } catch (error) {
        document.getElementById('drill-loading').style.display = "none";
        alert("Erreur lors de la communication avec l'IA : " + error.message);
        console.error(error);
    }
});

function drawResultCanvas(terrain, overlays) {
    const resCanvas = document.getElementById('drill-result-canvas');
    resCanvas.width = 900; 
    resCanvas.height = 500;
    const resCtx = resCanvas.getContext('2d');
    
    resCtx.clearRect(0, 0, resCanvas.width, resCanvas.height);
    terrain.data.forEach(el => {
        if (el.type === 'brush_in' || el.type === 'brush_out') {
            resCtx.beginPath();
            resCtx.lineCap = 'round'; resCtx.lineJoin = 'round';
            resCtx.strokeStyle = el.type === 'brush_in' ? 'rgba(149, 165, 166, 0.5)' : 'rgba(39, 174, 96, 0.5)';
            resCtx.lineWidth = 20;
            resCtx.moveTo(el.points[0].x, el.points[0].y);
            el.points.forEach(p => resCtx.lineTo(p.x, p.y));
            resCtx.stroke();
        } else {
            resCtx.beginPath();
            resCtx.lineCap = 'round'; resCtx.lineJoin = 'round';
            if(el.type === 'rect') {
                resCtx.fillStyle = 'rgba(76, 175, 80, 0.2)'; resCtx.strokeStyle = '#27ae60'; resCtx.lineWidth = 2;
                resCtx.fillRect(el.x1, el.y1, el.x2 - el.x1, el.y2 - el.y1);
                resCtx.strokeRect(el.x1, el.y1, el.x2 - el.x1, el.y2 - el.y1);
            } else {
                switch(el.type) {
                    case 'wall': resCtx.strokeStyle = '#2c3e50'; resCtx.lineWidth = 6; break;
                    case 'door_single': resCtx.strokeStyle = '#e67e22'; resCtx.lineWidth = 4; break;
                    case 'door_double': resCtx.strokeStyle = '#f1c40f'; resCtx.lineWidth = 6; break;
                    case 'window': resCtx.strokeStyle = '#3498db'; resCtx.lineWidth = 4; break;
                }
                resCtx.moveTo(el.x1, el.y1); resCtx.lineTo(el.x2, el.y2); resCtx.stroke();
            }
        }
    });

    if(overlays && overlays.length > 0) {
        overlays.forEach(item => {
            if (item.type === 'target') {
                resCtx.beginPath();
                resCtx.arc(item.x, item.y, 10, 0, 2 * Math.PI);
                resCtx.fillStyle = '#e74c3c';
                resCtx.fill();
                resCtx.lineWidth = 2;
                resCtx.strokeStyle = '#c0392b';
                resCtx.stroke();
                resCtx.beginPath(); resCtx.moveTo(item.x-10, item.y); resCtx.lineTo(item.x+10, item.y); resCtx.stroke();
                resCtx.beginPath(); resCtx.moveTo(item.x, item.y-10); resCtx.lineTo(item.x, item.y+10); resCtx.stroke();
            
            } else if (item.type === 'start_point') {
                resCtx.fillStyle = '#2ecc71';
                resCtx.fillRect(item.x - 10, item.y - 10, 20, 20);
                resCtx.fillStyle = '#fff';
                resCtx.font = "12px Arial";
                resCtx.fillText("Départ", item.x, item.y - 15);
            
            } else if (item.type === 'path' && item.points && item.points.length > 0) {
                resCtx.beginPath();
                resCtx.setLineDash([5, 10]);
                resCtx.strokeStyle = '#f1c40f';
                resCtx.lineWidth = 3;
                resCtx.moveTo(item.points[0].x, item.points[0].y);
                for(let i=1; i<item.points.length; i++) {
                    resCtx.lineTo(item.points[i].x, item.points[i].y);
                }
                resCtx.stroke();
                resCtx.setLineDash([]); 
            }
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    showSection('profil');
    renderInventory();
    renderTerrains();
    renderLogisticsItems();
    renderLogisticsDocs();
    
    window.addEventListener('resize', () => {
        if(document.getElementById('terrain').classList.contains('hidden') === false) { resizeCanvas(); }
    });
});