/* =========================================================================
 * MAIN.JS — Point d'entrée : initialise le stockage puis chaque module,
 * câble la navigation (avec ancres #squad, #terrain, #logistique, #drill).
 * ========================================================================= */

document.addEventListener('DOMContentLoaded', async () => {
    'use strict';

    try {
        await Store.init();
    } catch (err) {
        console.error('Initialisation du stockage :', err);
        UI.toast('Stockage local indisponible (' + err.message + '). Les données ne seront pas sauvegardées.', 'error');
    }

    SquadModule.init();
    TerrainEditor.init();
    Logistics.init();
    Drill.init();

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => UI.showSection(btn.dataset.section));
    });

    // Ouvre la section indiquée dans l'URL (permet les liens directs / retour)
    UI.showSection((location.hash || '#squad').slice(1));
});
