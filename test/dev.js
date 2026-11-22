/* Lance le jeu en local avec une base embarquée : node test/dev.js */
require('./pg.js')(5440).then(() => { process.env.PORT = process.env.PORT || '3000'; require('../server.js'); });
