/* =========================================================================
 * STORE.JS — Persistance locale (IndexedDB) + état applicatif partagé
 * -------------------------------------------------------------------------
 * POURQUOI IndexedDB (et plus localStorage) :
 *   - localStorage est limité à ~5 Mo : une seule photo de téléphone en
 *     base64 suffisait à faire planter la sauvegarde (QuotaExceededError).
 *   - IndexedDB offre des centaines de Mo, parfait pour photos, PDF et
 *     plans de terrain — et fonctionne à 100 % en statique (GitHub Pages).
 *
 * L'état en mémoire (Store.state) est la source de vérité pour l'UI ;
 * chaque écriture passe par IndexedDB PUIS met à jour le cache.
 * Migration automatique depuis l'ancien format localStorage (v1).
 * ========================================================================= */

const Store = (() => {
    'use strict';

    const DB_NAME = 'airsoftdrill';
    const DB_VERSION = 1;
    const OBJECT_STORES = ['squads', 'terrains', 'logistics', 'docs', 'settings'];

    let _db = null;

    /** Cache mémoire partagé par tous les modules (lecture directe autorisée). */
    const state = {
        squads: [],
        terrains: [],
        logisticsItems: [],
        supportDocs: []
    };

    // --- Bas niveau IndexedDB (promisifié) --------------------------------
    function open() {
        return new Promise((resolve, reject) => {
            const rq = indexedDB.open(DB_NAME, DB_VERSION);
            rq.onupgradeneeded = (e) => {
                const db = e.target.result;
                OBJECT_STORES.forEach(name => {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
                    }
                });
            };
            rq.onsuccess = () => resolve(rq.result);
            rq.onerror = () => reject(rq.error || new Error('IndexedDB indisponible'));
        });
    }

    function tx(storeName, mode, fn) {
        return new Promise((resolve, reject) => {
            const t = _db.transaction(storeName, mode);
            const store = t.objectStore(storeName);
            const result = fn(store);
            t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : undefined);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('Transaction annulée'));
        });
    }

    function idbGetAll(storeName) {
        return new Promise((resolve, reject) => {
            const t = _db.transaction(storeName, 'readonly');
            const rq = t.objectStore(storeName).getAll();
            rq.onsuccess = () => resolve(rq.result || []);
            rq.onerror = () => reject(rq.error);
        });
    }

    function idbPut(storeName, value) { return tx(storeName, 'readwrite', s => s.put(value)); }
    function idbDelete(storeName, key) { return tx(storeName, 'readwrite', s => s.delete(key)); }

    async function getSetting(key) {
        return new Promise((resolve) => {
            const rq = _db.transaction('settings', 'readonly').objectStore('settings').get(key);
            rq.onsuccess = () => resolve(rq.result ? rq.result.value : undefined);
            rq.onerror = () => resolve(undefined);
        });
    }
    function setSetting(key, value) { return idbPut('settings', { key, value }); }

    // --- Migration depuis l'ancien format (localStorage v1) ---------------
    function safeParse(json) { try { return JSON.parse(json); } catch (e) { return null; } }

    async function migrateFromV1() {
        if (await getSetting('migratedV1')) return;

        const inv = safeParse(localStorage.getItem('airsoftInventory')) || [];
        const ter = safeParse(localStorage.getItem('airsoftTerrains')) || [];
        const items = safeParse(localStorage.getItem('airsoftLogisticsItems')) || [];
        const docs = safeParse(localStorage.getItem('airsoftLogisticsDocs')) || [];

        // L'ancien inventaire "à plat" devient une squad avec un pax unique.
        if (inv.length) {
            const squad = Schema.makeSquad('Ma Squad');
            const pax = Schema.makePax('Opérateur 1', 'Rifleman');
            pax.equipment = inv.map(it => Schema.makeEquipment(it.category, it.name, it.details));
            squad.pax.push(pax);
            await idbPut('squads', squad);
        }
        for (const t of ter) {
            const nt = Schema.makeTerrain(t.name || 'Terrain importé', t.type);
            nt.elements = Array.isArray(t.data) ? t.data : [];
            nt.photo = t.photo || null;
            nt.thumbnail = t.image || null;
            await idbPut('terrains', nt);
        }
        for (const it of items) {
            await idbPut('logistics', Schema.makeLogisticsItem(it.name, it.qty, it.photo));
        }
        for (const d of docs) {
            const isPdf = d.file && String(d.file).startsWith('data:application/pdf');
            await idbPut('docs', Schema.makeSupportDoc(d.title || 'Sans titre', d.type || 'Manuel / Autre', isPdf ? 'pdf' : 'image', d.file || null, ''));
        }
        await setSetting('migratedV1', true);
        // Les anciennes clés localStorage sont conservées comme sauvegarde de secours.
    }

    // --- Initialisation ----------------------------------------------------
    async function init() {
        _db = await open();
        await migrateFromV1();
        const [squads, terrains, logistics, docs] = await Promise.all([
            idbGetAll('squads'), idbGetAll('terrains'), idbGetAll('logistics'), idbGetAll('docs')
        ]);
        state.squads = squads;
        state.terrains = terrains;
        state.logisticsItems = logistics;
        state.supportDocs = docs;
    }

    // --- CRUD typé (écrit en base PUIS met à jour le cache) ----------------
    function upsertInCache(list, obj) {
        const i = list.findIndex(x => x.id === obj.id);
        if (i > -1) list[i] = obj; else list.push(obj);
    }
    function removeFromCache(list, id) {
        const i = list.findIndex(x => x.id === id);
        if (i > -1) list.splice(i, 1);
    }

    async function guarded(promise, okMsg) {
        try {
            await promise;
            if (okMsg) UI.toast(okMsg, 'success');
            return true;
        } catch (e) {
            console.error('Erreur de stockage :', e);
            UI.toast('Échec de la sauvegarde : ' + (e && e.message ? e.message : 'stockage indisponible'), 'error');
            return false;
        }
    }

    async function saveSquad(squad, msg) {
        squad.updatedAt = new Date().toISOString();
        const ok = await guarded(idbPut('squads', squad), msg);
        if (ok) upsertInCache(state.squads, squad);
        return ok;
    }
    async function deleteSquad(id) {
        const ok = await guarded(idbDelete('squads', id));
        if (ok) removeFromCache(state.squads, id);
        return ok;
    }

    async function saveTerrain(terrain, msg) {
        terrain.updatedAt = new Date().toISOString();
        const ok = await guarded(idbPut('terrains', terrain), msg);
        if (ok) upsertInCache(state.terrains, terrain);
        return ok;
    }
    async function deleteTerrain(id) {
        const ok = await guarded(idbDelete('terrains', id));
        if (ok) removeFromCache(state.terrains, id);
        return ok;
    }

    async function saveLogisticsItem(item, msg) {
        const ok = await guarded(idbPut('logistics', item), msg);
        if (ok) upsertInCache(state.logisticsItems, item);
        return ok;
    }
    async function deleteLogisticsItem(id) {
        const ok = await guarded(idbDelete('logistics', id));
        if (ok) removeFromCache(state.logisticsItems, id);
        return ok;
    }

    async function saveSupportDoc(doc, msg) {
        const ok = await guarded(idbPut('docs', doc), msg);
        if (ok) upsertInCache(state.supportDocs, doc);
        return ok;
    }
    async function deleteSupportDoc(id) {
        const ok = await guarded(idbDelete('docs', id));
        if (ok) removeFromCache(state.supportDocs, id);
        return ok;
    }

    return {
        state, init, getSetting, setSetting,
        saveSquad, deleteSquad,
        saveTerrain, deleteTerrain,
        saveLogisticsItem, deleteLogisticsItem,
        saveSupportDoc, deleteSupportDoc
    };
})();
