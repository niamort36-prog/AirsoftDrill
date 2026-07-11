/* =========================================================================
 * SCHEMA.JS — Schéma de données central AirsoftDrill (v2)
 * -------------------------------------------------------------------------
 * Toutes les pages (Squad, Terrain, Logistique, Drill) lisent et écrivent
 * les MÊMES structures, décrites ici. Toute évolution du modèle passe par
 * ce fichier (factories + constantes), jamais par des objets ad hoc.
 *
 * @typedef {Object} Equipment
 *   @property {string} id
 *   @property {string} category   Ex: "Réplique Principale"
 *   @property {string} name       Ex: "M4A1 Tokyo Marui"
 *   @property {string} details    Optiques, chargeurs, etc.
 *
 * @typedef {Object} Pax           Un participant de la squad
 *   @property {string} id
 *   @property {string} name       Pseudo / indicatif
 *   @property {string} role       Pointman, Rifleman, Support...
 *   @property {Equipment[]} equipment
 *
 * @typedef {Object} Squad
 *   @property {string} id
 *   @property {string} name
 *   @property {Pax[]} pax
 *   @property {string} createdAt  ISO
 *   @property {string} updatedAt  ISO
 *
 * @typedef {Object} TerrainElement
 *   Segments : { type:'wall'|'door_single'|'door_double'|'window'|'rect',
 *                x1,y1,x2,y2 }  (les portes sont posées SUR un mur)
 *   Pinceaux : { type:'brush_in'|'brush_out', points:[{x,y}] }
 *   Protections linéaires : { type:'cover_line', kind:'muret'|'palissade',
 *                x1,y1,x2,y2 }
 *   Protections posées : { type:'cover_rect', kind:'voiture'|..., x,y (centre),
 *                w,h (px), rot (radians) }
 *   Points de départ possibles : { type:'start_point', x, y, label:'D1'|'D2'|... }
 *                (l'IA choisit parmi eux pour placer le départ du drill)
 *   Coordonnées en pixels-monde (20 px = 1 m). L'emprise (width/height du
 *   terrain) est recalculée automatiquement à la sauvegarde.
 *
 * @typedef {Object} Terrain
 *   @property {string} id
 *   @property {string} name
 *   @property {string} type       'Intérieur' | 'Extérieur' | 'Mixte'
 *   @property {number} width      = TERRAIN_WIDTH (repère de dessin)
 *   @property {number} height     = TERRAIN_HEIGHT
 *   @property {number} pixelsPerMeter
 *   @property {TerrainElement[]} elements
 *   @property {string|null} photo      dataURL (compressée)
 *   @property {string|null} thumbnail  rendu du plan (dataURL jpeg)
 *
 * @typedef {Object} LogisticsItem  Matériel de terrain (cibles, cônes...)
 *   @property {string} id
 *   @property {string} name
 *   @property {number} qty
 *   @property {string|null} photo  dataURL (compressée)
 *
 * @typedef {Object} SupportDoc    Support pédagogique (PDF / image / texte)
 *   @property {string} id
 *   @property {string} title
 *   @property {string} type       'Modèle de Drill' | 'Cible Particulière' | ...
 *   @property {'pdf'|'image'|'text'} kind
 *   @property {string|null} dataUrl  pour pdf/image
 *   @property {string|null} text     pour kind === 'text'
 *   @property {string} fileName
 * ========================================================================= */

const Schema = (() => {
    'use strict';

    const SCHEMA_VERSION = 2;

    // Repère de dessin FIXE : tous les terrains sont dessinés et rejoués
    // dans ce repère, quel que soit l'écran (le canvas est mis à l'échelle
    // en CSS). C'est aussi le repère communiqué à l'IA pour les overlays.
    const TERRAIN_WIDTH = 900;
    const TERRAIN_HEIGHT = 500;
    const PIXELS_PER_METER = 20;

    // Largeur des portes intégrées aux murs (en mètres)
    const DOOR_WIDTH_M = { door_single: 0.9, door_double: 1.8 };

    // Protections posables sur le terrain. Dimensions en MÈTRES (converties
    // en px-monde à la pose). `desc` est la description tactique envoyée à
    // l'IA pour qu'elle exploite chaque protection correctement.
    const COVER_KINDS = {
        voiture: { label: 'Voiture', emoji: '🚗', shape: 'rect', w: 4.2, h: 1.8, fill: 'rgba(84,110,122,0.85)', stroke: '#37474f', desc: 'couverture dure (~1,4 m de haut) : arrête les billes, tir possible par-dessus le capot' },
        buisson: { label: 'Buisson', emoji: '🌳', shape: 'rect', w: 1.6, h: 1.6, fill: 'rgba(46,125,50,0.55)', stroke: '#1b5e20', desc: 'concealment : cache la vue mais n\'arrête PAS les billes' },
        muret: { label: 'Muret (~1 m)', emoji: '🧱', shape: 'line', fill: null, stroke: '#78909c', desc: 'couverture dure basse (~1 m) : tir possible par-dessus, protège accroupi' },
        palissade: { label: 'Palissade (haute)', emoji: '🪵', shape: 'line', fill: null, stroke: '#6d4c41', desc: 'palissade haute (~2 m) : bloque la vue, le tir et le passage' },
        canape: { label: 'Canapé', emoji: '🛋️', shape: 'rect', w: 2.0, h: 0.9, fill: 'rgba(141,110,99,0.85)', stroke: '#5d4037', desc: 'couverture basse d\'intérieur (~0,8 m), arrête les billes' },
        bureau: { label: 'Bureau', emoji: '🗄️', shape: 'rect', w: 1.4, h: 0.7, fill: 'rgba(121,85,72,0.85)', stroke: '#4e342e', desc: 'couverture basse d\'intérieur (~0,75 m)' },
        lit: { label: 'Lit', emoji: '🛏️', shape: 'rect', w: 2.0, h: 1.5, fill: 'rgba(90,109,137,0.85)', stroke: '#33415c', desc: 'couverture basse d\'intérieur (~0,6 m)' }
    };

    const PAX_ROLES = ['Team Leader', 'Pointman', 'Rifleman', 'Support', 'Marksman', 'Breacher', 'Medic', 'Autre'];

    const EQUIPMENT_CATEGORIES = ['Réplique Principale', 'Réplique Secondaire', 'Gilet / Ceinture', 'Tenue / Camo', 'Accessoire'];

    function uid(prefix) {
        return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function now() { return new Date().toISOString(); }

    function makeSquad(name) {
        return { id: uid('sq'), name: name, pax: [], createdAt: now(), updatedAt: now() };
    }

    function makePax(name, role) {
        return { id: uid('px'), name: name, role: role || 'Rifleman', equipment: [] };
    }

    function makeEquipment(category, name, details) {
        return { id: uid('eq'), category: category || 'Accessoire', name: name || '', details: details || '' };
    }

    function makeTerrain(name, type) {
        return {
            id: uid('tr'), name: name, type: type || 'Intérieur',
            width: TERRAIN_WIDTH, height: TERRAIN_HEIGHT, pixelsPerMeter: PIXELS_PER_METER,
            elements: [], photo: null, thumbnail: null,
            createdAt: now(), updatedAt: now()
        };
    }

    function makeLogisticsItem(name, qty, photo) {
        return { id: uid('li'), name: name, qty: Math.max(1, parseInt(qty, 10) || 1), photo: photo || null };
    }

    function makeSupportDoc(title, type, kind, payload, fileName) {
        return {
            id: uid('doc'), title: title, type: type, kind: kind,
            dataUrl: kind === 'text' ? null : payload,
            text: kind === 'text' ? payload : null,
            fileName: fileName || ''
        };
    }

    return {
        SCHEMA_VERSION, TERRAIN_WIDTH, TERRAIN_HEIGHT, PIXELS_PER_METER,
        DOOR_WIDTH_M, COVER_KINDS,
        PAX_ROLES, EQUIPMENT_CATEGORIES,
        uid, makeSquad, makePax, makeEquipment, makeTerrain, makeLogisticsItem, makeSupportDoc
    };
})();
