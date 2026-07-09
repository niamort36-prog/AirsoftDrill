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
 *   Formes : { type:'wall'|'door_single'|'door_double'|'window'|'rect',
 *              x1,y1,x2,y2 }
 *   Pinceaux : { type:'brush_in'|'brush_out', points:[{x,y}] }
 *   Coordonnées TOUJOURS dans le repère fixe 900x500 px (voir constantes).
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
        PAX_ROLES, EQUIPMENT_CATEGORIES,
        uid, makeSquad, makePax, makeEquipment, makeTerrain, makeLogisticsItem, makeSupportDoc
    };
})();
