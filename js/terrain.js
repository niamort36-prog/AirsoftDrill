/* =========================================================================
 * TERRAIN.JS — Page « Terrains » : éditeur de plan + bibliothèque
 * -------------------------------------------------------------------------
 * L'éditeur travaille dans un repère « monde » en pixels (20 px = 1 m),
 * affiché à travers une vue zoomable/déplaçable (molette, pincement à deux
 * doigts, boutons ➕/➖/Ajuster, outil ✋). On peut donc dessiner des
 * terrains bien plus grands que l'écran ; l'emprise réelle (width/height)
 * est recalculée automatiquement à la sauvegarde, et reste le repère
 * commun avec la carte de résultat et l'IA.
 *
 * Aides au dessin :
 *  - aimantation des extrémités de murs entre elles (indicateur vert) ;
 *  - contrainte d'angles 0/45/90° activable (📐 Angles droits) ;
 *  - portes posées SUR un mur (0,9 m / 1,8 m), orientées et découpées ;
 *  - cotes discrètes, taille constante à l'écran, masquables (📏) ;
 *  - protections prédéfinies (voiture, buisson, muret...) posées au clic,
 *    orientables au glisser, décrites tactiquement à l'IA.
 * ========================================================================= */

const TerrainEditor = (() => {
    'use strict';

    const PPM = Schema.PIXELS_PER_METER;
    const CANVAS_W = 900, CANVAS_H = 500;             // buffer d'affichage fixe
    const MIN_WORLD_W = Schema.TERRAIN_WIDTH;         // emprise minimale sauvegardée
    const MIN_WORLD_H = Schema.TERRAIN_HEIGHT;
    const DOOR_PX = {
        door_single: Math.round(Schema.DOOR_WIDTH_M.door_single * PPM),
        door_double: Math.round(Schema.DOOR_WIDTH_M.door_double * PPM)
    };
    const SNAP_SCREEN_PX = 14;                        // rayon d'aimantation (px écran)
    const SCALE_MIN = 0.15, SCALE_MAX = 4;
    const SAVE_MARGIN = 40;                           // marge autour du dessin (px monde)
    const PHOTO_LABEL_DEFAULT = '📸 Ajouter une photo';

    let canvas, ctx;
    let currentTool = 'wall';
    let coverKind = 'voiture';
    let elements = [];
    let editingId = null, editingPhoto = null, newPhoto = null;

    // Vue : world -> screen : s = (w - view.x|y) * view.scale
    const view = { scale: 1, x: 0, y: 0 };

    // Options d'aide au dessin
    let orthoOn = true;
    let labelsOn = true;

    // État du geste en cours
    let drawing = false;
    let start = null;          // départ (monde) d'un segment
    let previewEl = null;      // élément en prévisualisation (non commité)
    let snapIndicator = null;  // point aimanté à surligner
    let panLast = null;
    const activePointers = new Map(); // pour le pincement à deux doigts
    let pinchState = null;

    function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

    // --- Conversions écran <-> monde -----------------------------------------
    function toWorld(e) {
        const r = canvas.getBoundingClientRect();
        const sx = (e.clientX - r.left) * (CANVAS_W / r.width);
        const sy = (e.clientY - r.top) * (CANVAS_H / r.height);
        return { x: sx / view.scale + view.x, y: sy / view.scale + view.y };
    }

    // --- Aides au dessin --------------------------------------------------------
    /** Aimante p sur l'extrémité de segment existante la plus proche. */
    function snapPoint(p) {
        const thr = SNAP_SCREEN_PX / view.scale;
        let best = null, bestD = thr;
        for (const el of elements) {
            if (el.x1 === undefined) continue;
            for (const q of [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }]) {
                const d = Math.hypot(q.x - p.x, q.y - p.y);
                if (d < bestD) { bestD = d; best = q; }
            }
        }
        return best;
    }

    /** Contraint b sur un angle multiple de 45° autour de a. */
    function applyOrtho(a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (!dist) return b;
        const step = Math.PI / 4;
        const ang = Math.round(Math.atan2(dy, dx) / step) * step;
        return { x: a.x + dist * Math.cos(ang), y: a.y + dist * Math.sin(ang) };
    }

    /** Point le plus proche sur un mur existant (pour poser une porte). */
    function nearestWallPoint(p) {
        const thr = 22 / view.scale;
        let best = null;
        for (const el of elements) {
            if (el.type !== 'wall') continue;
            const vx = el.x2 - el.x1, vy = el.y2 - el.y1;
            const len2 = vx * vx + vy * vy;
            if (!len2) continue;
            let t = ((p.x - el.x1) * vx + (p.y - el.y1) * vy) / len2;
            t = clamp(t, 0, 1);
            const q = { x: el.x1 + t * vx, y: el.y1 + t * vy };
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d < thr && (!best || d < best.d)) best = { d, el, t, len: Math.sqrt(len2) };
        }
        return best;
    }

    /** Porte de largeur fixe, centrée au point cliqué, glissée le long du mur. */
    function doorOnWall(hit, tool) {
        const dLen = Math.min(DOOR_PX[tool], hit.len);
        const ux = (hit.el.x2 - hit.el.x1) / hit.len;
        const uy = (hit.el.y2 - hit.el.y1) / hit.len;
        const half = dLen / 2;
        const c = clamp(hit.t * hit.len, half, hit.len - half);
        return {
            type: tool,
            x1: hit.el.x1 + ux * (c - half), y1: hit.el.y1 + uy * (c - half),
            x2: hit.el.x1 + ux * (c + half), y2: hit.el.y1 + uy * (c + half)
        };
    }

    function isCoverLine() { return currentTool === 'cover' && Schema.COVER_KINDS[coverKind].shape === 'line'; }
    function isSegmentTool() {
        return currentTool === 'wall' || currentTool === 'window' || currentTool === 'rect' || isCoverLine();
    }

    function makeSegmentEl(a, b) {
        if (isCoverLine()) return { type: 'cover_line', kind: coverKind, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        return { type: currentTool, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }

    /** Libellé auto du prochain point de départ : D1, D2, ... */
    function nextStartLabel() {
        return 'D' + (elements.filter(e => e.type === 'start_point').length + 1);
    }

    // --- Rendu -------------------------------------------------------------------
    function setStyle(c, tool) {
        c.lineCap = 'round'; c.lineJoin = 'round';
        switch (tool) {
            case 'wall': c.strokeStyle = '#2c3e50'; c.lineWidth = 6; break;
            case 'window': c.strokeStyle = '#3498db'; c.lineWidth = 4; break;
            case 'brush_in': c.strokeStyle = 'rgba(149, 165, 166, 0.5)'; c.lineWidth = 20; break;
            case 'brush_out': c.strokeStyle = 'rgba(39, 174, 96, 0.5)'; c.lineWidth = 20; break;
        }
    }

    /** Cote discrète : petite étiquette décalée de la ligne, taille constante
     *  à l'écran (divisée par le zoom), fond translucide — ne masque plus le dessin. */
    function drawDistLabel(c, text, x, y, opts) {
        const s = (opts && opts.scale) || 1;
        c.save();
        c.font = `bold ${11 / s}px Roboto, Arial, sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        const w = c.measureText(text).width;
        c.fillStyle = 'rgba(255,255,255,0.78)';
        c.fillRect(x - w / 2 - 4 / s, y - 8 / s, w + 8 / s, 16 / s);
        c.fillStyle = '#37474f';
        c.fillText(text, x, y);
        c.restore();
    }

    function segmentLabel(c, el, opts) {
        const dx = el.x2 - el.x1, dy = el.y2 - el.y1;
        const len = Math.hypot(dx, dy);
        if (!len) return;
        const s = (opts && opts.scale) || 1;
        // décalage perpendiculaire pour laisser la ligne visible
        const nx = -dy / len, ny = dx / len;
        const off = 16 / s;
        drawDistLabel(c, (len / PPM).toFixed(1) + ' m',
            el.x1 + dx / 2 + nx * off, el.y1 + dy / 2 + ny * off, opts);
    }

    function drawShape(c, el, opts) {
        opts = opts || {};
        c.beginPath();
        if (el.type === 'rect') {
            c.strokeStyle = opts.preview ? '#4CAF50' : '#27ae60';
            if (opts.preview) c.setLineDash([5, 5]);
            c.fillStyle = 'rgba(76, 175, 80, 0.2)';
            c.lineWidth = 2;
            c.fillRect(el.x1, el.y1, el.x2 - el.x1, el.y2 - el.y1);
            c.strokeRect(el.x1, el.y1, el.x2 - el.x1, el.y2 - el.y1);
            c.setLineDash([]);
            if (opts.labels || opts.preview) {
                const wM = (Math.abs(el.x2 - el.x1) / PPM).toFixed(1);
                const hM = (Math.abs(el.y2 - el.y1) / PPM).toFixed(1);
                drawDistLabel(c, `${wM} × ${hM} m`, el.x1 + (el.x2 - el.x1) / 2, Math.min(el.y1, el.y2) + 12 / (opts.scale || 1), opts);
            }
        } else if (el.type === 'brush_in' || el.type === 'brush_out') {
            setStyle(c, el.type);
            if (!el.points.length) return;
            c.moveTo(el.points[0].x, el.points[0].y);
            el.points.forEach(p => c.lineTo(p.x, p.y));
            c.stroke();
        } else if (el.type === 'door_single' || el.type === 'door_double') {
            // Porte intégrée : on « découpe » le mur puis on dessine le battant
            c.save();
            c.lineCap = 'butt';
            c.strokeStyle = '#cfd8dc'; c.lineWidth = 10;
            c.beginPath(); c.moveTo(el.x1, el.y1); c.lineTo(el.x2, el.y2); c.stroke();
            c.strokeStyle = el.type === 'door_single' ? '#e67e22' : '#f1c40f';
            c.lineWidth = 4;
            if (opts.preview) c.setLineDash([4, 4]);
            c.beginPath(); c.moveTo(el.x1, el.y1); c.lineTo(el.x2, el.y2); c.stroke();
            c.setLineDash([]);
            // butoirs aux extrémités (perpendiculaires au mur)
            const dx = el.x2 - el.x1, dy = el.y2 - el.y1;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len * 5, ny = dx / len * 5;
            c.strokeStyle = '#2c3e50'; c.lineWidth = 3;
            c.beginPath();
            c.moveTo(el.x1 - nx, el.y1 - ny); c.lineTo(el.x1 + nx, el.y1 + ny);
            c.moveTo(el.x2 - nx, el.y2 - ny); c.lineTo(el.x2 + nx, el.y2 + ny);
            c.stroke();
            c.restore();
        } else if (el.type === 'start_point') {
            // Point de départ possible : carré vert CREUX (l'IA remplira celui
            // qu'elle choisit sur la carte de résultat) + libellé D1, D2...
            c.save();
            c.lineWidth = 3;
            c.strokeStyle = '#1e8449';
            c.fillStyle = 'rgba(46, 204, 113, 0.25)';
            if (opts.preview) c.setLineDash([4, 4]);
            c.beginPath();
            if (c.roundRect) c.roundRect(el.x - 10, el.y - 10, 20, 20, 3);
            else c.rect(el.x - 10, el.y - 10, 20, 20);
            c.fill(); c.stroke();
            c.setLineDash([]);
            c.restore();
            // le libellé identifie le point : toujours affiché
            drawDistLabel(c, el.label || 'D?', el.x, el.y + 22 / ((opts && opts.scale) || 1), opts);
        } else if (el.type === 'cover_line') {
            const k = Schema.COVER_KINDS[el.kind] || {};
            c.save();
            c.lineCap = 'round';
            c.strokeStyle = k.stroke || '#78909c';
            c.lineWidth = el.kind === 'muret' ? 8 : 6;
            if (el.kind === 'palissade') c.setLineDash([12, 5]);
            if (opts.preview) c.setLineDash([4, 4]);
            c.beginPath(); c.moveTo(el.x1, el.y1); c.lineTo(el.x2, el.y2); c.stroke();
            c.setLineDash([]);
            c.restore();
            if (opts.labels || opts.preview) segmentLabel(c, el, opts);
        } else if (el.type === 'cover_rect') {
            const k = Schema.COVER_KINDS[el.kind] || {};
            c.save();
            c.translate(el.x, el.y);
            c.rotate(el.rot || 0);
            c.fillStyle = k.fill || 'rgba(120,120,120,0.7)';
            c.strokeStyle = k.stroke || '#555';
            c.lineWidth = 2;
            if (opts.preview) c.setLineDash([4, 4]);
            if (el.kind === 'buisson') {
                c.beginPath();
                c.ellipse(0, 0, el.w / 2, el.h / 2, 0, 0, 2 * Math.PI);
                c.fill(); c.stroke();
            } else {
                c.beginPath();
                if (c.roundRect) c.roundRect(-el.w / 2, -el.h / 2, el.w, el.h, 4);
                else c.rect(-el.w / 2, -el.h / 2, el.w, el.h);
                c.fill(); c.stroke();
            }
            c.setLineDash([]);
            // émoji droit (annule la rotation), taille bornée
            c.rotate(-(el.rot || 0));
            const size = clamp(Math.min(el.w, el.h) * 0.8, 10, 30);
            c.font = `${size}px "Segoe UI Emoji", sans-serif`;
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(k.emoji || '❓', 0, 0);
            c.restore();
        } else {
            // wall / window
            setStyle(c, el.type);
            if (opts.preview) c.setLineDash([6, 4]);
            c.moveTo(el.x1, el.y1);
            c.lineTo(el.x2, el.y2);
            c.stroke();
            c.setLineDash([]);
            if (opts.labels || opts.preview) segmentLabel(c, el, opts);
        }
    }

    /** Dessine tous les éléments (portes en second pour découper les murs).
     *  Utilisé aussi par la carte de résultat du drill (transform identité). */
    function drawElements(c, els, opts) {
        opts = opts || { scale: 1, labels: false };
        els.forEach(el => { if (el.type !== 'door_single' && el.type !== 'door_double') drawShape(c, el, opts); });
        els.forEach(el => { if (el.type === 'door_single' || el.type === 'door_double') drawShape(c, el, opts); });
    }

    function drawGrid(c) {
        const x0 = view.x, y0 = view.y;
        const x1 = view.x + CANVAS_W / view.scale;
        const y1 = view.y + CANVAS_H / view.scale;
        const step = 5 * PPM; // quadrillage tous les 5 m
        c.save();
        c.lineWidth = 1 / view.scale;
        c.strokeStyle = 'rgba(38,50,56,0.10)';
        c.beginPath();
        for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { c.moveTo(x, y0); c.lineTo(x, y1); }
        for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { c.moveTo(x0, y); c.lineTo(x1, y); }
        c.stroke();
        c.restore();
    }

    function redraw() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.setTransform(view.scale, 0, 0, view.scale, -view.x * view.scale, -view.y * view.scale);
        drawGrid(ctx);
        drawElements(ctx, elements, { scale: view.scale, labels: labelsOn });
        if (previewEl) drawShape(ctx, previewEl, { scale: view.scale, labels: true, preview: true });
        if (snapIndicator) {
            ctx.beginPath();
            ctx.arc(snapIndicator.x, snapIndicator.y, 7 / view.scale, 0, 2 * Math.PI);
            ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 2.5 / view.scale; ctx.stroke();
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // --- Emprise du dessin ------------------------------------------------------
    function mergeBounds(b, x, y, pad) {
        b.minX = Math.min(b.minX, x - pad); b.minY = Math.min(b.minY, y - pad);
        b.maxX = Math.max(b.maxX, x + pad); b.maxY = Math.max(b.maxY, y + pad);
    }

    function contentBBox() {
        if (!elements.length) return null;
        const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const el of elements) {
            if (el.points) el.points.forEach(p => mergeBounds(b, p.x, p.y, 12));
            else if (el.type === 'cover_rect') {
                const half = Math.hypot(el.w, el.h) / 2; // englobe toute rotation
                mergeBounds(b, el.x, el.y, half);
            } else if (el.type === 'start_point') {
                mergeBounds(b, el.x, el.y, 28); // carré + libellé
            } else { mergeBounds(b, el.x1, el.y1, 6); mergeBounds(b, el.x2, el.y2, 6); }
        }
        return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
    }

    function updateDims() {
        const span = document.getElementById('terrain-dims');
        if (!span) return;
        const b = contentBBox();
        span.textContent = b
            ? `emprise dessinée : ${(Math.max(b.w, 1) / PPM).toFixed(1)} × ${(Math.max(b.h, 1) / PPM).toFixed(1)} m`
            : 'emprise dessinée : —';
    }

    // --- Zoom / pan -----------------------------------------------------------------
    function updateZoomLabel() {
        const el = document.getElementById('zoom-level');
        if (el) el.textContent = Math.round(view.scale * 100) + ' %';
    }

    function zoomAtScreen(sx, sy, factor) {
        const wx = sx / view.scale + view.x;
        const wy = sy / view.scale + view.y;
        view.scale = clamp(view.scale * factor, SCALE_MIN, SCALE_MAX);
        view.x = wx - sx / view.scale;
        view.y = wy - sy / view.scale;
        updateZoomLabel();
        redraw();
    }

    function zoomIn() { zoomAtScreen(CANVAS_W / 2, CANVAS_H / 2, 1.25); }
    function zoomOut() { zoomAtScreen(CANVAS_W / 2, CANVAS_H / 2, 1 / 1.25); }

    /** Cadre la vue sur le dessin (ou sur l'emprise minimale si vide). */
    function zoomFit() {
        const b = contentBBox() || { x: 0, y: 0, w: MIN_WORLD_W, h: MIN_WORLD_H };
        const pad = 30;
        view.scale = clamp(Math.min(CANVAS_W / (b.w + 2 * pad), CANVAS_H / (b.h + 2 * pad)), SCALE_MIN, SCALE_MAX);
        view.x = b.x - (CANVAS_W / view.scale - b.w) / 2;
        view.y = b.y - (CANVAS_H / view.scale - b.h) / 2;
        updateZoomLabel();
        redraw();
    }

    function onWheel(e) {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const sx = (e.clientX - r.left) * (CANVAS_W / r.width);
        const sy = (e.clientY - r.top) * (CANVAS_H / r.height);
        zoomAtScreen(sx, sy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }

    // Pincement à deux doigts : zoom + déplacement, quel que soit l'outil actif
    function beginPinch() {
        if (drawing && (currentTool === 'brush_in' || currentTool === 'brush_out')) elements.pop();
        drawing = false; previewEl = null; start = null; snapIndicator = null;
        const [a, b] = [...activePointers.values()];
        pinchState = {
            dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            scale: view.scale, vx: view.x, vy: view.y
        };
    }

    function updatePinch() {
        const [a, b] = [...activePointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const r = canvas.getBoundingClientRect();
        const kx = CANVAS_W / r.width, ky = CANVAS_H / r.height;
        // point monde initialement sous le centre du pincement
        const wx = (pinchState.center.x - r.left) * kx / pinchState.scale + pinchState.vx;
        const wy = (pinchState.center.y - r.top) * ky / pinchState.scale + pinchState.vy;
        view.scale = clamp(pinchState.scale * (dist / pinchState.dist), SCALE_MIN, SCALE_MAX);
        view.x = wx - (center.x - r.left) * kx / view.scale;
        view.y = wy - (center.y - r.top) * ky / view.scale;
        updateZoomLabel();
        redraw();
    }

    // --- Événements pointeur ------------------------------------------------------
    function onPointerDown(e) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size === 2) { beginPinch(); return; }
        if (pinchState) return;

        const p = toWorld(e);
        if (currentTool === 'pan') {
            panLast = { x: e.clientX, y: e.clientY };
            drawing = true;
            return;
        }
        drawing = true;
        if (currentTool === 'brush_in' || currentTool === 'brush_out') {
            elements.push({ type: currentTool, points: [p] });
        } else if (currentTool === 'door_single' || currentTool === 'door_double') {
            const hit = nearestWallPoint(p);
            if (!hit) {
                drawing = false;
                UI.toast('Cliquez sur un mur pour y intégrer la porte.', 'info');
                return;
            }
            previewEl = doorOnWall(hit, currentTool);
            redraw();
        } else if (currentTool === 'cover' && Schema.COVER_KINDS[coverKind].shape === 'rect') {
            const k = Schema.COVER_KINDS[coverKind];
            previewEl = { type: 'cover_rect', kind: coverKind, x: p.x, y: p.y, w: k.w * PPM, h: k.h * PPM, rot: 0 };
            redraw();
        } else if (currentTool === 'start_point') {
            previewEl = { type: 'start_point', x: p.x, y: p.y, label: nextStartLabel() };
            redraw();
        } else if (isSegmentTool()) {
            const s = snapPoint(p);
            start = s || p;
            snapIndicator = s;
            redraw();
        }
    }

    function onPointerMove(e) {
        if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinchState) { updatePinch(); return; }
        if (!drawing) return;
        e.preventDefault();

        if (currentTool === 'pan') {
            const r = canvas.getBoundingClientRect();
            view.x -= (e.clientX - panLast.x) * (CANVAS_W / r.width) / view.scale;
            view.y -= (e.clientY - panLast.y) * (CANVAS_H / r.height) / view.scale;
            panLast = { x: e.clientX, y: e.clientY };
            redraw();
            return;
        }

        const p = toWorld(e);
        if (currentTool === 'brush_in' || currentTool === 'brush_out') {
            elements[elements.length - 1].points.push(p);
            redraw();
        } else if (currentTool === 'door_single' || currentTool === 'door_double') {
            const hit = nearestWallPoint(p);
            if (hit) { previewEl = doorOnWall(hit, currentTool); redraw(); }
        } else if (previewEl && previewEl.type === 'cover_rect') {
            // le glisser depuis le centre définit l'orientation (pas de 15°)
            const d = Math.hypot(p.x - previewEl.x, p.y - previewEl.y);
            if (d > 10 / view.scale) {
                const step = Math.PI / 12;
                previewEl.rot = Math.round(Math.atan2(p.y - previewEl.y, p.x - previewEl.x) / step) * step;
            }
            redraw();
        } else if (previewEl && previewEl.type === 'start_point') {
            previewEl.x = p.x; previewEl.y = p.y;
            redraw();
        } else if (isSegmentTool() && start) {
            let end = p;
            const s = snapPoint(p);
            if (s && (s.x !== start.x || s.y !== start.y)) {
                end = s; snapIndicator = s;
            } else {
                snapIndicator = null;
                if (orthoOn && currentTool !== 'rect') end = applyOrtho(start, end);
            }
            previewEl = makeSegmentEl(start, end);
            redraw();
        }
    }

    function onPointerUp(e) {
        activePointers.delete(e.pointerId);
        if (pinchState) {
            if (activePointers.size < 2) pinchState = null;
            return;
        }
        if (!drawing) return;
        drawing = false;

        if (currentTool === 'pan') { panLast = null; return; }

        if (previewEl) {
            // segments trop courts = clic accidentel, on ignore
            const tooShort = previewEl.x1 !== undefined &&
                Math.hypot(previewEl.x2 - previewEl.x1, previewEl.y2 - previewEl.y1) < 4 / view.scale;
            if (!tooShort) elements.push(previewEl);
            previewEl = null;
        }
        start = null;
        snapIndicator = null;
        updateDims();
        redraw();
    }

    // --- API utilisée par le HTML ----------------------------------------------------
    function setTool(tool, btn) {
        currentTool = tool;
        document.querySelectorAll('.canvas-toolbar .tool-btn[data-role="tool"]').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    }

    function toggleOrtho(btn) {
        orthoOn = !orthoOn;
        btn.classList.toggle('active', orthoOn);
    }

    function toggleLabels(btn) {
        labelsOn = !labelsOn;
        btn.classList.toggle('active', labelsOn);
        redraw();
    }

    function undo() {
        elements.pop();
        previewEl = null;
        updateDims();
        redraw();
    }

    function clear() {
        if (elements.length && !confirm('Effacer tout le plan en cours ?')) return;
        elements = [];
        previewEl = null;
        updateDims();
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
        previewEl = null;
        view.scale = 1; view.x = 0; view.y = 0;
        updateZoomLabel();
        updateDims();
        redraw();
    }

    // --- Sauvegarde : recale le dessin et fixe l'emprise réelle -------------------------
    function translateEl(el, dx, dy) {
        const t = JSON.parse(JSON.stringify(el));
        if (t.points) t.points = t.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
        else if (t.type === 'cover_rect' || t.type === 'start_point') { t.x += dx; t.y += dy; }
        else { t.x1 += dx; t.y1 += dy; t.x2 += dx; t.y2 += dy; }
        return t;
    }

    function makeThumbnail(els, worldW, worldH) {
        const c = document.createElement('canvas');
        c.width = CANVAS_W; c.height = CANVAS_H;
        const cx = c.getContext('2d');
        cx.fillStyle = '#cfd8dc';
        cx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        const k = Math.min(CANVAS_W / worldW, CANVAS_H / worldH);
        cx.setTransform(k, 0, 0, k, (CANVAS_W - worldW * k) / 2, (CANVAS_H - worldH * k) / 2);
        drawElements(cx, els, { scale: k, labels: false });
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

        // Normalisation : le dessin est recalé près de l'origine avec une marge,
        // et l'emprise (width/height) devient la taille réelle du terrain —
        // c'est ce repère qui est partagé avec la carte résultat et l'IA.
        const b = contentBBox();
        const moved = elements.map(el => translateEl(el, SAVE_MARGIN - b.x, SAVE_MARGIN - b.y));
        terrain.width = Math.max(MIN_WORLD_W, Math.round(b.w + 2 * SAVE_MARGIN));
        terrain.height = Math.max(MIN_WORLD_H, Math.round(b.h + 2 * SAVE_MARGIN));
        terrain.elements = moved;
        terrain.thumbnail = makeThumbnail(moved, terrain.width, terrain.height);
        terrain.photo = newPhoto || editingPhoto || null;

        if (await Store.saveTerrain(terrain, `Terrain « ${name} » sauvegardé (${Math.round(terrain.width / PPM)} × ${Math.round(terrain.height / PPM)} m)`)) {
            resetForm();
            renderTerrains();
            if (typeof Drill !== 'undefined') Drill.populate();
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
        updateDims();
        zoomFit();
        document.getElementById('terrain').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function remove(id) {
        const t = Store.state.terrains.find(x => x.id === id);
        if (!t || !confirm(`Supprimer le terrain « ${t.name} » ?`)) return;
        if (await Store.deleteTerrain(id)) {
            if (editingId === id) resetForm();
            UI.toast('Terrain supprimé', 'info');
            renderTerrains();
            if (typeof Drill !== 'undefined') Drill.populate();
        }
    }

    // --- Bibliothèque ---------------------------------------------------------------------
    function renderTerrains() {
        const container = document.getElementById('terrain-list');
        container.innerHTML = '';
        if (!Store.state.terrains.length) {
            container.innerHTML = '<p class="empty">Aucun terrain enregistré. Dessinez votre premier plan ci-dessus.</p>';
            return;
        }
        Store.state.terrains.forEach(t => {
            const sizeM = t.width ? ` · ${Math.round(t.width / PPM)} × ${Math.round(t.height / PPM)} m` : '';
            const card = document.createElement('div');
            card.className = 'equipment-card terrain-card';
            card.innerHTML = `
                <div class="card-head">
                    <div>
                        <span class="category">${UI.esc(t.type)}${sizeM}</span>
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

    // --- Init --------------------------------------------------------------------------------
    function init() {
        canvas = document.getElementById('terrain-canvas');
        ctx = canvas.getContext('2d');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });

        // Liste des protections depuis le schéma central
        const kindSel = document.getElementById('cover-kind-select');
        Object.entries(Schema.COVER_KINDS).forEach(([id, k]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = `${k.emoji} ${k.label}`;
            kindSel.appendChild(opt);
        });
        kindSel.value = coverKind;
        kindSel.addEventListener('change', () => {
            coverKind = kindSel.value;
            setTool('cover', document.getElementById('cover-tool-btn'));
        });

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
        updateZoomLabel();
        updateDims();
        redraw();
        renderTerrains();
    }

    return {
        init, setTool, toggleOrtho, toggleLabels,
        zoomIn, zoomOut, zoomFit,
        undo, clear, save, renderTerrains, drawElements
    };
})();
