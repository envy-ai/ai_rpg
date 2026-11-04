const path = require('path');
const Globals = require('./Globals.js');
const ThingFieldRegistry = require('./ThingFieldRegistry.js');
const { loadXmlGenerationSchema } = require('./XmlGenerationSchema.js');

function getThingGenerationSchemaExtensions({ registry = Globals.modExtensionRegistry, baseDirectory = __dirname } = {}) {
    const fields = new ThingFieldRegistry({ getModExtensionRegistry: () => registry }).getFields({ builtIn: false })
        .filter(field => field.exposeToXmlParser && field.xmlPrompt?.tagName);
    return getRegisteredEntityGenerationSchemaExtensions({ fields, baseDirectory,
        fragmentFile: 'item-fields.schema.xml', extensionName: 'thingFields' });
}

function getRegisteredEntityGenerationSchemaExtensions({ fields, baseDirectory = __dirname, fragmentFile, extensionName }) {
    const fragments = [];
    for (const modName of new Set(fields.map(field => field.modName))) {
        if (!/^[A-Za-z0-9_-]+$/.test(modName)) throw new Error(`Invalid schema mod directory ${modName}.`);
        const fragment = loadXmlGenerationSchema(fragmentFile, {
            baseDirectory: path.join(baseDirectory, 'mods', modName, 'schemas', 'xml')
        });
        const enabled = fields.filter(field => field.modName === modName);
        const selected = [];
        for (const field of enabled) {
            const node = fragment.children.find(child => child.name === field.xmlPrompt.tagName);
            if (!node || node.min !== 0 || node.max !== 1) throw new Error(`Mod ${modName} needs an optional singleton schema for ${field.xmlPrompt.tagName}.`);
            const collection = field.xmlPrompt.collection;
            if (collection) {
                const entry = node.children[0];
                if (node.children.length !== 1 || entry.name !== collection.itemTagName || entry.min !== 0 || entry.max !== Infinity
                    || entry.children.length !== collection.fields.length) throw new Error(`Mod ${modName} schema disagrees with collection ${node.name}.`);
                for (const child of collection.fields) {
                    const declaration = entry.children.find(candidate => candidate.name === child.tagName);
                    if (!declaration || declaration.children.length || declaration.max !== 1 || declaration.min !== (child.required ? 1 : 0)) {
                        throw new Error(`Mod ${modName} schema disagrees with ${node.name}.${child.tagName}.`);
                    }
                }
            } else if (node.children.length) throw new Error(`Mod ${modName} scalar schema ${node.name} cannot declare children.`);
            selected.push(node);
        }
        fragments.push({ ...fragment, children: selected });
    }
    return { [extensionName]: fragments };
}
module.exports = { getThingGenerationSchemaExtensions, getRegisteredEntityGenerationSchemaExtensions };
