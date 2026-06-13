/**
 * Electron shell runs Next.js from resources/standalone and does not need the
 * root project's node_modules inside app.asar. Returning false tells
 * electron-builder to skip automatic node_modules collection, which otherwise
 * drops the shell package.json from the archive.
 */
module.exports = async function beforeBuild() {
  return false;
};
