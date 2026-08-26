# ConfigSaveTarget

`ConfigSaveTarget.js` centralizes which YAML file the System Configuration form
and image-workflow preset API modify.

`resolveConfigSaveTarget(baseDir, options)` uses this precedence:

1. the process-local session override selected by `/reload_config <file>`;
2. the startup `--config-override` file;
3. root `config.yaml`.

Relative override paths resolve from the project directory. The helper rejects
blank or non-string paths rather than silently redirecting a save elsewhere.
`formatConfigSaveTarget()` returns a readable project-relative path for files
inside the repository and an absolute path for external targets. `/config`
displays that result immediately below its tab bar.
