# ServicePilot - gestion de restaurant

Application de gestion d'un restaurant : reservations, salle, commandes, cuisine, caisse, stock, menu, finances et sessions par role.

## Demarrage local

```bash
npm install
npm run dev
npm run api
```

Sans `DATABASE_URL`, l'API utilise `db/restaurant.json`. Sur Render, `DATABASE_URL` est fournie automatiquement par le service PostgreSQL declare dans `render.yaml` et les donnees sont migrees au premier demarrage.

## Comptes de demonstration

- Gerante : `1234`
- Serveur : `2222`
- Cuisine : `3333`
- Caissier : `4444`

Ces codes doivent etre remplaces avant une mise en production.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
