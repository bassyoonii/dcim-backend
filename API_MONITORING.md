API Monitoring
===============

Petit guide des endpoints exposés par `prom-proxy.js` (proxy vers Prometheus).

Endpoints
---------

GET /api/cpu?instance=<instance?>
- Retour: utilisation CPU en pourcentage.
- Exemple:

```
{
  "instance": "host:9100",
  "cpu": "12.34",
  "metric": { /* Prometheus metric labels */ },
  "series": [ /* optional series list */ ]
}
```

GET /api/ram?instance=<instance?>
- Retour: utilisation RAM en pourcentage.
- Exemple:

```
{
  "instance": "host:9100",
  "ram": "45.67",
  "metric": { }
}
```

GET /api/disk?instance=<instance?>
- Description: utilisation du filesystem racine (`mountpoint="/"`) en pourcentage.
- Garantie: si `instance` est fourni, la réponse contiendra toujours un champ `disk` numérique (float).
- Exemple:

```
{
  "instance": "host:9100",
  "disk": 73.21,
  "metric": { /* chosen Prometheus metric labels */ }
}
```

GET /api/disk/range?instance=<instance?>&start=<unix>&end=<unix>&step=<sec>
- Retourne séries temporelles pour le disque (root fs). Exemple:

```
{
  "series": [
    { "instance": "host:9100", "values": [[1630000000, 70.1], [1630000060, 70.2]] }
  ]
}
```

Notes
-----
- Les valeurs sont arrondies côté proxy pour simplifier l'affichage.
- Les routes existent aussi sans le préfixe `/api` (par ex. `/cpu`).
- Pour déboguer les valeurs `disk`, le proxy logge une ligne debug sur chaque requête `disk` (voir `prom-proxy.js`).
