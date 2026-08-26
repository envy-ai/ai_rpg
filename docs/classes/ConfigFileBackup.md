# ConfigFileBackup

`ConfigFileBackup.js` preserves the exact existing YAML bytes before the System Configuration page or image-workflow preset API replaces the selected configuration file.

`backupConfigFile(configPath)` creates a sibling `config-backups/` directory and copies the current file to a collision-resistant, timestamped YAML filename. Copying happens before the active write and uses exclusive creation, so a backup failure aborts the save rather than silently replacing the only configuration copy.

The backup retains comments and formatting because it is a byte-for-byte copy. The active file still uses the established `js-yaml` serializer, which does not retain comments. `config-backups/` is ignored by Git.
