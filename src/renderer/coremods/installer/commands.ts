import { Injector, plugins } from "@replugged";
import { ApplicationCommandOptionType } from "src/types";
import { INSTALLER_SOURCES, InstallerSource, installFlow, installURL } from "./util";

/**
 * A map 'special' names that don't need to be translated by i18n
 */
const specialSourceDisplayNames: Partial<Record<InstallerSource, string>> = {
  github: "GitHub",
};

function installSourceName(source: InstallerSource): string {
  const displayName = specialSourceDisplayNames[source];
  if (displayName) {
    return displayName;
  }

  // TODO: i18n
  return source;
}

export function loadCommands(injector: Injector): void {
  injector.utils.registerSlashCommand({
    name: "install",
    // TODO: i18n
    displayName: "install",
    // TODO: i18n
    description: "Install an addon",
    options: [
      {
        name: "identifier",
        // TODO: i18n
        description: "The addon's updater id",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "source",
        // TODO: i18n
        displayName: "source",
        // TODO: i18n
        description: `The addon source`,
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: INSTALLER_SOURCES.map((v) => ({
          name: v,
          displayName: installSourceName(v),
          value: v,
        })),
      },
      {
        name: "id",
        // TODO: i18n
        displayName: "id",
        // TODO: i18n
        description: `A plugin ID that used by monorepo plugins only`,
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],

    async executor(i) {
      await installFlow(
        i.getValue("identifier"),
        i.getValue("source") as InstallerSource | undefined,
        i.getValue("id"),
      );
      return null
    },
  });

  injector.utils.registerSlashCommand({
    name: "share",
    // TODO: i18n
    displayName: "",
    // TODO: i18n
    description: "Share an addon's installation link",
    options: [
      {
        name: "id",
        // TODO: i18n
        displayName: "",
        // TODO: i18n
        description: "The id of the addon",
        required: true,
        type: ApplicationCommandOptionType.String,
      },
      {
        name: "send",
        // TODO: i18n
        displayName: "",
        // TODO: i18n
        description: "If set to false, this will only send an ephemeral message",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
      },
    ],

    executor(i) {
      const plugin = plugins.plugins.get(i.getValue("id"));
      if (!plugin) {
        return {
          send: false,
          // TODO: i18n?
          result: "Error: plugin not found",
        };
      }

      return {
        send: i.getValue("send", true),
        result: installURL(plugin.manifest),
      };
    },
  });
}
