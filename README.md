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

## Persistenz (Upstash Redis)

Der gesamte App-State liegt geräteübergreifend in **einem** Redis-Key
(`time-tracker:state:v1`) in Upstash Redis. Der Zugriff erfolgt ausschließlich
serverseitig über die Route Handler unter `app/api/state` — das Token erreicht den
Client nie.

In Vercel den Upstash-Redis-Store mit dem Projekt verbinden; die Integration injiziert
je nach Setup entweder `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` oder
`KV_REST_API_URL` / `KV_REST_API_TOKEN` automatisch als Environment-Variablen. Der
Code akzeptiert beide Varianten. Für die lokale Entwicklung die Variablen mit
`vercel env pull .env.local` herunterladen (Vorlage: `.env.local.example`) und den
Dev-Server danach neu starten.

Falls `vercel env pull` leere Werte wie `KV_REST_API_URL=""` schreibt, sind die
Credentials lokal noch nicht nutzbar. Dann die Redis-REST-URL und das Token im
Vercel-/Upstash-Dashboard kopieren oder die Variablen für die Development-Umgebung
hinzufügen. Prüfen lässt sich die aktive Ablage über den Response-Header
`X-Tracker-Storage`: `redis` bedeutet Redis, `memory` bedeutet lokaler Fallback.

Ohne gesetzte Redis-Variablen nutzt die API einen gemeinsamen In-Memory-Speicher im
laufenden Serverprozess. Das reicht zum lokalen Testen mit mehreren Geräten im selben
Dev-Server, wird aber bei Server-Neustart zurückgesetzt und ist für Deployments nicht
dauerhaft.
# lorenz-study-timer
