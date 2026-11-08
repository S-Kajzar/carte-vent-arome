# Carte des prévisions de vent (AROME)

Carte interactive des prévisions de vent des modèles météo, dont **AROME-HD 1,3 km** de Météo-France, avec animation des particules de vent et frise horaire.

Exemple : <https://s-kajzar.github.io/carte-vent-arome/?lat=48.22505&lon=-4.21189&zoom=9.405&model=arome13>

## Données et crédits

- Prévisions : [Open-Meteo](https://open-meteo.com/) (API gratuite, sans clé, usage non commercial)
- Fond de carte : [OpenFreeMap](https://openfreemap.org) / © [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright)
- Relief : tuiles Terrarium (AWS Open Data)

## Développement

```bash
npm install
npx vite          # serveur de développement
npm run build     # build statique dans dist/
```

Le site est 100 % statique : chaque push sur `main` le recompile et le publie sur GitHub Pages (voir `.github/workflows/deploy.yml`).
