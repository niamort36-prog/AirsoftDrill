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

    const MODELS = [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (recommandé)' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (plus lent, plus précis)' },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (rapide, éco)' }
    ];
    const DEFAULT_MODEL = MODELS[0].id;

    const ENDPOINT = (model, key) =>
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    // Budget de pièces jointes envoyées à l'IA (base64) pour rester sous les
    // limites de l'API (~20 Mo par requête). Au-delà, seuls les titres partent.
    const INLINE_BUDGET_BYTES = 6 * 1024 * 1024;
    const TEXT_DOC_MAX_CHARS = 4000;

    const OVERLAY_TYPES = ['target', 'start_point', 'path', 'zone'];

    // --- Construction du prompt -------------------------------------------
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
            JSON.stringify(terrain.elements)
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

    // --- Appel principal -----------------------------------------------------
    async function generateDrill({ apiKey, model, terrain, pax, materials, docs, userPrompt }) {
        if (!apiKey) throw new Error('Aucune clé API enregistrée.');
        if (!terrain) throw new Error('Aucun terrain sélectionné.');
        model = model || DEFAULT_MODEL;

        const parts = [{ text: buildPrompt({ terrain, pax, materials, docs, userPrompt }) }]
            .concat(buildDocParts(docs));

        const body = {
            contents: [{ role: 'user', parts }],
            generationConfig: {
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
            }
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90000);
        let response;
        try {
            response = await fetch(ENDPOINT(model, apiKey), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
        } catch (e) {
            if (e.name === 'AbortError') throw new Error('Délai dépassé (90 s) : réessayez ou choisissez un modèle plus rapide.');
            throw new Error('Impossible de joindre l\'API Gemini (connexion ?).');
        } finally {
            clearTimeout(timer);
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) {
            const msg = (data.error && data.error.message) || ('HTTP ' + response.status);
            if (response.status === 400 && /API key/i.test(msg)) throw new Error('Clé API invalide. Vérifiez-la sur aistudio.google.com.');
            if (response.status === 404) throw new Error(`Modèle « ${model} » introuvable pour votre clé. Essayez un autre modèle.`);
            if (response.status === 429) throw new Error('Quota API dépassé : patientez une minute puis réessayez.');
            throw new Error('Erreur API : ' + msg);
        }

        if (data.promptFeedback && data.promptFeedback.blockReason) {
            throw new Error('Requête bloquée par les filtres de sécurité Gemini (' + data.promptFeedback.blockReason + ').');
        }
        const candidate = data.candidates && data.candidates[0];
        if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts.length) {
            const reason = candidate && candidate.finishReason ? ' (' + candidate.finishReason + ')' : '';
            throw new Error('Réponse vide de l\'IA' + reason + '. Reformulez votre demande.');
        }

        const json = extractJson(candidate.content.parts.map(p => p.text || '').join(''));
        return {
            markdown: String(json.markdown_text || ''),
            overlays: sanitizeOverlays(json.map_overlays, terrain)
        };
    }

    return { MODELS, DEFAULT_MODEL, generateDrill };
})();
