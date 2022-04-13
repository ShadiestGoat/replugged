const { resolve, join } = require('path');
const { existsSync } = require('fs');
const { readdir } = require('fs').promises;
const { rmdirRf } = require('powercord/util');
const { exec } = require('child_process');
const security = require('./security.js');

module.exports = class PluginManager {
  constructor () {
    this.pluginDir = resolve(__dirname, '..', 'plugins');
    this.plugins = new Map();

    this.manifestKeys = [ 'name', 'version', 'description', 'author', 'license' ];
  }

  // Getters
  get (pluginID) {
    return this.plugins.get(pluginID);
  }

  getPlugins () {
    return [ ...this.plugins.keys() ];
  }

  isInstalled (plugin) {
    return this.plugins.has(plugin);
  }

  isEnabled (plugin) {
    return !powercord.settings.get('disabledPlugins', []).includes(plugin);
  }

  // Mount/load/enable/install shit
  mount (pluginID) {
    let manifest;
    try {
      manifest = Object.assign({
        appMode: 'app',
        dependencies: [],
        optionalDependencies: []
      }, require(resolve(this.pluginDir, pluginID, 'manifest.json')));
    } catch (e) {
      return console.error('%c[Powercord]', 'color: #7289da', `Plugin ${pluginID} doesn't have a valid manifest - Skipping`);
    }

    if (!this.manifestKeys.every(key => manifest.hasOwnProperty(key))) {
      return console.error('%c[Powercord]', 'color: #7289da', `Plugin "${pluginID}" doesn't have a valid manifest - Skipping`);
    }

    try {
      const PluginClass = require(resolve(this.pluginDir, pluginID));
      Object.defineProperties(PluginClass.prototype, {
        entityID: {
          get: () => pluginID,
          set: () => {
            throw new Error('Plugins cannot update their ID at runtime!');
          }
        },
        manifest: {
          get: () => manifest,
          set: () => {
            throw new Error('Plugins cannot update manifest at runtime!');
          }
        }
      });

      this.plugins.set(pluginID, new PluginClass());
    } catch (e) {
      console.error('%c[Powercord:Plugin]', 'color: #7289da', `An error occurred while initializing "${pluginID}"!`, e);
    }
  }

  async remount (pluginID) {
    try {
      await this.unmount(pluginID);
    } catch (e) {
      // chhhh
    }
    this.mount(pluginID);
    this.plugins.get(pluginID)._load();
  }

  async unmount (pluginID) {
    const plugin = this.get(pluginID);
    if (!plugin) {
      throw new Error(`Tried to unmount a non installed plugin (${plugin})`);
    }
    if (plugin.ready) {
      await plugin._unload();
    }

    Object.keys(require.cache).forEach(key => {
      if (key.includes(pluginID)) {
        delete require.cache[key];
      }
    });
    this.plugins.delete(pluginID);
  }

  // Load
  load (pluginID) {
    const plugin = this.get(pluginID);
    if (!plugin) {
      throw new Error(`Tried to load a non installed plugin (${plugin})`);
    }
    if (plugin.ready) {
      return console.error('%c[Powercord]', 'color: #7289da', `Tried to load an already loaded plugin (${pluginID})`);
    }

    plugin._load();
  }

  unload (pluginID) {
    const plugin = this.get(pluginID);
    if (!plugin) {
      throw new Error(`Tried to unload a non installed plugin (${plugin})`);
    }
    if (!plugin.ready) {
      return console.error('%c[Powercord]', 'color: #7289da', `Tried to unload a non loaded plugin (${plugin})`);
    }

    plugin._unload();
  }

  // Enable
  enable (pluginID) {
    if (!this.get(pluginID)) {
      throw new Error(`Tried to enable a non installed plugin (${pluginID})`);
    }

    powercord.settings.set(
      'disabledPlugins',
      powercord.settings.get('disabledPlugins', []).filter(p => p !== pluginID)
    );

    this.load(pluginID);
  }

  disable (pluginID) {
    const plugin = this.get(pluginID);

    if (!plugin) {
      throw new Error(`Tried to disable a non installed plugin (${pluginID})`);
    }

    powercord.settings.set('disabledPlugins', [
      ...powercord.settings.get('disabledPlugins', []),
      pluginID
    ]);

    this.unload(pluginID);
  }

  // noinspection JSUnusedLocalSymbols - Install
  async install (pluginID) { // eslint-disable-line no-unused-vars
    throw new Error('no');
  }

  async uninstall (pluginID) {
    if (pluginID.startsWith('pc-')) {
      throw new Error(`You cannot uninstall an internal plugin. (Tried to uninstall ${pluginID})`);
    }

    await this.unmount(pluginID);
    await rmdirRf(resolve(this.pluginDir, pluginID));
  }

  // Start
  async startPlugins (sync = false) {
    const filenames = await readdir(this.pluginDir);
    const unsafe = [];
    await Promise.all(filenames.map(async (filename) => {
      if (this.isInstalled(filename)) {
        return;
      }

      const safe = await this._safetyCheck(filename);
      if (!safe) {
        unsafe.push(filename);
        return;
      }

      this.mount(filename);
    }));

    if (unsafe.length) {
      powercord.api.notices.sendAnnouncement('powercord-unsafe-plugins', {
        color: 'red',
        message: `Powercord detected and blocked ${unsafe.length} plugins which are potentially harmful: ${unsafe.join(', ')}. These plugins could cause damage to your account and/or computer!`,
        button: {
          text: 'Load them anyway (dangerous)',
          onClick: () => {
            unsafe.forEach((plugin) => this.mount(plugin));
            this.__startPlugins0(true);
          }
        }
      });
    }

    return this.__startPlugins0(sync);
  }

  __startPlugins0 (sync) {
    const missingPlugins = [];
    const isOverlay = (/overlay/).test(location.pathname);
    for (const plugin of [ ...this.plugins.values() ]) {
      if (powercord.settings.get('disabledPlugins', []).includes(plugin.entityID)) {
        continue;
      }
      if (
        (plugin.manifest.appMode === 'overlay' && isOverlay) ||
        (plugin.manifest.appMode === 'app' && !isOverlay) ||
        plugin.manifest.appMode === 'both'
      ) {
        if (sync && !this.get(plugin.entityID).ready) {
          this.load(plugin.entityID);
          missingPlugins.push(plugin.entityID);
        } else if (!sync) {
          this.load(plugin.entityID);
        }
      } else {
        this.plugins.delete(plugin);
      }
    }

    if (sync) {
      return missingPlugins;
    }
  }

  shutdownPlugins () {
    return this._bulkUnload([ ...powercord.pluginManager.plugins.keys() ]);
  }

  _sortPlugins (pluginA, pluginB) {
    const priority = [ 'pc-commands', 'pc-settings', 'pc-moduleManager', 'pc-updater' ].reverse();
    const priorityA = priority.indexOf(pluginA);
    const priorityB = priority.indexOf(pluginB);
    return (priorityA === priorityB ? 0 : (priorityA < priorityB ? 1 : -1));
  }

  async _bulkUnload (plugins) {
    const nextPlugins = [];
    for (const plugin of plugins) {
      const deps = this.get(plugin).allDependencies;
      if (deps.filter(dep => this.get(dep) && this.get(dep).ready).length !== 0) {
        nextPlugins.push(plugin);
      } else {
        await this.unmount(plugin);
      }
    }

    if (nextPlugins.length !== 0) {
      await this._bulkUnload(nextPlugins);
    }
  }

  async _safetyCheck (filename) {
    if (!existsSync(join(this.pluginDir, filename, '.git'))) {
      return true;
    }

    return new Promise((resolve, reject) => {
      exec('git remote get-url origin', { cwd: join(this.pluginDir, filename) }, (err, out) => {
        if (err) {
          return reject(err);
        }

        resolve(!security.isFlagged(...out.toString().match(/github\.com[:/]([\w-_]+\/[\w-_]+)/)[1].split('/')));
      });
    });
  }
};
