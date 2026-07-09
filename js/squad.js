/* =========================================================================
 * SQUAD.JS — Page « Squad & Matériel »
 * Création de squads, ajout de pax (participants) et de leur matériel
 * individuel. Ces données sont réutilisées telles quelles par la page
 * « Création de Drill » (sélection des pax envoyés à l'IA).
 * ========================================================================= */

const SquadModule = (() => {
    'use strict';

    let activeSquadId = null;

    function activeSquad() {
        return Store.state.squads.find(s => s.id === activeSquadId) || null;
    }

    // --- Rendu -------------------------------------------------------------
    function renderSquadSelect() {
        const sel = document.getElementById('squad-select');
        sel.innerHTML = '';
        if (!Store.state.squads.length) {
            sel.innerHTML = '<option value="">— Créez d\'abord une squad —</option>';
            sel.disabled = true;
        } else {
            sel.disabled = false;
            Store.state.squads.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = `${s.name} (${s.pax.length} pax)`;
                sel.appendChild(opt);
            });
            if (!activeSquad()) activeSquadId = Store.state.squads[0].id;
            sel.value = activeSquadId;
        }
        document.getElementById('squad-delete-btn').disabled = !Store.state.squads.length;
    }

    function renderPaxSelect() {
        const sel = document.getElementById('eq-pax-select');
        const squad = activeSquad();
        sel.innerHTML = '';
        if (!squad || !squad.pax.length) {
            sel.innerHTML = '<option value="">— Ajoutez d\'abord un pax —</option>';
            sel.disabled = true;
        } else {
            sel.disabled = false;
            squad.pax.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.name} (${p.role})`;
                sel.appendChild(opt);
            });
        }
    }

    function renderPaxList() {
        const container = document.getElementById('pax-list');
        const squad = activeSquad();
        container.innerHTML = '';

        if (!squad) {
            container.innerHTML = '<p class="empty">Créez une squad pour commencer.</p>';
            return;
        }
        if (!squad.pax.length) {
            container.innerHTML = '<p class="empty">Aucun pax dans cette squad. Ajoutez le premier !</p>';
            return;
        }

        squad.pax.forEach(pax => {
            const card = document.createElement('div');
            card.className = 'equipment-card pax-card';
            const eqHtml = (pax.equipment || []).map(eq => `
                <li>
                    <div>
                        <span class="eq-cat">${UI.esc(eq.category)}</span>
                        <strong>${UI.esc(eq.name)}</strong>
                        ${eq.details ? `<span class="eq-details">${UI.esc(eq.details)}</span>` : ''}
                    </div>
                    <button type="button" class="icon-btn" data-action="del-eq" data-pax="${pax.id}" data-eq="${eq.id}" aria-label="Supprimer ${UI.esc(eq.name)}">✕</button>
                </li>`).join('');

            card.innerHTML = `
                <div class="card-head">
                    <div>
                        <span class="category">${UI.esc(pax.role)}</span>
                        <h4>${UI.esc(pax.name)}</h4>
                    </div>
                    <button type="button" class="delete-btn" data-action="del-pax" data-pax="${pax.id}" aria-label="Supprimer le pax ${UI.esc(pax.name)}">✕</button>
                </div>
                ${eqHtml ? `<ul class="eq-list">${eqHtml}</ul>` : '<p class="empty">Aucun équipement.</p>'}`;
            container.appendChild(card);
        });
    }

    function renderAll() {
        renderSquadSelect();
        renderPaxSelect();
        renderPaxList();
    }

    // --- Actions -------------------------------------------------------------
    async function onCreateSquad(e) {
        e.preventDefault();
        const input = document.getElementById('squad-name');
        const name = input.value.trim();
        if (!name) return;
        const squad = Schema.makeSquad(name);
        if (await Store.saveSquad(squad, `Squad « ${name} » créée`)) {
            activeSquadId = squad.id;
            input.value = '';
            renderAll();
        }
    }

    async function onDeleteSquad() {
        const squad = activeSquad();
        if (!squad) return;
        if (!confirm(`Supprimer la squad « ${squad.name} » et ses ${squad.pax.length} pax ?`)) return;
        if (await Store.deleteSquad(squad.id)) {
            activeSquadId = Store.state.squads.length ? Store.state.squads[0].id : null;
            UI.toast('Squad supprimée', 'info');
            renderAll();
        }
    }

    async function onAddPax(e) {
        e.preventDefault();
        const squad = activeSquad();
        if (!squad) { UI.toast('Créez d\'abord une squad.', 'error'); return; }
        const name = document.getElementById('pax-name').value.trim();
        const role = document.getElementById('pax-role').value;
        if (!name) return;
        squad.pax.push(Schema.makePax(name, role));
        if (await Store.saveSquad(squad, `Pax « ${name} » ajouté`)) {
            e.target.reset();
            renderAll();
        }
    }

    async function onAddEquipment(e) {
        e.preventDefault();
        const squad = activeSquad();
        const paxId = document.getElementById('eq-pax-select').value;
        const pax = squad && squad.pax.find(p => p.id === paxId);
        if (!pax) { UI.toast('Sélectionnez un pax.', 'error'); return; }
        const eq = Schema.makeEquipment(
            document.getElementById('eq-category').value,
            document.getElementById('eq-name').value.trim(),
            document.getElementById('eq-details').value.trim()
        );
        if (!eq.name) return;
        pax.equipment.push(eq);
        if (await Store.saveSquad(squad, `Équipement ajouté à ${pax.name}`)) {
            document.getElementById('eq-name').value = '';
            document.getElementById('eq-details').value = '';
            renderPaxList();
        }
    }

    async function onPaxListClick(e) {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const squad = activeSquad();
        if (!squad) return;

        if (btn.dataset.action === 'del-pax') {
            const pax = squad.pax.find(p => p.id === btn.dataset.pax);
            if (!pax || !confirm(`Supprimer le pax « ${pax.name} » ?`)) return;
            squad.pax = squad.pax.filter(p => p.id !== pax.id);
            if (await Store.saveSquad(squad)) { UI.toast('Pax supprimé', 'info'); renderAll(); }
        } else if (btn.dataset.action === 'del-eq') {
            const pax = squad.pax.find(p => p.id === btn.dataset.pax);
            if (!pax) return;
            pax.equipment = pax.equipment.filter(eq => eq.id !== btn.dataset.eq);
            if (await Store.saveSquad(squad)) renderPaxList();
        }
    }

    // --- Init ------------------------------------------------------------------
    function init() {
        // Remplit les listes déroulantes statiques depuis le schéma central.
        const roleSel = document.getElementById('pax-role');
        Schema.PAX_ROLES.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r; opt.textContent = r;
            roleSel.appendChild(opt);
        });
        const catSel = document.getElementById('eq-category');
        Schema.EQUIPMENT_CATEGORIES.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            catSel.appendChild(opt);
        });

        document.getElementById('squad-form').addEventListener('submit', onCreateSquad);
        document.getElementById('squad-delete-btn').addEventListener('click', onDeleteSquad);
        document.getElementById('squad-select').addEventListener('change', (e) => {
            activeSquadId = e.target.value;
            renderPaxSelect();
            renderPaxList();
        });
        document.getElementById('pax-form').addEventListener('submit', onAddPax);
        document.getElementById('equipment-form').addEventListener('submit', onAddEquipment);
        document.getElementById('pax-list').addEventListener('click', onPaxListClick);

        if (Store.state.squads.length) activeSquadId = Store.state.squads[0].id;
        renderAll();
    }

    return { init, renderAll };
})();
