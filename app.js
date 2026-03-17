// =========================================================================
// CONFIGURATION FIREBASE
// =========================================================================
const firebaseConfig = {
    apiKey: "AIzaSyBrGNctT20_o4gmCa2jSN-mXcUQLThPhME",
    authDomain: "drillairsoft.firebaseapp.com",
    projectId: "drillairsoft",
    storageBucket: "drillairsoft.firebasestorage.app",
    messagingSenderId: "149175230851",
    appId: "1:149175230851:web:d75765c7d12330715116b6"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null; 

// --- VARIABLES GLOBALES DE DONNÉES ---
let inventory = JSON.parse(localStorage.getItem('airsoftInventory')) || [];
let terrains = JSON.parse(localStorage.getItem('airsoftTerrains')) || [];
let logisticsItems = JSON.parse(localStorage.getItem('airsoftLogisticsItems')) || [];
let logisticsDocs = JSON.parse(localStorage.getItem('airsoftLogisticsDocs')) || [];

// =========================================================================
// GESTION DE L'AUTHENTIFICATION & SYNCHRONISATION
// =========================================================================

// Fonctions pour ouvrir/fermer la fenêtre modale de connexion
function openAuthModal() { document.getElementById('auth-modal').classList.remove('hidden'); }
function closeAuthModal() { document.getElementById('auth-modal').classList.add('hidden'); }

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        const displayName = user.displayName || user.email.split('@')[0];
        document.getElementById('login-btn').innerText = `Déconnexion (${displayName})`;
        document.getElementById('login-btn').style.backgroundColor = "#c0392b"; 
        loadDataFromFirebase();
    } else {
        currentUser = null;
        document.getElementById('login-btn').innerText = "Se connecter";
        document.getElementById('login-btn').style.backgroundColor = "#6b8e23"; 
    }
});

document.getElementById('login-btn').addEventListener('click', () => {
    if (currentUser) {
        auth.signOut().then(() => {
            alert("Déconnecté avec succès.");
            location.reload(); // On recharge pour vider l'écran de sécurité
        });
    } else {
        openAuthModal();
    }
});

// Connexion Email
function loginWithEmail() {
    const email = document.getElementById('auth-email').value;
    const pwd = document.getElementById('auth-password').value;
    if(!email || !pwd) return alert("Remplissez l'email et le mot de passe.");
    auth.signInWithEmailAndPassword(email, pwd)
        .then(() => closeAuthModal())
        .catch(err => alert("Erreur de connexion : " + err.message));
}

// Inscription Email
function registerWithEmail() {
    const email = document.getElementById('auth-email').value;
    const pwd = document.getElementById('auth-password').value;
    if(!email || !pwd) return alert("Remplissez l'email et le mot de passe.");
    auth.createUserWithEmailAndPassword(email, pwd)
        .then(() => { alert("Compte créé avec succès !"); closeAuthModal(); })
        .catch(err => alert("Erreur d'inscription : " + err.message));
}

// Connexion Google
function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(() => closeAuthModal())
        .catch(err => alert("Erreur de connexion : " + err.message));
}

async function loadDataFromFirebase() {
    if (!currentUser) return;
    try {
        const docRef = db.collection('users').doc(currentUser.uid);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            const data = docSnap.data();
            inventory = data.inventory || [];
            terrains = data.terrains || [];
            logisticsItems = data.logisticsItems || [];
            logisticsDocs = data.logisticsDocs || [];
            if(data.geminiApiKey) {
                localStorage.setItem('geminiApiKey', data.geminiApiKey);
                document.getElementById('gemini-api-key').value = data.geminiApiKey;
            }
            
            localStorage.setItem('airsoftInventory', JSON.stringify(inventory));
            localStorage.setItem('airsoftTerrains', JSON.stringify(terrains));
            localStorage.setItem('airsoftLogisticsItems', JSON.stringify(logisticsItems));
            localStorage.setItem('airsoftLogisticsDocs', JSON.stringify(logisticsDocs));

            renderAllViews();
        }
    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
    }
}

function syncDataToFirebase() {
    if (!currentUser) return; 
    db.collection('users').doc(currentUser.uid).set({
        inventory: inventory,
        terrains: terrains,
        logisticsItems: logisticsItems,
        logisticsDocs: logisticsDocs,
        geminiApiKey: localStorage.getItem('geminiApiKey') || ''
    }).catch(error => console.error("Erreur de synchronisation : ", error));
}

function renderAllViews() {
    renderInventory();
    renderTerrains();
    renderLogisticsItems();
    renderLogisticsDocs();
    populateDrillForm();
}

// =========================================================================
// --- GESTION DE LA NAVIGATION ---
// =========================================================================
function showSection(sectionId) {
    const sections = document.querySelectorAll('.view-section');
    sections.forEach(section => section.classList.add('hidden'));
    
    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.classList.remove('hidden');

    if(sectionId === 'terrain') resizeCanvas();
    if(sectionId === 'drill') populateDrillForm(); 
}

// =========================================================================
// --- LOGIQUE DU MODULE MATÉRIEL (PROFIL) ---
// =========================================================================
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
function deleteItem(index) { 
    inventory.splice(index, 1); 
    localStorage.setItem('airsoftInventory', JSON.stringify(inventory)); 
    syncDataToFirebase();
    renderInventory(); 
}
const eqForm = document.getElementById('equipment-form');
if(eqForm) { 
    eqForm.addEventListener('submit', function(e) { 
        e.preventDefault(); 
        inventory.push({ 
            category: document.getElementById('eq-category').value, 
            name: document.getElementById('eq-name').value, 
            details: document.getElementById('eq-details').value 
        }); 
        localStorage.setItem('airsoftInventory', JSON.stringify(inventory)); 
        syncDataToFirebase();
        renderInventory(); 
        this.reset(); 
    }); 
}

// =========================================================================
// --- LOGIQUE DU MODULE TERRAIN ---
// =========================================================================
const canvas = document.getElementById('terrain-canvas'); const ctx = canvas.getContext('2d');
let currentTool = 'wall'; let isDrawing = false; let startX = 0, startY = 0; let drawnElements = []; 
let editingTerrainIndex = -1; let currentUploadedPhoto = null; const PIXELS_PER_METER = 20; 

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

function drawShape(x1, y1, x2, y2, tool, isPreview = false) { ctx.beginPath(); if (tool === 'rect') { ctx.strokeStyle = isPreview ? '#4
