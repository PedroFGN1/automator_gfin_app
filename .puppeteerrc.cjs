const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Diz ao Puppeteer para baixar o Chrome dentro da pasta do projeto
  // Assim o electron-builder vai copiá-lo junto com a pasta node_modules
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};