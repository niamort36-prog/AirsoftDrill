/* =========================================================================
 * AI.JS — Module d'intégration IA (isolé du reste de l'application)
 * -------------------------------------------------------------------------
 * Une seule fonction publique :
 *   AI.generateDrill({ apiKey, model, terrain, pax, materials, docs, userPrompt })
 *     -> Promise<{ markdown: string, overlays: Overlay[] }>
 *
 * Overlay = { type:'target'|'start_point'|'path'|'zone', x?, y?, label?, points? }
 * Les coordonnées sont dans le repère du terrain (900x500, 20 px = 1 m),
 * validées et bornées avant d'être rendues.
 *
 * SÉCURITÉ DE LA CLÉ API (site 100 % statique) :
 *   La clé Gemini est fournie par l'utilisateur ("Bring Your Own Key") et
 *   stockée UNIQUEMENT dans le localStorage de son navigateur. Elle n'est
 *   jamais écrite en dur dans le code ni envoyée ailleurs qu'à l'API Google.
 *   Pour une clé mutualisée, il faudrait un proxy serverless (voir README).
 *
 * Pour changer de fournisseur d'IA, seul ce fichier est à adapter.
 * ========================================================================= */

const AI = (() => {
    'use strict';

    // Ordre = ordre de repli. Les quotas GRATUITS diffèrent énormément :
    // Flash et Flash-Lite ont un quota journalier confortable, Pro est
    // quasi inutilisable sans facturation (épuisé en 1-2 requêtes).
    // Pro reste donc en DERNIER recours pour ne pas brûler le crédit.
    const MODELS = [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (recommandé — bon quota gratuit)' },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (le plus gros quota gratuit)' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (précis — quota gratuit très limité)' }
    ];
    const DEFAULT_MODEL = MODELS[0].id;

    const ENDPOINT = (model, key) =>
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    // Budget de pièces jointes envoyées à l'IA (base64) pour rester sous les
    // limites de l'API (~20 Mo par requête). Au-delà, seuls les titres partent.
    const INLINE_BUDGET_BYTES = 6 * 1024 * 1024;
    const TEXT_DOC_MAX_CHARS = 4000;

    // Résilience : les modèles Gemini gratuits sont régulièrement saturés
    // ("high demand"). On retente avec délai, puis on bascule de modèle.
    // Un 429 "quota épuisé" ne se retente PAS (le quota est journalier) :
    // on bascule immédiatement pour ne pas gaspiller d'appels.
    const FETCH_TIMEOUT_MS = 60000;
    const ATTEMPTS_PER_MODEL = 2;
    const BACKOFF_BASE_MS = 2500;

    const OVERLAY_TYPES = ['target', 'start_point', 'path', 'zone'];

    // --- Construction du prompt -------------------------------------------
    // Compacte le plan avant envoi : coordonnées arrondies et traits de
    // pinceau allégés. Un coup de pinceau peut contenir des centaines de
    // points -> énorme gâchis de tokens (et donc de quota gratuit).
    function compactElements(elements) {
        const MIN_POINT_SPACING = 8;
        const MAX_POINTS_PER_STROKE = 120;
        return (elements || []).map(el => {
            if (el.points) {
                let pts = [];
                let last = null;
                for (const p of el.points) {
                    const q = { x: Math.round(p.x), y: Math.round(p.y) };
                    if (!last || Math.hypot(q.x - last.x, q.y - last.y) >= MIN_POINT_SPACING) {
                        pts.push(q);
                        last = q;
                    }
                }
                if (pts.length > MAX_POINTS_PER_STROKE) {
                    const step = Math.ceil(pts.length / MAX_POINTS_PER_STROKE);
                    pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
                }
                if (!pts.length) pts = [{ x: Math.round(el.points[0].x), y: Math.round(el.points[0].y) }];
                return { type: el.type, points: pts };
            }
            return {
                type: el.type,
                x1: Math.round(el.x1), y1: Math.round(el.y1),
                x2: Math.round(el.x2), y2: Math.round(el.y2)
            };
        });
    }

    function describeElements(terrain) {
        // Légende explicite : l'IA doit comprendre la topographie pour placer
        // cibles et trajets de façon cohérente (pas dans un mur).
        return [
            'Légende des éléments ("type") :',
            '- wall : mur infranchissable (segment x1,y1 -> x2,y2)',
            '- door_single / door_double : porte franchissable (segment)',
            '- window : fenêtre (ligne de vue / tir possible, pas de passage)',
            '- rect : zone rectangulaire (x1,y1 = coin, x2,y2 = coin opposé)',
            '- brush_in : zone intérieure peinte (liste de points)',
            '- brush_out : zone extérieure/végétation peinte (liste de points)',
            '',
            'Éléments du terrain (JSON) :',
            JSON.stringify(compactElements(terrain.elements))
        ].join('\n');
    }

    function describePax(pax) {
        if (!pax || !pax.length) return 'Aucun pax sélectionné (drill générique).';
        return pax.map(p => {
            const eq = (p.equipment || []).map(e => `${e.name}${e.details ? ' (' + e.details + ')' : ''}`).join(', ') || 'équipement non renseigné';
            return `- ${p.name} [${p.role}] : ${eq}`;
        }).join('\n');
    }

    function buildPrompt({ terrain, pax, materials, docs, userPrompt }) {
        const W = terrain.width || Schema.TERRAIN_WIDTH;
        const H = terrain.height || Schema.TERRAIN_HEIGHT;
        const PPM = terrain.pixelsPerMeter || Schema.PIXELS_PER_METER;

        return `Tu es un instructeur expert en entraînement tactique airsoft (CQB et milieu ouvert).
Conçois un exercice (drill) réaliste, progressif et sécurisé à partir du contexte ci-dessous.

## REPÈRE CARTOGRAPHIQUE (IMPORTANT)
- Plan 2D vu de dessus, origine (0,0) en HAUT À GAUCHE.
- Dimensions du plan : ${W} x ${H} pixels. Échelle : ${PPM} px = 1 mètre (terrain d'environ ${(W / PPM).toFixed(0)} m x ${(H / PPM).toFixed(0)} m).
- Toutes les coordonnées que tu produis doivent être dans ce repère (0 <= x <= ${W}, 0 <= y <= ${H}).
- Ne place JAMAIS une cible ou un point de départ sur un mur (type "wall").

## TERRAIN : ${terrain.name} (${terrain.type})
${describeElements(terrain)}

## PAX PARTICIPANTS (${pax.length})
${describePax(pax)}

## MATÉRIEL LOGISTIQUE DISPONIBLE
${materials.length ? materials.map(m => `- ${m.name} (quantité max : ${m.qty})`).join('\n') : 'Aucun matériel spécifique.'}
Ne demande jamais plus de matériel que les quantités indiquées.

## SUPPORTS PÉDAGOGIQUES FOURNIS
${docs.length ? docs.map(d => `- ${d.title} (${d.type})`).join('\n') : 'Aucun.'}
${docs.length ? 'Certains supports sont joints à ce message : inspire-t\'en si pertinent.' : ''}

## DEMANDE DU JOUEUR
"${userPrompt || 'Propose un drill adapté au terrain, aux pax et au matériel.'}"

## FORMAT DE SORTIE (JSON STRICT, aucun texte autour)
{
  "markdown_text": "Le drill complet en markdown : objectif, mise en place (avec quantités de matériel), déroulé étape par étape, critères de réussite, variantes, consignes de sécurité.",
  "map_overlays": [
    { "type": "start_point", "x": 50, "y": 50, "label": "Départ" },
    { "type": "target", "x": 300, "y": 200, "label": "C1" },
    { "type": "path", "points": [ {"x": 50, "y": 50}, {"x": 150, "y": 120} ] },
    { "type": "zone", "x": 400, "y": 300, "label": "Zone de couverture" }
  ]
}
Numérote les cibles (C1, C2...) et fais correspondre ces numéros dans le texte.
Si un sens de passage n'a pas de sens pour ce drill, n'ajoute simplement pas d'overlay "path".`;
    }

    // --- Pièces jointes (supports PDF / images / texte) --------------------
    function buildDocParts(docs) {
        const parts = [];
        let budget = INLINE_BUDGET_BYTES;
        for (const d of docs) {
            if (d.kind === 'text' && d.text) {
                parts.push({ text: `--- SUPPORT « ${d.title} » ---\n${d.text.slice(0, TEXT_DOC_MAX_CHARS)}` });
            } else if (d.dataUrl) {
                const comma = d.dataUrl.indexOf(',');
                if (comma === -1) continue;
                const meta = d.dataUrl.slice(5, d.dataUrl.indexOf(';')); // ex: application/pdf
                const b64 = d.dataUrl.slice(comma + 1);
                if (b64.length > budget) continue; // trop gros : le titre seul a été mentionné dans le prompt
                budget -= b64.length;
                parts.push({ inlineData: { mimeType: meta, data: b64 } });
            }
        }
        return parts;
    }

    // --- Validation de la réponse ------------------------------------------
    function clamp(v, max) { return Math.min(Math.max(Number(v) || 0, 0), max); }

    function sanitizeOverlays(raw, terrain) {
        const W = terrain.width || Schema.TERRAIN_WIDTH;
        const H = terrain.height || Schema.TERRAIN_HEIGHT;
        if (!Array.isArray(raw)) return [];
        return raw
            .filter(o => o && OVERLAY_TYPES.includes(o.type))
            .slice(0, 100)
            .map(o => {
                const clean = { type: o.type, label: typeof o.label === 'string' ? o.label.slice(0, 40) : '' };
                if (o.type === 'path') {
                    clean.points = (Array.isArray(o.points) ? o.points : [])
                        .slice(0, 200)
                        .map(p => ({ x: clamp(p.x, W), y: clamp(p.y, H) }));
                } else {
                    clean.x = clamp(o.x, W);
                    clean.y = clamp(o.y, H);
                }
                return clean;
            })
            .filter(o => o.type !== 'path' || (o.points && o.points.length > 1));
    }

    function extractJson(text) {
        // L'API est configurée pour renvoyer du JSON, mais on reste défensif :
        // retrait d'éventuelles clôtures ``` et extraction du premier objet.
        let t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
        try { return JSON.parse(t); } catch (e) { /* tentative suivante */ }
        const start = t.indexOf('{'); const end = t.lastIndexOf('}');
        if (start > -1 && end > start) return JSON.parse(t.slice(start, end + 1));
        throw new Error('La réponse de l\'IA n\'est pas un JSON exploitable.');
    }

    // --- Appel bas niveau : une requête vers UN modèle ------------------------
    // Les erreurs portent des drapeaux pour la stratégie de reprise :
    //   err.retryable    -> surcharge/réseau : retenter (backoff) puis changer de modèle
    //   err.tryNextModel -> ce modèle est inutilisable (404) : passer au suivant
    function isOverloaded(status, message) {
        return status === 503 ||
            /high demand|overloaded|temporarily|try again later/i.test(message || '');
    }

    function isQuotaExhausted(status, message) {
        return status === 429 || /quota|resource has been exhausted|rate limit/i.test(message || '');
    }

    async function callModel(model, apiKey, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(ENDPOINT(model, apiKey), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
        } catch (e) {
            const err = new Error(e.name === 'AbortError'
                ? 'Délai dépassé (60 s).'
                : 'Impossible de joindre l\'API Gemini (connexion ?).');
            err.retryable = true;
            throw err;
        } finally {
            clearTimeout(timer);
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) {
            const msg = (data.error && data.error.message) || ('HTTP ' + response.status);
            const err = new Error(msg);
            err.status = response.status;
            err.quotaExhausted = isQuotaExhausted(response.status, msg);
            err.retryable = isOverloaded(response.status, msg);
            err.tryNextModel = response.status === 404 || err.quotaExhausted;
            throw err;
        }

        if (data.promptFeedback && data.promptFeedback.blockReason) {
            throw new Error('Requête bloquée par les filtres de sécurité Gemini (' + data.promptFeedback.blockReason + ').');
        }
        const candidate = data.candidates && data.candidates[0];
        if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts.length) {
            const reason = candidate && candidate.finishReason ? ' (' + candidate.finishReason + ')' : '';
            const err = new Error('Réponse vide de l\'IA' + reason + '.');
            err.retryable = true; // souvent transitoire : on retente
            throw err;
        }
        return candidate.content.parts.map(p => p.text || '').join('');
    }

    function friendlyError(err, model) {
        const msg = err.message || 'erreur inconnue';
        if (err.status === 400 && /API key/i.test(msg)) return new Error('Clé API invalide. Vérifiez-la sur aistudio.google.com.');
        if (err.status === 404) return new Error(`Modèle « ${model} » introuvable pour votre clé. Essayez un autre modèle.`);
        return new Error('Erreur API : ' + msg);
    }

    // --- Appel principal : retries + bascule automatique de modèle -------------
    // onStatus(message) est appelé à chaque étape pour informer l'utilisateur.
    async function generateDrill({ apiKey, model, terrain, pax, materials, docs, userPrompt, onStatus }) {
        if (!apiKey) throw new Error('Aucune clé API enregistrée.');
        if (!terrain) throw new Error('Aucun terrain sélectionné.');
        docs = docs || [];

        const status = (msg) => { if (onStatus) { try { onStatus(msg); } catch (e) { /* UI seulement */ } } };
        const label = (id) => { const m = MODELS.find(x => x.id === id); return m ? m.label.split(' (')[0] : id; };

        // Chaîne d'essai : le modèle choisi d'abord, puis les autres en repli.
        const chain = [model || DEFAULT_MODEL]
            .concat(MODELS.map(m => m.id).filter(id => id !== (model || DEFAULT_MODEL)));

        const basePrompt = buildPrompt({ terrain, pax, materials, docs, userPrompt });
        const generationConfig = {
            temperature: 0.7,
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'OBJECT',
                properties: {
                    markdown_text: { type: 'STRING' },
                    map_overlays: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                type: { type: 'STRING', enum: OVERLAY_TYPES },
                                x: { type: 'NUMBER' },
                                y: { type: 'NUMBER' },
                                label: { type: 'STRING' },
                                points: {
                                    type: 'ARRAY',
                                    items: {
                                        type: 'OBJECT',
                                        properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } },
                                        required: ['x', 'y']
                                    }
                                }
                            },
                            required: ['type']
                        }
                    }
                },
                required: ['markdown_text', 'map_overlays']
            }
        };

        let includeDocs = docs.length > 0;
        let sawQuotaError = false;

        for (let ci = 0; ci < chain.length; ci++) {
            const m = chain[ci];
            for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
                const parts = [{ text: basePrompt }].concat(includeDocs ? buildDocParts(docs) : []);
                const body = { contents: [{ role: 'user', parts }], generationConfig };
                try {
                    const text = await callModel(m, apiKey, body);
                    let json;
                    try { json = extractJson(text); }
                    catch (pe) { pe.retryable = true; throw pe; } // JSON invalide : transitoire, on retente
                    return {
                        markdown: String(json.markdown_text || ''),
                        overlays: sanitizeOverlays(json.map_overlays, terrain),
                        modelUsed: m,
                        fellBack: ci > 0,
                        docsDropped: docs.length > 0 && !includeDocs
                    };
                } catch (err) {
                    if (err.tryNextModel) {
                        // Quota journalier épuisé ou modèle retiré (404) :
                        // inutile de retenter le même modèle, on bascule.
                        if (err.quotaExhausted) {
                            sawQuotaError = true;
                            status(`${label(m)} : quota gratuit épuisé — bascule sur un autre modèle…`);
                        }
                        break;
                    }
                    if (!err.retryable) throw friendlyError(err, m);
                    // Surcharge, réseau, ou JSON invalide : on allège la
                    // requête (sans pièces jointes) et on retente après un délai.
                    includeDocs = false;
                    if (attempt < ATTEMPTS_PER_MODEL) {
                        const wait = BACKOFF_BASE_MS * attempt;
                        status(`${label(m)} est saturé — nouvel essai dans ${Math.round(wait / 1000)} s…`);
                        await new Promise(r => setTimeout(r, wait));
                    }
                }
            }
            if (ci < chain.length - 1) {
                status(`${label(m)} indisponible — bascule sur ${label(chain[ci + 1])}…`);
            }
        }

        throw new Error(sawQuotaError
            ? 'Quota gratuit épuisé sur les modèles disponibles. Le quota se réinitialise chaque jour '
              + '(vers 9h heure de Paris). Astuces : utilisez Flash ou Flash Lite plutôt que Pro, décochez '
              + 'les pièces jointes, ou passez en mode manuel pour annoter la carte vous-même.'
            : 'Tous les modèles Gemini sont saturés en ce moment (pic de demande chez Google). '
              + 'Réessayez dans quelques minutes, ou utilisez le mode manuel pour annoter la carte vous-même.');
    }

    return { MODELS, DEFAULT_MODEL, generateDrill };
})();
