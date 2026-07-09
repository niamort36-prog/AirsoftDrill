/* =========================================================================
 * UI.JS — Utilitaires d'interface partagés
 * Échappement HTML (anti-XSS), toasts, navigation, mini-rendu markdown,
 * compression d'images, lecture de fichiers.
 * ========================================================================= */

const UI = (() => {
    'use strict';

    // --- Échappement HTML : à utiliser pour TOUTE donnée injectée en innerHTML.
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // --- Toasts (remplace les alert() bloquants) -------------------------
    function toastContainer() {
        let c = document.getElementById('toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toast-container';
            c.setAttribute('aria-live', 'polite');
            document.body.appendChild(c);
        }
        return c;
    }

    /** @param {'success'|'error'|'info'} type */
    function toast(message, type) {
        const el = document.createElement('div');
        el.className = 'toast toast-' + (type || 'info');
        el.textContent = message;
        toastContainer().appendChild(el);
        setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 400); }, 3500);
    }

    // --- Navigation entre sections ---------------------------------------
    const SECTIONS = ['squad', 'terrain', 'logistique', 'drill'];

    function showSection(sectionId) {
        if (!SECTIONS.includes(sectionId)) sectionId = 'squad';
        document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
        const target = document.getElementById(sectionId);
        if (target) target.classList.remove('hidden');

        document.querySelectorAll('.nav-btn').forEach(btn => {
            const active = btn.dataset.section === sectionId;
            btn.classList.toggle('active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });

        if (history.replaceState) history.replaceState(null, '', '#' + sectionId);
        // La page Drill dépend des données des 3 autres : on la repeuple à l'ouverture.
        if (sectionId === 'drill' && window.Drill) Drill.populate();
    }

    // --- Mini-rendu markdown SÉCURISÉ (échappe d'abord, transforme ensuite)
    function inlineMd(s) {
        return s
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
    }

    function mdToHtml(md) {
        const lines = String(md || '').split(/\r?\n/);
        const out = [];
        let list = null; // 'ul' | 'ol' | null

        function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }

        for (const raw of lines) {
            const line = esc(raw.trim());
            if (!line) { closeList(); continue; }
            let m;
            if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
                closeList();
                const lvl = m[1].length + 1; // # -> h2 (h1 réservé au titre de page)
                out.push(`<h${lvl}>${inlineMd(m[2])}</h${lvl}>`);
            } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
                if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
                out.push('<li>' + inlineMd(m[1]) + '</li>');
            } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
                if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
                out.push('<li>' + inlineMd(m[1]) + '</li>');
            } else {
                closeList();
                out.push('<p>' + inlineMd(line) + '</p>');
            }
        }
        closeList();
        return out.join('\n');
    }

    // --- Fichiers ---------------------------------------------------------
    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error('Lecture du fichier impossible'));
            r.readAsDataURL(file);
        });
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error('Lecture du fichier impossible'));
            r.readAsText(file);
        });
    }

    /**
     * Compresse une image (dataURL) : redimensionne à maxDim et encode en JPEG.
     * Indispensable pour ne pas saturer le stockage avec des photos de téléphone.
     */
    function compressImage(dataUrl, maxDim, quality) {
        maxDim = maxDim || 1200; quality = quality || 0.8;
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                let { width: w, height: h } = img;
                if (w > maxDim || h > maxDim) {
                    const k = maxDim / Math.max(w, h);
                    w = Math.round(w * k); h = Math.round(h * k);
                }
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                const cx = c.getContext('2d');
                cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); // fond pour PNG transparents
                cx.drawImage(img, 0, 0, w, h);
                resolve(c.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(dataUrl); // en cas d'échec on garde l'original
            img.src = dataUrl;
        });
    }

    return { esc, toast, showSection, mdToHtml, readFileAsDataURL, readFileAsText, compressImage };
})();
