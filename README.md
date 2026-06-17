# Lern-Timer

Ein persönlicher Uni-Lern-Timer (mobile-first, Dark Mode). Ziel: an jedem Werktag
6 h fokussierte Lernzeit in **4 × 90-Minuten-Blöcken** mit **5-Minuten-Pausen** und
einer frei steuerbaren **Mittagspause**.

- **Haupt-Timer** zählt die verbleibende Fokuszeit (6 h → 0) herunter. Fokusblock =
  schwarzer Hintergrund, 5-Minuten-Pause = grüner Hintergrund (sanfter Übergang).
  Nur Fokuszeit zählt gegen die 6 h.
- **Mittagspause** hält den gesamten Ablauf an und zählt hoch; „Weiter“ setzt exakt
  dort fort, wo pausiert wurde.
- **Day-Tracker** (Vorschau-Planer): 6 Wochen × 5 Werktage, aktuelle Woche links →
  kommende Wochen rechts. Grüne Intensität nach erreichter Fokuszeit, heutiger Tag
  hervorgehoben, Prüfungstermine in hellem Grau markiert.

Der Timer läuft über echte Zeit (`Date.now()`-Differenzen), driftet also nicht in
Hintergrund-Tabs und setzt nach einem Reload korrekt fort.

## Entwicklung

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) öffnen.

## Persistenz (Vercel Blob)

Der gesamte App-State liegt geräteübergreifend in **einer** JSON-Datei
(`tracker-state.json`) im Vercel-Blob-Store. Der Zugriff erfolgt ausschließlich
serverseitig über die Route Handler unter `app/api/state` — das Token erreicht den
Client nie.

In Vercel unter **Storage → Create → Blob** einen Blob-Store mit dem Projekt
verbinden; das `BLOB_READ_WRITE_TOKEN` wird dann automatisch als Environment-Variable
injiziert. Für die lokale Entwicklung das Token mit `vercel env pull .env.local`
herunterladen (Vorlage: `.env.local.example`).

Ohne gesetztes Token nutzt die API einen gemeinsamen In-Memory-Speicher im laufenden
Serverprozess. Das reicht zum lokalen Testen mit mehreren Geräten im selben Dev-Server,
wird aber bei Server-Neustart zurückgesetzt und ist für Deployments nicht dauerhaft.
# lorenz-study-timer
