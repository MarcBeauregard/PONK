# $PONK

> **PONK all jeets.**

Memecoin née du croisement de Bonk et Pepe. Mascotte : **The Ponkeror** ([@rejeantabarnak](https://x.com/rejeantabarnak)), empereur-grenouille en armure qui règle le cas des jeets à coups de bâton.

## Les personnages

- **The Ponkeror** : empereur-grenouille en armure dorée, couronne et cape rouge, bâton de baseball. Il PONK les jeets.
- **PONK** : la mascotte générique, grenouille-chat poilue avec une queue rayée et les « !!! » rouges au-dessus de la tête (astronaute, DJ…).
- **Les jeets** : des ours. Ils finissent avec les yeux en spirale.

Images dans [`assets/`](assets).

## Jeet Tracker (`index.html`)

Page 1920×1080 pensée pour tourner 24/7 en live stream. Chaque trade de $PONK arrive en direct (websocket PumpPortal, sans clé API ni serveur) :

| Trade | À l'écran |
|---|---|
| Petite vente | L'ours arrive, PONK!, il s'envole |
| Vente ≥ 0,5 SOL | PONK!! avec flash et écran qui tremble |
| Vend tout (solde à 0) | Scène plein écran **MEGA PONK!** |
| Achat | Une grenouille rejoint l'armée en bas de l'écran |
| Achat ≥ 3 SOL | Scène plein écran de la parade : **ALL HAIL SIR …** |
| 6 min sans trade | Intermède PONK FM (DJ) ou STILL HOLDING (astronaute) |

Animations : traînée du coup de bâton, effet de frappe (hit-stop, flash, lignes de vitesse, étincelles, poils, étoiles), l'ours qui part en orbite avec une traînée et disparaît en étincelle, confettis et pièces pour les gros achats, lettres qui s'écrasent à l'écran, barre de bataille acheteurs/vendeurs, compteurs qui roulent, neige et rayons de lumière en continu, armée qui sautille, bulle en machine à écrire.

La scène de parade utilise `assets/ponkeror-parade-bat.png` (le Ponkeror avec un bâton au lieu de l'épée) si le fichier existe, sinon l'image d'origine.

Elle repère aussi les **speed jeets** (vente moins de 10 min après l'achat) et les **jeets repentants** (rachat après une vente). Les compteurs survivent à un rafraîchissement et repartent à zéro chaque jour.

### Options d'URL

- `?demo=1` : faux trades, pour tester ou faire des teasers
- `?mute=1` : sans son ; `?vol=0.3` : volume entre 0 et 1
- `?swing=0.5` : seuil en SOL du gros PONK ; `?whale=3` : seuil en SOL de la parade

### Pour le live stream (OBS)

Ajouter une source **Navigateur** en 1920×1080 avec l'URL de la page, et cocher « Contrôler l'audio via OBS » pour le son.

### En local

```
python3 -m http.server 8000
```

Puis ouvrir http://localhost:8000/?demo=1

## Token

- Chaîne : Solana (lancé sur pump.fun)
- CA : `4jjQjDRYd7xLcFMViRsz4GvtgU6gPZgbVaxN3Rq9pump`
- pump.fun : https://pump.fun/coin/4jjQjDRYd7xLcFMViRsz4GvtgU6gPZgbVaxN3Rq9pump
