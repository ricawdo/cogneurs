/* Point d'entrée unique de l'API (l'offre gratuite de Vercel limite à 12 fonctions) : toutes les routes /api/* arrivent ici. */
module.exports = require('../lib/app.js').handler;
